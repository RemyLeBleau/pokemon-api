// engine/pokemonInstance.js
class PokemonInstance {
  constructor({ id, name, types, stats, moves }) {
    // species object for Battle references
    this.species = { id, name, types, stats };

    this.id = id;
    this.name = name;
    this.types = types || [];
    this.stats = { ...stats };
    this.currentHP = stats.hp;
    this.maxHP = stats.hp;
    this.moves = moves || [];
    this.status = null;
    this.statusCounter = 0;
  }

  isAlive() { return this.currentHP > 0; }
  isFainted() { return this.currentHP <= 0; }

  takeDamage(amount) {
    this.currentHP = Math.max(0, this.currentHP - amount);
    if (this.currentHP === 0) this.status = 'fainted';
  }

  heal(amount) {
    this.currentHP = Math.min(this.maxHP, this.currentHP + amount);
  }

  resetPP() {
    this.moves.forEach(m => m.currentPP = m.pp);
  }

  applyStatus(status, counter = 0) {
    this.status = status;
    this.statusCounter = counter;
  }

  clearStatus() {
    this.status = null;
    this.statusCounter = 0;
  }
}

module.exports = PokemonInstance;