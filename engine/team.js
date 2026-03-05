// engine/team.js
class Team {
  constructor(pokemonList = []) {
    this.pokemon = pokemonList; // array of PokemonInstance
  }

  getNextAlivePokemon() {
    return this.pokemon.find(p => p.isAlive()) || null;
  }
}

module.exports = Team;