// db/statCalculator.js
// Calculates in-battle stats for any Pokémon given base stats and level

/**
 * Calculate Pokémon stats based on Gen 1 formulas
 * @param {Object} baseStats - base stats object from DB: { base_hp, base_attack, base_defense, base_special, base_speed }
 * @param {number} level - Pokémon level (default 75)
 * @param {number} IV - Individual Value (default 15)
 * @param {number} EV - Effort Value (default 0)
 * @returns {Object} stats - { hp, attack, defense, special, speed }
 */
function calculateStats(baseStats, level = 75, IV = 15, EV = 0) {
  // Gen 1 formulas for HP
  const hp = Math.floor(((2 * baseStats.base_hp + IV + Math.floor(EV / 4)) * level) / 100) + level + 10;

  // Other stats (attack, defense, speed, special)
  const attack = Math.floor(((2 * baseStats.base_attack + IV + Math.floor(EV / 4)) * level) / 100) + 5;
  const defense = Math.floor(((2 * baseStats.base_defense + IV + Math.floor(EV / 4)) * level) / 100) + 5;
  const special = Math.floor(((2 * baseStats.base_special + IV + Math.floor(EV / 4)) * level) / 100) + 5;
  const speed = Math.floor(((2 * baseStats.base_speed + IV + Math.floor(EV / 4)) * level) / 100) + 5;

  return { hp, attack, defense, special, speed };
}

/**
 * Assign stats to a Pokémon instance
 * @param {Object} pokemon - Pokémon object with base stats
 * @param {number} level - Level to scale to (default 75)
 */
function assignLevelStats(pokemon, level = 75) {
  const stats = calculateStats(pokemon.stats, level);
  pokemon.stats = stats;
  pokemon.level = level;
  pokemon.currentHP = stats.hp;
  return pokemon;
}

module.exports = { calculateStats, assignLevelStats };