// services/aiTeams.js
const { buildPokemonInstance, STANDARD_LEVEL } = require('../engine/pokemonInstance');
const { getSpeciesData, getStrategicGen1Moves } = require('../engine/pokemonFactory');

// Example AI team generator (like final trainers)
async function buildAITeam(dexList) {
  // Simple preset team: final trainers / elite 4 style
  const aiTeamSpecies = ['alakazam', 'charizard', 'blastoise', 'venusaur', 'gengar', 'snorlax'];
  const team = [];

  for (let name of aiTeamSpecies) {
    const species = await getSpeciesData(name);
    const moves = await getStrategicGen1Moves(species, STANDARD_LEVEL);
    team.push(buildPokemonInstance(species, STANDARD_LEVEL, moves));
  }

  return team;
}

module.exports = { buildAITeam };