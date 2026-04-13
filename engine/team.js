class Team {
  constructor(pokemonList = []) {
    // Filter only eligible Pokémon if a flag exists (final stage / stone evolution)
    this.pokemon = pokemonList.filter(p => p).map(p => p);
    this.activeIndex = 0;
  }

  getActivePokemon() {
    return this.pokemon[this.activeIndex] || null;
  }

  hasRemainingPokemon() {
    return this.pokemon.some(p => p.isAlive());
  }

  switchToNextAlive() {
    for (let i = 0; i < this.pokemon.length; i++) {
      if (this.pokemon[i].isAlive()) {
        this.activeIndex = i;
        return this.pokemon[i];
      }
    }
    return null;
  }

  getNextAlivePokemon() {
    return this.switchToNextAlive();
  }

  // Placeholder for deterministic strongest move assignment per team member
  assignStrongestMoves() {
    this.pokemon.forEach(p => {
      // p.moves already contains 3 strongest native + 1 strongest TM
      // This is just a placeholder if future dynamic reordering is needed
      p.moves.sort((a, b) => (b.power * b.accuracy) - (a.power * a.accuracy));
    });
  }
}

module.exports = Team;