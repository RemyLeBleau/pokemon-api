// engine/testBattle.js
const PokemonFactory = require('./pokemonFactory');
const Team = require('./team');
const Battle = require('./battle/Battle');

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function generateRandomTeam(teamSize = 3) {
  const allSpecies = await PokemonFactory.getAllSpecies();

  const selected = [];
  while (selected.length < teamSize) {
    const name = getRandom(allSpecies);
    if (!selected.includes(name)) {
      selected.push(name);
    }
  }

  const pokemonInstances = [];
  for (const name of selected) {
    const pkmn = await PokemonFactory.createPokemon(name);
    pokemonInstances.push(pkmn);
  }

  return new Team(pokemonInstances);
}

async function main() {
  const team1 = await generateRandomTeam();
  const team2 = await generateRandomTeam();

  const player1 = {
    name: "Red",
    team: team1
  };

  const player2 = {
    name: "Blue",
    team: team2
  };

  const battle = new Battle(player1, player2);

  battle.runBattle();
}

main().catch(console.error);