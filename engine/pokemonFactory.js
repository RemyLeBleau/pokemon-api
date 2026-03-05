// engine/pokemonFactory.js
const db = require('../db/database');
const PokemonInstance = require('./pokemonInstance');

const LEVEL = 75;

function scaleStats(baseStats) {
  return {
    hp: Math.floor(((baseStats.hp * 2 * LEVEL) / 100) + LEVEL + 10),
    attack: Math.floor(((baseStats.attack * 2 * LEVEL) / 100) + 5),
    defense: Math.floor(((baseStats.defense * 2 * LEVEL) / 100) + 5),
    special: Math.floor(((baseStats.special * 2 * LEVEL) / 100) + 5),
    speed: Math.floor(((baseStats.speed * 2 * LEVEL) / 100) + 5)
  };
}

function fetchTypes(speciesId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT type FROM pokemon_types WHERE species_id = ?`,
      [speciesId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => r.type));
      }
    );
  });
}

function fetchMoves(speciesId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT m.id, m.name, m.type, m.power, m.accuracy, m.pp, m.damage_class
       FROM moves m
       JOIN pokemon_moves pm ON pm.move_id = m.id
       WHERE pm.species_id = ?
       ORDER BY m.power DESC`,
      [speciesId],
      (err, rows) => {
        if (err) return reject(err);
        if (!rows?.length) return resolve([]);

        const moves = rows.slice(0, 4).map(r => ({
          id: r.id,
          name: r.name,
          type: r.type,
          power: r.power || 0,
          accuracy: r.accuracy || 100,
          pp: r.pp,
          currentPP: r.pp,
          damageClass: r.damage_class === 'special' ? 'special' : 'physical'
        }));

        resolve(moves);
      }
    );
  });
}

async function createPokemon(name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, name, base_hp, base_attack, base_defense, base_special, base_speed
       FROM pokemon_species
       WHERE name = ?`,
      [name.toLowerCase()],
      async (err, row) => {
        if (err) return reject(err);
        if (!row) return reject(new Error(`Species not found: ${name}`));

        try {
          const baseStats = {
            hp: row.base_hp,
            attack: row.base_attack,
            defense: row.base_defense,
            special: row.base_special,
            speed: row.base_speed
          };

          const stats = scaleStats(baseStats);
          const types = await fetchTypes(row.id);
          const moves = await fetchMoves(row.id);

          const instance = new PokemonInstance({
            id: row.id,
            name: row.name,
            level: LEVEL,
            types,
            stats,
            moves
          });

          resolve(instance);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

async function getAllSpecies() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT name FROM pokemon_species`,
      [],
      async (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => r.name));
      }
    );
  });
}

module.exports = { createPokemon, getAllSpecies };