const db = require('../../db/database');
const { createPokemon } = require('../pokemonFactory');

/**
 * Creates a fully battle-ready Pokémon by DB ID
 * @param {number} id - Pokémon DB ID
 * @param {number} level - Pokémon level
 * @returns {Promise<Object>} Pokémon instance
 */
async function createPokemonById(id, level) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM pokemon WHERE id = ?', [id], async (err, row) => {
      if (err) return reject(err);
      if (!row) return reject(new Error(`Pokemon ID ${id} not found`));

      // Pokémon types
      const types = row.type2 ? [row.type1, row.type2] : [row.type1];

      // Base stats from DB
      const baseStats = {
        base_hp: row.base_hp,
        base_attack: row.base_attack,
        base_defense: row.base_defense,
        base_special: row.base_special,
        base_speed: row.base_speed
      };

      // Placeholder options for future mechanics
      const options = {
        status: null,
        ability: null,
        heldItem: null,
        ivs: { hp: 0, attack: 0, defense: 0, special: 0, speed: 0 },
        evs: { hp: 0, attack: 0, defense: 0, special: 0, speed: 0 },
        evolution: null,
        isShiny: false
      };

      const pokemon = await createPokemon(row.name, level, types, [], baseStats, options);
      resolve(pokemon);
    });
  });
}

module.exports = { createPokemonById };