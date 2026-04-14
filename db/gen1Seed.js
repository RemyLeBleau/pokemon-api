/**
 * Gen 1 SQLite seed from bundled JSON (data/gen1-clean.json).
 * Used by `npm run seed` (full reset) and by server startup when the DB is empty/incomplete.
 * Does not call PokeAPI — fetch remains a separate dev/maintenance step.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_GEN1_DATA_PATH = path.resolve(__dirname, '../data/gen1-clean.json');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function resetSchema(db) {
  await run(db, 'PRAGMA foreign_keys = OFF');
  await run(db, 'BEGIN TRANSACTION');
  try {
    await run(db, 'DROP TABLE IF EXISTS moves');
    await run(db, 'DROP TABLE IF EXISTS pokemon_legal_moves');
    await run(db, 'DROP TABLE IF EXISTS move_defs');
    await run(db, 'DROP TABLE IF EXISTS evolutions');
    await run(db, 'DROP TABLE IF EXISTS pokemon');

    await run(db, `
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

    await run(db, `
      CREATE TABLE move_defs (
        move_name TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        power INTEGER NOT NULL,
        accuracy INTEGER NOT NULL,
        pp INTEGER NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('physical', 'special', 'status'))
      )
    `);

    await run(db, `
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

    await run(db, `
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

    await run(db, `
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

    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK');
    throw err;
  } finally {
    await run(db, 'PRAGMA foreign_keys = ON');
  }
}

function loadData(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `Gen 1 dataset not found at ${jsonPath}. For developers: run npm run fetch:gen1 then npm run seed, or commit data/gen1-clean.json.`
    );
  }
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(parsed.pokemon) || !Array.isArray(parsed.moves) || !Array.isArray(parsed.pokemon_legal_moves)) {
    throw new Error('Invalid gen1-clean.json format (expected pokemon, moves, pokemon_legal_moves arrays).');
  }
  return parsed;
}

async function insertData(db, data) {
  await run(db, 'BEGIN TRANSACTION');
  try {
    for (const p of data.pokemon) {
      if (!Number.isInteger(p.pokedex_id) || p.pokedex_id < 1 || p.pokedex_id > 151) continue;
      await run(
        db,
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
        db,
        `INSERT INTO move_defs (move_name, type, power, accuracy, pp, category)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [m.move_name, m.type, m.power ?? 0, m.accuracy ?? 100, m.pp ?? 35, m.category]
      );
    }

    for (const pm of data.pokemon_legal_moves) {
      if (pm.pokedex_id < 1 || pm.pokedex_id > 151) continue;
      await run(
        db,
        `INSERT OR IGNORE INTO pokemon_legal_moves
          (pokedex_id, move_name, source_method, level_learned, version_group)
         VALUES (?, ?, ?, ?, ?)`,
        [pm.pokedex_id, pm.move_name, pm.source_method, pm.level_learned ?? null, pm.version_group]
      );
    }

    for (const e of data.evolutions || []) {
      if (e.from_pokedex_id < 1 || e.from_pokedex_id > 151 || e.to_pokedex_id < 1 || e.to_pokedex_id > 151) continue;
      await run(
        db,
        `INSERT OR IGNORE INTO evolutions
          (from_pokedex_id, to_pokedex_id, method, level_requirement, item_requirement, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [e.from_pokedex_id, e.to_pokedex_id, e.method, e.level_requirement ?? -1, e.item_requirement ?? '', e.notes ?? null]
      );
    }

    await run(db, `
      INSERT INTO moves (pokemon_id, move_name, type, power, accuracy, pp, category, source_method, level_learned)
      SELECT plm.pokedex_id, md.move_name, md.type, md.power, md.accuracy, md.pp, md.category, plm.source_method, plm.level_learned
      FROM pokemon_legal_moves plm
      JOIN move_defs md ON md.move_name = plm.move_name
    `);

    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK');
    throw err;
  }
}

async function verifySeed(db) {
  const [speciesCountRow] = await all(db, 'SELECT COUNT(*) AS c FROM pokemon WHERE pokedex_id BETWEEN 1 AND 151');
  const [minMaxRow] = await all(db, 'SELECT MIN(pokedex_id) AS min_id, MAX(pokedex_id) AS max_id FROM pokemon');
  const [moveCountRow] = await all(db, 'SELECT COUNT(*) AS c FROM move_defs');
  const [legalPoolCountRow] = await all(db, 'SELECT COUNT(*) AS c FROM pokemon_legal_moves');
  const [evoCountRow] = await all(db, 'SELECT COUNT(*) AS c FROM evolutions');
  return {
    species_count: speciesCountRow.c,
    min_id: minMaxRow.min_id,
    max_id: minMaxRow.max_id,
    move_defs_count: moveCountRow.c,
    legal_move_links: legalPoolCountRow.c,
    evolutions_count: evoCountRow.c
  };
}

/**
 * True if Gen 1 battle tables exist and contain a complete strict 151 dataset.
 */
async function isGen1DatasetComplete(db) {
  try {
    const tables = await all(
      db,
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('pokemon','move_defs','pokemon_legal_moves')`
    );
    if (tables.length < 3) return false;
    const summary = await verifySeed(db);
    return (
      summary.species_count === 151 &&
      summary.min_id === 1 &&
      summary.max_id === 151 &&
      summary.move_defs_count > 0 &&
      summary.legal_move_links > 0
    );
  } catch {
    return false;
  }
}

/**
 * Drop Gen 1 tables and re-insert from JSON (same as manual `npm run seed`).
 */
async function reseedGen1FromFile(db, jsonPath = DEFAULT_GEN1_DATA_PATH) {
  const data = loadData(jsonPath);
  await resetSchema(db);
  await insertData(db, data);
  const summary = await verifySeed(db);
  if (summary.species_count !== 151 || summary.min_id !== 1 || summary.max_id !== 151) {
    throw new Error(`Gen 1 seed verification failed: ${JSON.stringify(summary)}`);
  }
  return summary;
}

/**
 * If SQLite already has a full Gen 1 dataset, no-op.
 * Otherwise reseed from bundled JSON only (no network).
 *
 * @returns {Promise<{ bootstrapped: boolean, summary: object }>}
 */
async function ensureGen1Dataset(db, jsonPath = DEFAULT_GEN1_DATA_PATH) {
  if (await isGen1DatasetComplete(db)) {
    const summary = await verifySeed(db);
    return { bootstrapped: false, summary };
  }
  const summary = await reseedGen1FromFile(db, jsonPath);
  return { bootstrapped: true, summary };
}

module.exports = {
  DEFAULT_GEN1_DATA_PATH,
  ensureGen1Dataset,
  reseedGen1FromFile,
  isGen1DatasetComplete,
  verifySeed,
  loadData
};
