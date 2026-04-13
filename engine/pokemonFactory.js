// engine/pokemonFactory.js
// Builds battle-ready Pokémon from SQLite (Gen 1 seed data: 151 species, level 75, 3 native + 1 TM moves)

const db = require('../db/database');
const { calculateStats } = require('../db/statCalculator');
const PokemonInstance = require('./pokemonInstance');

// Gen 1 final-stage species (fully evolved by level or trade). No pre-evolutions like Pidgey.
// PokeAPI uses lowercase; hyphenated names (e.g. mr-mime) as returned by the API.
const GEN1_FINAL_STAGE = new Set([
  'venusaur', 'charizard', 'blastoise', 'butterfree', 'beedrill', 'pidgeot', 'raticate', 'fearow', 'arbok',
  'raichu', 'sandslash', 'nidoqueen', 'nidoking', 'clefable', 'ninetales', 'wigglytuff', 'golbat',
  'vileplume', 'parasect', 'venomoth', 'dugtrio', 'persian', 'golduck', 'primeape', 'arcanine', 'poliwrath',
  'alakazam', 'machamp', 'victreebel', 'tentacruel', 'golem', 'rapidash', 'slowbro', 'magneton', 'farfetchd',
  'dodrio', 'dewgong', 'muk', 'cloyster', 'gengar', 'onix', 'hypno', 'kingler', 'electrode', 'exeggutor',
  'marowak', 'hitmonlee', 'hitmonchan', 'lickitung', 'weezing', 'rhydon', 'chansey', 'tangela', 'kangaskhan',
  'seadra', 'seaking', 'starmie', 'mr-mime', 'scyther', 'jynx', 'electabuzz', 'magmar', 'pinsir', 'tauros',
  'gyarados', 'lapras', 'ditto', 'vaporeon', 'jolteon', 'flareon', 'porygon', 'omastar', 'kabutops',
  'aerodactyl', 'snorlax', 'articuno', 'zapdos', 'moltres', 'dragonite', 'mewtwo', 'mew'
]);

// Stone-evolution pre-forms: show both forms for team builder (e.g. Vulpix + Ninetales).
const GEN1_STONE_LINE_BASES = new Set([
  'vulpix', 'growlithe', 'poliwhirl', 'gloom', 'pikachu', 'eevee', 'exeggcute', 'staryu', 'shellder',
  'jigglypuff', 'clefairy'
]);

// Eligible: final-stage OR stone-evolution pre-form (both forms available).
const GEN1_ELIGIBLE = new Set([...GEN1_FINAL_STAGE, ...GEN1_STONE_LINE_BASES]);

function getDb() {
  return db;
}

/**
 * Get all species names from the DB. Optionally filter to Gen 1 final-stage only.
 * @param {{ finalStageOnly?: boolean }} opts
 * @returns {Promise<string[]>}
 */
function getAllSpecies(opts = {}) {
  return new Promise((resolve, reject) => {
    db.all('SELECT name FROM pokemon', [], (err, rows) => {
      if (err) return reject(err);
      let names = (rows || []).map(r => r.name);
      if (opts.finalStageOnly) {
        names = names.filter(n => GEN1_ELIGIBLE.has((n || '').toLowerCase()));
      }
      resolve(names);
    });
  });
}

/**
 * Get species with pokedex id (for sprite URLs). Final-stage only for team builder.
 * @returns {Promise<Array<{ name: string, id: number }>>}
 */
function getSpeciesWithIds() {
  return new Promise((resolve, reject) => {
    db.all('SELECT name, pokedex_id AS id FROM pokemon ORDER BY pokedex_id', [], (err, rows) => {
      if (err) return reject(err);
      const list = (rows || []).filter(r => GEN1_ELIGIBLE.has((r.name || '').toLowerCase()));
      resolve(list);
    });
  });
}

/**
 * Load moves for a Pokémon by pokedex_id (moves.pokemon_id matches pokedex_id in seed script).
 * @param {number} pokedexId
 * @returns {Promise<Array<{ name: string, type: string, power: number, accuracy: number, pp: number, category: string, currentPP: number }>>}
 */
function loadMovesFor(pokedexId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT move_name AS name, type, power, accuracy, pp, category FROM moves WHERE pokemon_id = ?',
      [pokedexId],
      (err, rows) => {
        if (err) return reject(err);
        const moves = (rows || []).map(m => ({
          name: m.name,
          type: m.type,
          power: m.power || 0,
          accuracy: m.accuracy != null ? m.accuracy : 100,
          pp: m.pp || 15,
          category: m.category || 'physical',
          damageClass: m.category || 'physical',
          currentPP: m.pp || 15
        }));
        resolve(moves);
      }
    );
  });
}

/**
 * Load one Pokémon row by name.
 * @param {string} name
 * @returns {Promise<object|null>}
 */
function getPokemonRowByName(name) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM pokemon WHERE name = ?', [name], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

/**
 * Create a battle-ready Pokémon instance.
 * - Called as createPokemon(name): load everything from DB, level 75.
 * - Called as createPokemon(name, level, types, moves, baseStats, options): use provided data, load moves from DB if moves is empty.
 * @param {string} name - Species name (e.g. 'charizard')
 * @param {number} [level=75]
 * @param {string[]} [types] - If omitted, loaded from DB
 * @param {array} [moves] - If null/empty, loaded from DB
 * @param {object} [baseStats] - { base_hp, base_attack, base_defense, base_special, base_speed }; if omitted, loaded from DB
 * @param {object} [options] - Reserved for IV/EV, ability, etc.
 * @returns {Promise<PokemonInstance>}
 */
async function createPokemon(name, level = 75, types = null, moves = null, baseStats = null, options = {}) {
  const row = await getPokemonRowByName(name);
  if (!row) throw new Error(`Pokemon not found: ${name}`);

  const useTypes = types != null && types.length > 0
    ? types
    : [row.type1, row.type2].filter(Boolean);

  const useBaseStats = baseStats || {
    base_hp: row.base_hp,
    base_attack: row.base_attack,
    base_defense: row.base_defense,
    base_special: row.base_special,
    base_speed: row.base_speed
  };

  let useMoves = moves && moves.length > 0 ? moves : await loadMovesFor(row.pokedex_id);
  useMoves = useMoves.map(m => ({
    ...(typeof m === 'object' && m !== null ? m : {}),
    name: m.name,
    type: m.type || 'normal',
    power: m.power != null ? m.power : 0,
    accuracy: m.accuracy != null ? m.accuracy : 100,
    pp: m.pp != null ? m.pp : 15,
    category: m.category || 'physical',
    damageClass: m.damageClass || m.category || 'physical',
    currentPP: m.currentPP != null ? m.currentPP : (m.pp != null ? m.pp : 15)
  }));

  const stats = calculateStats(useBaseStats, level);

  return new PokemonInstance({
    id: row.id,
    pokedexId: row.pokedex_id,
    name: row.name,
    level,
    types: useTypes,
    stats,
    moves: useMoves
  });
}

/** Preset teams for common powerful variety (Gen 1 OU-style). */
const PRESET_TEAMS = [
  { name: 'Balanced OU', species: ['starmie', 'gengar', 'snorlax', 'tauros', 'zapdos', 'cloyster'] },
  { name: 'Hyper Offense', species: ['tauros', 'alakazam', 'gengar', 'zapdos', 'rhydon', 'chansey'] },
  { name: 'Stall Core', species: ['chansey', 'snorlax', 'articuno', 'zapdos', 'moltres', 'lapras'] },
  { name: 'Rain Dance', species: ['starmie', 'lapras', 'golduck', 'omastar', 'kabutops', 'gengar'] },
  { name: 'Sunny Day', species: ['charizard', 'exeggutor', 'arcanine', 'venusaur', 'flareon', 'rapidash'] },
  { name: 'Classic 6', species: ['charizard', 'blastoise', 'venusaur', 'pikachu', 'snorlax', 'dragonite'] }
];

module.exports = {
  getDb,
  getAllSpecies,
  getSpeciesWithIds,
  createPokemon,
  loadMovesFor,
  getPokemonRowByName,
  GEN1_FINAL_STAGE,
  GEN1_ELIGIBLE,
  PRESET_TEAMS
};
