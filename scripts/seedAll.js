const fs = require('fs');
const path = require('path');
const db = require('../db/database');

const DATA_PATH = path.resolve(__dirname, '../data/gen1-clean.json');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function resetSchema() {
  await run('PRAGMA foreign_keys = OFF');
  await run('BEGIN TRANSACTION');
  try {
    // Drop compatibility first, then normalized.
    await run('DROP TABLE IF EXISTS moves');
    await run('DROP TABLE IF EXISTS pokemon_legal_moves');
    await run('DROP TABLE IF EXISTS move_defs');
    await run('DROP TABLE IF EXISTS evolutions');
    await run('DROP TABLE IF EXISTS pokemon');

    // Pokemon species table (one row per species, strict 1..151).
    await run(`
      CREATE TABLE pokemon (
        pokedex_id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        type1 TEXT NOT NULL,
        type2 TEXT,
        sprite_url TEXT,
        base_hp INTEGER NOT NULL,
        base_attack INTEGER NOT NULL,
        base_defense INTEGER NOT NULL,
        base_special INTEGER NOT NULL,
        base_speed INTEGER NOT NULL
      )
    `);

    // Normalized move definitions.
    await run(`
      CREATE TABLE move_defs (
        move_name TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        power INTEGER NOT NULL,
        accuracy INTEGER NOT NULL,
        pp INTEGER NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('physical', 'special', 'status'))
      )
    `);

    // Pivot: legal Gen 1 move pool by species and source.
    await run(`
      CREATE TABLE pokemon_legal_moves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pokedex_id INTEGER NOT NULL,
        move_name TEXT NOT NULL,
        source_method TEXT NOT NULL CHECK(source_method IN ('level-up', 'tm/hm')),
        level_learned INTEGER,
        version_group TEXT NOT NULL,
        UNIQUE(pokedex_id, move_name, source_method),
        FOREIGN KEY(pokedex_id) REFERENCES pokemon(pokedex_id),
        FOREIGN KEY(move_name) REFERENCES move_defs(move_name)
      )
    `);

    // Explicit Gen 1 evolution edges (stored, not inferred later).
    await run(`
      CREATE TABLE evolutions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_pokedex_id INTEGER NOT NULL,
        to_pokedex_id INTEGER NOT NULL,
        method TEXT NOT NULL,
        level_requirement INTEGER NOT NULL DEFAULT -1,
        item_requirement TEXT NOT NULL DEFAULT '',
        notes TEXT,
        UNIQUE(from_pokedex_id, to_pokedex_id, method, level_requirement, item_requirement),
        FOREIGN KEY(from_pokedex_id) REFERENCES pokemon(pokedex_id),
        FOREIGN KEY(to_pokedex_id) REFERENCES pokemon(pokedex_id)
      )
    `);

    // Compatibility table for existing app queries (engine currently reads this).
    await run(`
      CREATE TABLE moves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pokemon_id INTEGER NOT NULL,
        move_name TEXT NOT NULL,
        type TEXT NOT NULL,
        power INTEGER NOT NULL,
        accuracy INTEGER NOT NULL,
        pp INTEGER NOT NULL,
        category TEXT NOT NULL,
        source_method TEXT,
        level_learned INTEGER,
        FOREIGN KEY(pokemon_id) REFERENCES pokemon(pokedex_id)
      )
    `);

    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  } finally {
    await run('PRAGMA foreign_keys = ON');
  }
}

function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`Dataset not found at ${DATA_PATH}. Run: npm run fetch:gen1`);
  }
  const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  if (!Array.isArray(parsed.pokemon) || !Array.isArray(parsed.moves) || !Array.isArray(parsed.pokemon_legal_moves)) {
    throw new Error('Invalid dataset format. Re-run fetch script.');
  }
  return parsed;
}

async function insertData(data) {
  await run('BEGIN TRANSACTION');
  try {
    for (const p of data.pokemon) {
      // HARD FILTER: strict National Pokedex IDs 1..151.
      if (!Number.isInteger(p.pokedex_id) || p.pokedex_id < 1 || p.pokedex_id > 151) continue;
      await run(
        `INSERT INTO pokemon
          (pokedex_id, name, type1, type2, sprite_url, base_hp, base_attack, base_defense, base_special, base_speed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.pokedex_id, p.name, p.type1, p.type2 || null, p.sprite_url || null,
          p.base_hp, p.base_attack, p.base_defense, p.base_special, p.base_speed
        ]
      );
    }

    for (const m of data.moves) {
      await run(
        `INSERT INTO move_defs (move_name, type, power, accuracy, pp, category)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [m.move_name, m.type, m.power ?? 0, m.accuracy ?? 100, m.pp ?? 35, m.category]
      );
    }

    for (const pm of data.pokemon_legal_moves) {
      if (pm.pokedex_id < 1 || pm.pokedex_id > 151) continue;
      await run(
        `INSERT OR IGNORE INTO pokemon_legal_moves
          (pokedex_id, move_name, source_method, level_learned, version_group)
         VALUES (?, ?, ?, ?, ?)`,
        [pm.pokedex_id, pm.move_name, pm.source_method, pm.level_learned ?? null, pm.version_group]
      );
    }

    for (const e of data.evolutions || []) {
      if (e.from_pokedex_id < 1 || e.from_pokedex_id > 151 || e.to_pokedex_id < 1 || e.to_pokedex_id > 151) continue;
      await run(
        `INSERT OR IGNORE INTO evolutions
          (from_pokedex_id, to_pokedex_id, method, level_requirement, item_requirement, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [e.from_pokedex_id, e.to_pokedex_id, e.method, e.level_requirement ?? -1, e.item_requirement ?? '', e.notes ?? null]
      );
    }

    // Compatibility population for existing queries (full legal pool, deterministic selection can happen in app layer).
    await run(`
      INSERT INTO moves (pokemon_id, move_name, type, power, accuracy, pp, category, source_method, level_learned)
      SELECT plm.pokedex_id, md.move_name, md.type, md.power, md.accuracy, md.pp, md.category, plm.source_method, plm.level_learned
      FROM pokemon_legal_moves plm
      JOIN move_defs md ON md.move_name = plm.move_name
    `);

    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}

async function verifySeed() {
  const [speciesCountRow] = await all('SELECT COUNT(*) AS c FROM pokemon WHERE pokedex_id BETWEEN 1 AND 151');
  const [minMaxRow] = await all('SELECT MIN(pokedex_id) AS min_id, MAX(pokedex_id) AS max_id FROM pokemon');
  const [moveCountRow] = await all('SELECT COUNT(*) AS c FROM move_defs');
  const [legalPoolCountRow] = await all('SELECT COUNT(*) AS c FROM pokemon_legal_moves');
  const [evoCountRow] = await all('SELECT COUNT(*) AS c FROM evolutions');
  return {
    species_count: speciesCountRow.c,
    min_id: minMaxRow.min_id,
    max_id: minMaxRow.max_id,
    move_defs_count: moveCountRow.c,
    legal_move_links: legalPoolCountRow.c,
    evolutions_count: evoCountRow.c
  };
}

async function main() {
  console.log('Resetting strict Gen 1 schema...');
  await resetSchema();
  const data = loadData();
  console.log('Seeding strict Gen 1 dataset...');
  await insertData(data);
  const summary = await verifySeed();
  console.log('Seed complete:', summary);

  if (summary.species_count !== 151 || summary.min_id !== 1 || summary.max_id !== 151) {
    throw new Error(`Seed verification failed: expected strict 151 species, got ${JSON.stringify(summary)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });