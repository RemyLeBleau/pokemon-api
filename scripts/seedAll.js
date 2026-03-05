// scripts/seedAll.js
const db = require('../db/database'); // points to db/database.js
const fs = require('fs');

// -------------------------------
// Helper: Sleep to avoid API rate limit
// -------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -------------------------------
// Table creation SQL
// -------------------------------
async function resetTables() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`DROP TABLE IF EXISTS moves`);
      db.run(`DROP TABLE IF EXISTS pokemon`);

      db.run(`
        CREATE TABLE pokemon (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT,
          type1 TEXT,
          type2 TEXT,
          base_hp INTEGER,
          base_attack INTEGER,
          base_defense INTEGER,
          base_special INTEGER,
          base_speed INTEGER
        )
      `);

      db.run(`
        CREATE TABLE moves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pokemon_id INTEGER,
          move_name TEXT,
          type TEXT,
          power INTEGER,
          accuracy INTEGER,
          pp INTEGER,
          category TEXT,
          FOREIGN KEY(pokemon_id) REFERENCES pokemon(id)
        )
      `, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

// -------------------------------
// Fetch Gen 1 Pokémon from PokéAPI
// -------------------------------
async function fetchGen1Pokemon() {
  const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=151');
  const data = await res.json();
  return data.results; // array of { name, url }
}

// -------------------------------
// Fetch detailed Pokémon data
// -------------------------------
async function fetchPokemonData(url) {
  const res = await fetch(url);
  const data = await res.json();
  // Extract types
  const types = data.types.map(t => t.type.name);
  // Extract base stats
  const stats = {};
  data.stats.forEach(s => {
    const name = s.stat.name;
    if (name === 'hp') stats.base_hp = s.base_stat;
    if (name === 'attack') stats.base_attack = s.base_stat;
    if (name === 'defense') stats.base_defense = s.base_stat;
    if (name === 'special-attack' || name === 'special-defense') {
      // In Gen 1, we treat both special-attack/defense as single "special"
      stats.base_special = s.base_stat;
    }
    if (name === 'speed') stats.base_speed = s.base_stat;
  });

  // Get moves: pick 3 strongest native + 1 TM
  let moves = data.moves
    .filter(m => m.version_group_details.some(v => v.version_group.name === 'red-blue')) // Gen1
    .map(m => ({ name: m.move.name, url: m.move.url }));

  // Sort moves by power (fetch power separately)
  const moveDetails = [];
  for (let i = 0; i < moves.length; i++) {
    const moveRes = await fetch(moves[i].url);
    const moveData = await moveRes.json();
    // Only include moves with power (ignore status if we want attack only)
    moveDetails.push({
      name: moveData.name,
      type: moveData.type.name,
      power: moveData.power || 0,
      accuracy: moveData.accuracy || 100,
      pp: moveData.pp || 15,
      category: moveData.damage_class.name // physical, special, status
    });
    await sleep(50); // tiny delay to be polite to API
  }

  // pick top 3 by power
  moveDetails.sort((a, b) => b.power - a.power);
  const selectedMoves = moveDetails.slice(0, 3);

  // pick a random TM move from the remaining moves (power > 0)
  const tmCandidates = moveDetails.filter(m => m.power > 0 && !selectedMoves.includes(m));
  if (tmCandidates.length > 0) selectedMoves.push(tmCandidates[Math.floor(Math.random() * tmCandidates.length)]);

  return { types, stats, moves: selectedMoves };
}

// -------------------------------
// Insert Pokémon & moves into DB
// -------------------------------
async function insertPokemon(name, types, stats, moves) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO pokemon (name,type1,type2,base_hp,base_attack,base_defense,base_special,base_speed) VALUES (?,?,?,?,?,?,?,?)`,
      [
        name,
        types[0],
        types[1] || null,
        stats.base_hp,
        stats.base_attack,
        stats.base_defense,
        stats.base_special,
        stats.base_speed
      ],
      function (err) {
        if (err) return reject(err);
        const pokemonId = this.lastID;

        // insert moves
        const stmt = db.prepare(`INSERT INTO moves (pokemon_id,move_name,type,power,accuracy,pp,category) VALUES (?,?,?,?,?,?,?)`);
        moves.forEach(m => {
          stmt.run(pokemonId, m.name, m.type, m.power, m.accuracy, m.pp, m.category);
        });
        stmt.finalize();
        resolve();
      }
    );
  });
}

// -------------------------------
// Main seeding function
// -------------------------------
async function seedAll() {
  console.log('Resetting tables...');
  await resetTables();

  console.log('Fetching Gen 1 Pokémon...');
  const pokemonList = await fetchGen1Pokemon();

  for (let i = 0; i < pokemonList.length; i++) {
    const p = pokemonList[i];
    console.log(`Seeding ${p.name} (${i + 1}/${pokemonList.length})...`);
    try {
      const { types, stats, moves } = await fetchPokemonData(p.url);
      await insertPokemon(p.name, types, stats, moves);
      await sleep(50); // avoid rate limits
    } catch (err) {
      console.error(`Error seeding ${p.name}:`, err);
    }
  }

  console.log('✅ Seeding complete — 151 Pokémon + moves inserted!');
  process.exit(0);
}

seedAll();