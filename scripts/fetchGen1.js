const axios = require('axios');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://pokeapi.co/api/v2';
const OUTPUT_PATH = path.resolve(__dirname, '../data/gen1-clean.json');

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchGen1() {
  console.log('Fetching Gen 1 species list...');
  const genRes = await axios.get(`${BASE_URL}/generation/1`);
  const speciesList = genRes.data.pokemon_species;

  const pokemonResults = [];

  for (const species of speciesList) {
    console.log(`Fetching ${species.name}...`);

    const speciesRes = await axios.get(species.url);
    const pokemonRes = await axios.get(`${BASE_URL}/pokemon/${species.name}`);
    const evoRes = await axios.get(speciesRes.data.evolution_chain.url);

    const normalized = normalizePokemon(
      pokemonRes.data,
      speciesRes.data,
      evoRes.data
    );

    pokemonResults.push(normalized);

    await delay(150);
  }

  console.log('Collecting unique moves...');
  const uniqueMoveNames = _.uniq(
    pokemonResults.flatMap(p => p.moves.map(m => m.name))
  );

  const moveData = {};

  for (const moveName of uniqueMoveNames) {
    console.log(`Fetching move data: ${moveName}`);
    const moveRes = await axios.get(`${BASE_URL}/move/${moveName}`);

    moveData[moveName] = {
      name: moveRes.data.name,
      power: moveRes.data.power,
      accuracy: moveRes.data.accuracy,
      pp: moveRes.data.pp,
      type: moveRes.data.type.name,
      damage_class: moveRes.data.damage_class.name
    };

    await delay(100);
  }

  const finalPayload = {
    pokemon: pokemonResults,
    moves: moveData
  };

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(finalPayload, null, 2)
  );

  console.log('Gen 1 clean dataset saved.');
}

function normalizePokemon(pokemon, species, evolution) {
  return {
    id: pokemon.id,
    name: pokemon.name,

    stats: pokemon.stats.map(s => ({
      name: s.stat.name,
      base: s.base_stat
    })),

    types: pokemon.types.map(t => t.type.name),

    moves: _.chain(pokemon.moves)
      .map(m => {
        const validVersions = m.version_group_details.filter(v =>
          ['red-blue', 'yellow'].includes(v.version_group.name) &&
          ['level-up', 'machine'].includes(v.move_learn_method.name)
        );

        return validVersions.map(v => ({
          name: m.move.name,
          learn_method: v.move_learn_method.name,
          level: v.level_learned_at,
          version_group: v.version_group.name
        }));
      })
      .flatten()
      .uniqBy(m => `${m.name}-${m.version_group}`)
      .value(),

    growth_rate: species.growth_rate.name,
    capture_rate: species.capture_rate,

    evolutions: flattenEvolution(evolution.chain)
  };
}

function flattenEvolution(chain, parent = null, results = []) {
  const current = chain.species.name;

  if (parent) {
    const details = chain.evolution_details[0] || {};
    results.push({
      from: parent,
      to: current,
      trigger: details.trigger?.name || null,
      min_level: details.min_level || null,
      item: details.item?.name || null
    });
  }

  chain.evolves_to.forEach(next =>
    flattenEvolution(next, current, results)
  );

  return results;
}

fetchGen1().catch(err => {
  console.error(err);
});