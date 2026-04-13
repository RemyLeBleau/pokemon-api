const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://pokeapi.co/api/v2';
const OUTPUT_PATH = path.resolve(__dirname, '../data/gen1-clean.json');
const VERSION_GROUPS = new Set(['red-blue', 'yellow']);
const LEARN_METHODS = new Set(['level-up', 'machine']);
const GEN1_PHYSICAL_TYPES = new Set([
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost'
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mapGen1Category(moveType, pokeApiDamageClass) {
  if (pokeApiDamageClass === 'status') return 'status';
  return GEN1_PHYSICAL_TYPES.has(moveType) ? 'physical' : 'special';
}

function parseIdFromResourceUrl(url) {
  const m = String(url).match(/\/(\d+)\/?$/);
  return m ? Number(m[1]) : null;
}

function extractBaseStats(pokemonData) {
  const byName = {};
  for (const s of pokemonData.stats) byName[s.stat.name] = s.base_stat;
  return {
    base_hp: byName.hp || 0,
    base_attack: byName.attack || 0,
    base_defense: byName.defense || 0,
    // Strict Gen 1: Special is a single stat. Prefer special-attack as source-of-truth.
    base_special: byName['special-attack'] || byName['special-defense'] || 0,
    base_speed: byName.speed || 0
  };
}

function extractLegalMoveRefs(pokemonData) {
  const out = [];
  for (const m of pokemonData.moves) {
    for (const detail of m.version_group_details) {
      const version = detail.version_group.name;
      const method = detail.move_learn_method.name;
      if (!VERSION_GROUPS.has(version) || !LEARN_METHODS.has(method)) continue;
      out.push({
        move_name: m.move.name,
        source_method: method === 'machine' ? 'tm/hm' : 'level-up',
        level_learned: method === 'level-up' ? detail.level_learned_at : null,
        version_group: version
      });
    }
  }

  // De-dupe by move + source + level, keeping lowest level for level-up.
  const dedup = new Map();
  for (const x of out) {
    const key = `${x.move_name}:${x.source_method}`;
    if (!dedup.has(key)) {
      dedup.set(key, x);
      continue;
    }
    const current = dedup.get(key);
    if (x.source_method === 'level-up') {
      const curLevel = current.level_learned ?? 999;
      const newLevel = x.level_learned ?? 999;
      if (newLevel < curLevel) dedup.set(key, x);
    }
  }
  return [...dedup.values()];
}

function flattenEvolutionChain(node, edges = []) {
  const fromId = parseIdFromResourceUrl(node.species.url);
  for (const child of node.evolves_to || []) {
    const toId = parseIdFromResourceUrl(child.species.url);
    const d = (child.evolution_details && child.evolution_details[0]) || {};
    edges.push({
      from_pokedex_id: fromId,
      to_pokedex_id: toId,
      method: d.trigger?.name || 'unknown',
      level_requirement: d.min_level || null,
      item_requirement: d.item?.name || null,
      notes: [
        d.known_move?.name ? `known_move:${d.known_move.name}` : null,
        d.time_of_day ? `time:${d.time_of_day}` : null,
        d.min_happiness ? `happiness:${d.min_happiness}` : null
      ].filter(Boolean).join('; ') || null
    });
    flattenEvolutionChain(child, edges);
  }
  return edges;
}

async function fetchStrictGen1Dataset() {
  const pokemonRows = [];
  const legalMovesByPokemon = [];
  const evolutionEdgeMap = new Map();
  const neededMoveNames = new Set();

  // HARD FILTER: National Pokedex IDs 1..151.
  for (let id = 1; id <= 151; id++) {
    const [pokemonRes, speciesRes] = await Promise.all([
      axios.get(`${BASE_URL}/pokemon/${id}`),
      axios.get(`${BASE_URL}/pokemon-species/${id}`)
    ]);
    const pokemon = pokemonRes.data;
    const species = speciesRes.data;

    pokemonRows.push({
      pokedex_id: pokemon.id,
      name: pokemon.name,
      type1: pokemon.types[0]?.type?.name || null,
      type2: pokemon.types[1]?.type?.name || null,
      sprite_url: pokemon.sprites?.front_default || null,
      ...extractBaseStats(pokemon)
    });

    const legalRefs = extractLegalMoveRefs(pokemon);
    for (const r of legalRefs) {
      legalMovesByPokemon.push({ pokedex_id: pokemon.id, ...r });
      neededMoveNames.add(r.move_name);
    }

    // Evolutions are explicit DB rows, not inferred at runtime.
    const evoRes = await axios.get(species.evolution_chain.url);
    const edges = flattenEvolutionChain(evoRes.data.chain);
    for (const e of edges) {
      if (
        Number.isInteger(e.from_pokedex_id) &&
        Number.isInteger(e.to_pokedex_id) &&
        e.from_pokedex_id >= 1 && e.from_pokedex_id <= 151 &&
        e.to_pokedex_id >= 1 && e.to_pokedex_id <= 151
      ) {
        const key = `${e.from_pokedex_id}->${e.to_pokedex_id}:${e.method}:${e.level_requirement || ''}:${e.item_requirement || ''}`;
        evolutionEdgeMap.set(key, e);
      }
    }

    if (id % 20 === 0) console.log(`Fetched ${id}/151 species...`);
    await sleep(80);
  }

  const moveDefs = [];
  for (const moveName of [...neededMoveNames].sort()) {
    const { data: move } = await axios.get(`${BASE_URL}/move/${moveName}`);
    // Strict Gen 1 move filter: move must belong to generation-i.
    if (move.generation?.name !== 'generation-i') continue;
    moveDefs.push({
      move_name: move.name,
      type: move.type?.name || 'normal',
      power: move.power ?? 0,
      accuracy: move.accuracy ?? 100,
      pp: move.pp ?? 35,
      category: mapGen1Category(move.type?.name || 'normal', move.damage_class?.name || 'status')
    });
    await sleep(30);
  }

  const allowedMoveNames = new Set(moveDefs.map((m) => m.move_name));
  const filteredLegalMoves = legalMovesByPokemon.filter((x) => allowedMoveNames.has(x.move_name));

  return {
    meta: {
      scope: 'strict-gen1',
      pokedex_filter: [1, 151],
      version_groups: [...VERSION_GROUPS],
      legal_learn_methods: [...LEARN_METHODS]
    },
    pokemon: pokemonRows,
    moves: moveDefs,
    pokemon_legal_moves: filteredLegalMoves,
    evolutions: [...evolutionEdgeMap.values()]
  };
}

async function main() {
  console.log('Fetching strict Gen 1 dataset from PokeAPI...');
  const data = await fetchStrictGen1Dataset();
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
  console.log(`Wrote ${data.pokemon.length} Pokemon, ${data.moves.length} moves, ${data.pokemon_legal_moves.length} legal move links, ${data.evolutions.length} evolution edges`);
  console.log(`Saved to: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});