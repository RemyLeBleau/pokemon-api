const RNG = require('../core/RNG');
const DamageCalculator = require('../damageCalculator');

class Battle {
  constructor(player1, player2) {
    this.player1 = player1;
    this.player2 = player2;

    this.turn = 1;
    this.p1Active = player1.team.getNextAlivePokemon();
    this.p2Active = player2.team.getNextAlivePokemon();
    this.winner = null;

    this.rng = new RNG(12345);
  }

  isFinished() { return !!this.winner; }

  getState() {
    const moveSummary = (p) => {
      if (!p?.moves?.length) return [];
      return p.moves.map((m, i) => ({ index: i, name: m.name, currentPP: m.currentPP, maxPP: m.pp }));
    };
    return {
      turn: this.turn,
      p1Active: this.p1Active?.name,
      p2Active: this.p2Active?.name,
      p1ActiveId: this.p1Active?.pokedexId,
      p2ActiveId: this.p2Active?.pokedexId,
      p1HP: this.p1Active?.currentHP,
      p1MaxHP: this.p1Active?.stats?.hp,
      p2HP: this.p2Active?.currentHP,
      p2MaxHP: this.p2Active?.stats?.hp,
      p1Moves: moveSummary(this.p1Active),
      p2Moves: moveSummary(this.p2Active),
      winner: this.winner
    };
  }

  canAct(pokemon, events) {
    if (!pokemon || !pokemon.status) return true;

    switch (pokemon.status) {
      case 'sleep':
        if (pokemon.statusCounter == null) pokemon.statusCounter = this.rng.int(1, 7);
        pokemon.statusCounter--;
        events.push({ type: 'sleep', pokemon: pokemon.name });
        if (pokemon.statusCounter <= 0) {
          pokemon.clearStatus();
          events.push({ type: 'woke', pokemon: pokemon.name });
          return true;
        }
        return false;

      case 'freeze':
        events.push({ type: 'freeze', pokemon: pokemon.name });
        return false;

      case 'paralysis':
        if (this.rng.int(0, 3) === 0) {
          events.push({ type: 'fullPara', pokemon: pokemon.name });
          return false;
        }
        break;
    }

    return true;
  }

  applyResiduals(events) {
    [this.p1Active, this.p2Active].forEach(p => {
      if (!p || p.isFainted()) return;

      let damage = 0;
      if (p.status === 'burn' || p.status === 'poison') damage = Math.floor(p.stats.hp / 16);
      if (p.status === 'toxic') {
        p.statusCounter = (p.statusCounter || 1) + 1;
        damage = Math.floor((p.stats.hp / 16) * p.statusCounter);
      }

      if (damage > 0) {
        const hpBefore = p.currentHP;
        p.takeDamage(damage);
        events.push({ type: 'residual', pokemon: p.name, damage, hpBefore, hpAfter: p.currentHP });
        if (p.isFainted()) events.push({ type: 'faint', pokemon: p.name });
      }
    });
  }

  resolveMove(attacker, defender, move, events) {
    if (!move || attacker.isFainted() || defender.isFainted()) return;

    // Accuracy check
    if (move.accuracy && this.rng.int(1, 100) > move.accuracy) {
      events.push({ type: 'miss', actor: attacker.name, move: move.name });
      return;
    }

    const hpBefore = defender.currentHP;
    const result = DamageCalculator.calculateDamage(attacker, defender, move, this.rng);
    DamageCalculator.applyDamage(defender, result.damage);

    events.push({
      type: 'move',
      actor: attacker.name,
      target: defender.name,
      move: move.name,
      damage: result.damage,
      crit: result.isCrit,
      effectiveness: result.typeMult,
      attackerSpeed: attacker.stats?.speed,
      hpBefore,
      hpAfter: defender.currentHP
    });

    if (defender.isFainted()) events.push({ type: 'faint', pokemon: defender.name });
  }

  getRandomMove(pokemon) {
    if (!pokemon || !pokemon.moves || pokemon.moves.length === 0) return null;
    const available = pokemon.moves.filter(m => m.currentPP > 0);
    return available.length > 0 ? available[Math.floor(Math.random() * available.length)] : pokemon.moves[0];
  }

  /** Get move by index (0-based). Returns null if invalid or no PP. */
  getMoveByIndex(pokemon, moveIndex) {
    if (!pokemon?.moves?.length || moveIndex == null || moveIndex < 0) return null;
    const move = pokemon.moves[moveIndex];
    if (!move || move.currentPP <= 0) return null;
    return move;
  }

  /**
   * Run one turn. Accepts explicit move choices for PvP, or no args for random (e.g. AI).
   * @param {object} [p1Choice] - { type: 'move', moveIndex: 0..3 }. If invalid, falls back to random.
   * @param {object} [p2Choice] - Same for player 2.
   * @returns {object[]} events
   */
  processTurn(p1Choice, p2Choice) {
    if (this.isFinished()) return [];
    const events = [];

    if (!this.p1Active || !this.p2Active) {
      if (!this.p1Active) this.winner = this.player2.name;
      if (!this.p2Active) this.winner = this.player1.name;
      return events;
    }

    let move1 = null;
    let move2 = null;
    if (p1Choice?.type === 'move' && typeof p1Choice.moveIndex === 'number') {
      move1 = this.getMoveByIndex(this.p1Active, p1Choice.moveIndex);
    }
    if (p2Choice?.type === 'move' && typeof p2Choice.moveIndex === 'number') {
      move2 = this.getMoveByIndex(this.p2Active, p2Choice.moveIndex);
    }
    if (!move1) move1 = this.getRandomMove(this.p1Active);
    if (!move2) move2 = this.getRandomMove(this.p2Active);

    let order = [
      { attacker: this.p1Active, defender: this.p2Active, move: move1 },
      { attacker: this.p2Active, defender: this.p1Active, move: move2 }
    ];

    const p1Speed = this.p1Active?.stats?.speed ?? 0;
    const p2Speed = this.p2Active?.stats?.speed ?? 0;
    if (p2Speed > p1Speed) order.reverse();

    for (const action of order) {
      if (!this.canAct(action.attacker, events)) continue;
      this.resolveMove(action.attacker, action.defender, action.move, events);
      if (action.move) action.move.currentPP -= 1;
    }

    this.applyResiduals(events);

    if (!this.p1Active || !this.p1Active.isAlive()) {
      this.p1Active = this.player1.team.getNextAlivePokemon();
      if (this.p1Active) events.push({ type: 'autoSwitch', player: this.player1.name, to: this.p1Active.name });
    }
    if (!this.p2Active || !this.p2Active.isAlive()) {
      this.p2Active = this.player2.team.getNextAlivePokemon();
      if (this.p2Active) events.push({ type: 'autoSwitch', player: this.player2.name, to: this.p2Active.name });
    }

    if (!this.p1Active) this.winner = this.player2.name;
    if (!this.p2Active) this.winner = this.player1.name;

    this.turn++;
    return events;
  }

  runBattle() {
    console.log('=== Starting Battle ===');
    while (!this.isFinished()) {
      const events = this.processTurn();
      for (const e of events) {
        switch (e.type) {
          case 'move': {
            let extra = '';
            if (e.crit) extra += ' | CRIT!';
            if (e.effectiveness > 1) extra += ' | Super Effective!';
            if (e.effectiveness > 0 && e.effectiveness < 1) extra += ' | Not Very Effective';
            console.log(`[MOVE] ${e.actor} used ${e.move} on ${e.target} | Damage: ${e.damage} | HP: ${e.hpBefore} -> ${e.hpAfter}${extra}`);
            break;
          }
          case 'miss': console.log(`[MISS] ${e.actor}'s ${e.move} missed!`); break;
          case 'residual': console.log(`[RESIDUAL] ${e.pokemon} took ${e.damage} damage | HP: ${e.hpBefore} -> ${e.hpAfter}`); break;
          case 'faint': console.log(`[FAINT] ${e.pokemon} fainted!`); break;
          case 'autoSwitch': console.log(`[SWITCH] ${e.player} switched to ${e.to}`); break;
        }
      }
    }
    console.log(`=== Battle Finished! Winner: ${this.winner} ===`);
  }
}

module.exports = Battle;