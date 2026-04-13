class PokemonInstance {
  constructor({ id, pokedexId, name, level, types, stats, moves }) {

    this.species = { id, pokedexId, name, types };

    this.id = id;
    this.pokedexId = pokedexId;
    this.name = name;

    this.level = level || 75;

    this.types = types || [];

    this.stats = { ...stats };

    this.maxHP = stats.hp;
    this.currentHP = stats.hp;

    this.moves = moves || [];

    this.status = null;        // burn, poison, sleep, paralysis, freeze
    this.statusCounter = 0;    // turns for sleep/toxic/etc

    this.statStages = { attack:0, defense:0, special:0, speed:0, accuracy:0, evasion:0 };

    this.recoilQueue = 0;      // for multi-hit or recoil moves
  }

  /* -------------------------
     State Checks
  -------------------------- */

  isAlive() { return this.currentHP > 0; }
  isFainted() { return this.currentHP <= 0; }

  /* -------------------------
     HP Management
  -------------------------- */

  takeDamage(amount) {
    this.currentHP = Math.max(0, this.currentHP - amount);
  }

  heal(amount) {
    this.currentHP = Math.min(this.maxHP, this.currentHP + amount);
  }

  fullHeal() {
    this.currentHP = this.maxHP;
    this.clearStatus();
    this.resetPP();
    this.recoilQueue = 0;
  }

  /* -------------------------
     Move / PP Management
  -------------------------- */

  useMove(moveIndex) {
    const move = this.moves[moveIndex];
    if (!move) throw new Error(`Invalid move index: ${moveIndex}`);
    if (move.currentPP <= 0) throw new Error(`${move.name} has no PP left`);
    move.currentPP -= 1;
    return move;
  }

  resetPP() {
    this.moves.forEach(move => { move.currentPP = move.pp; });
  }

  getAvailableMoves() {
    return this.moves.filter(m => m.currentPP > 0);
  }

  /* -------------------------
     Status Effects
  -------------------------- */

  applyStatus(status, counter = 0) {
    if (this.status) return; // can't stack
    this.status = status;
    this.statusCounter = counter;
  }

  clearStatus() {
    this.status = null;
    this.statusCounter = 0;
  }

  decrementStatus() {
    if (this.statusCounter > 0) this.statusCounter -= 1;
    if (this.statusCounter <= 0 && this.status === 'sleep') this.clearStatus();
  }

  /* -------------------------
     Stat Stage Modifiers
  -------------------------- */

  modifyStat(stat, stages) {
    if (this.statStages.hasOwnProperty(stat)) {
      this.statStages[stat] = Math.max(-6, Math.min(6, this.statStages[stat] + stages));
    }
  }

  getModifiedStat(stat) {
    const stage = this.statStages[stat] || 0;
    const multipliers = [0.25,0.28,0.33,0.4,0.5,0.66,1,1.5,2,2.5,3,3.5,4];
    return this.stats[stat] * multipliers[stage + 6];
  }

  /* -------------------------
     Debug / Logging
  -------------------------- */

  summary() {
    return {
      name: this.name,
      level: this.level,
      hp: `${this.currentHP}/${this.maxHP}`,
      status: this.status,
      moves: this.moves.map(m => ({ name: m.name, pp: `${m.currentPP}/${m.pp}` })),
      statStages: { ...this.statStages }
    };
  }
}

module.exports = PokemonInstance;