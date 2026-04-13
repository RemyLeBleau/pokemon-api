const Team = require('./team');
const Battle = require('./battle/Battle');
const PokemonFactory = require('./pokemonFactory');
const UserManager = require('./userManager');

async function generateRandomTeam(teamSize = 3) {
  // Request only final-stage Pokémon or special cases like Pikachu
  const allSpecies = await PokemonFactory.getAllSpecies({ finalStageOnly: true });

  const shuffled = [...allSpecies].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, teamSize);

  const pokemonInstances = [];
  for (const name of selected) {
    const pkmn = await PokemonFactory.createPokemon(name);
    pokemonInstances.push(pkmn);
  }

  return new Team(pokemonInstances);
}

async function main() {
  try {
    // Register or login a user
    const user = await UserManager.register('testuser', 'password123')
      .catch(() => UserManager.login('testuser', 'password123'));

    // Load or generate team for user
    let teamData = await UserManager.loadTeam(user.id);
    let team;
    if (!teamData || !teamData.pokemon?.length) {
      team = await generateRandomTeam();
      await UserManager.saveTeam(user.id, team.pokemon);
    } else {
      const PokemonInstance = require('./pokemonInstance');
      const reconstructed = teamData.pokemon.map((p) => new PokemonInstance(p));
      team = new Team(reconstructed);
    }

    // Generate an AI/random opponent team
    const aiTeam = await generateRandomTeam();

    const player1 = { name: user.username, team };
    const player2 = { name: 'Blue', team: aiTeam };

    const battle = new Battle(player1, player2);
    battle.runBattle();

    // Increment win if user wins
    if (battle.winner === user.username) {
      await UserManager.incrementWin(user.id);
    }
  } catch (e) {
    console.error(e);
  }
}

main();