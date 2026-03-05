// engine/battle/Battle.js
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
    return {
      turn: this.turn,
      p1Active: this.p1Active?.name,
      p2Active: this.p2Active?.name,
      p1HP: this.p1Active?.currentHP,
      p2HP: this.p2Active?.currentHP,
      winner: this.winner
    };
  }

  canAct(pokemon, events) {
    if (!pokemon || !pokemon.status) return true;

    if (pokemon.status === "sleep") {
      if (pokemon.statusCounter == null) pokemon.statusCounter = this.rng.int(1, 7);
      pokemon.statusCounter--;
      events.push({ type: "sleep", pokemon: pokemon.name });
      if (pokemon.statusCounter <= 0) {
        pokemon.clearStatus();
        events.push({ type: "woke", pokemon: pokemon.name });
        return true;
      }
      return false;
    }

    if (pokemon.status === "freeze") {
      events.push({ type: "freeze", pokemon: pokemon.name });
      return false;
    }

    if (pokemon.status === "paralysis") {
      if (this.rng.int(0, 3) === 0) {
        events.push({ type: "fullPara", pokemon: pokemon.name });
        return false;
      }
    }

    return true;
  }

  applyResiduals(events) {
    const apply = (p) => {
      if (!p || p.isFainted()) return;

      let damage = 0;

      if (p.status === "burn" || p.status === "poison")
        damage = Math.floor(p.stats.hp / 16);

      if (p.status === "toxic") {
        p.statusCounter = (p.statusCounter || 1) + 1;
        damage = Math.floor((p.stats.hp / 16) * p.statusCounter);
      }

      if (damage > 0) {
        const hpBefore = p.currentHP;
        p.takeDamage(damage);

        events.push({
          type: "residual",
          pokemon: p.name,
          damage,
          hpBefore,
          hpAfter: p.currentHP
        });

        if (p.isFainted())
          events.push({ type: "faint", pokemon: p.name });
      }
    };

    apply(this.p1Active);
    apply(this.p2Active);
  }

  resolveMove(attacker, defender, move, events) {
    if (!move || attacker.isFainted() || defender.isFainted()) return;

    // Accuracy check
    if (move.accuracy && this.rng.int(1, 100) > move.accuracy) {
      events.push({
        type: "miss",
        actor: attacker.name,
        move: move.name
      });
      return;
    }

    const hpBefore = defender.currentHP;

    const result = DamageCalculator.calculateDamage(
      attacker,
      defender,
      move,
      this.rng
    );

    DamageCalculator.applyDamage(defender, result.damage);

    events.push({
      type: "move",
      actor: attacker.name,
      target: defender.name,
      move: move.name,
      damage: result.damage,
      crit: result.isCrit,
      effectiveness: result.typeMult,
      hpBefore,
      hpAfter: defender.currentHP
    });

    if (defender.isFainted()) {
      events.push({ type: "faint", pokemon: defender.name });
    }
  }

  processTurn() {
    if (this.isFinished()) return;

    const events = [];

    const move1 = this.p1Active?.moves[0];
    const move2 = this.p2Active?.moves[0];

    let order = [
      { attacker: this.p1Active, defender: this.p2Active, move: move1 },
      { attacker: this.p2Active, defender: this.p1Active, move: move2 }
    ];

    // Speed-based order
    if (this.p2Active.stats.speed > this.p1Active.stats.speed) {
      order.reverse();
    }

    for (const action of order) {
      if (!this.canAct(action.attacker, events)) continue;
      this.resolveMove(action.attacker, action.defender, action.move, events);
    }

    this.applyResiduals(events);

    if (!this.p1Active.isAlive()) {
      this.p1Active = this.player1.team.getNextAlivePokemon();
      if (this.p1Active)
        events.push({ type: "autoSwitch", player: this.player1.name, to: this.p1Active.name });
    }

    if (!this.p2Active.isAlive()) {
      this.p2Active = this.player2.team.getNextAlivePokemon();
      if (this.p2Active)
        events.push({ type: "autoSwitch", player: this.player2.name, to: this.p2Active.name });
    }

    if (!this.p1Active) this.winner = this.player2.name;
    if (!this.p2Active) this.winner = this.player1.name;

    this.turn++;
    return events;
  }

  runBattle() {
    console.log("=== Starting Battle ===");

    while (!this.isFinished()) {
      const events = this.processTurn();

      for (const e of events) {
        if (e.type === "move") {
          let extra = "";
          if (e.crit) extra += " | CRIT!";
          if (e.effectiveness > 1) extra += " | Super Effective!";
          if (e.effectiveness > 0 && e.effectiveness < 1) extra += " | Not Very Effective";

          console.log(
            `[MOVE] ${e.actor} used ${e.move} on ${e.target} | Damage: ${e.damage} | HP: ${e.hpBefore} -> ${e.hpAfter}${extra}`
          );
        }

        if (e.type === "miss") {
          console.log(`[MISS] ${e.actor}'s ${e.move} missed!`);
        }

        if (e.type === "residual") {
          console.log(
            `[RESIDUAL] ${e.pokemon} took ${e.damage} damage | HP: ${e.hpBefore} -> ${e.hpAfter}`
          );
        }

        if (e.type === "faint") {
          console.log(`[FAINT] ${e.pokemon} fainted!`);
        }

        if (e.type === "autoSwitch") {
          console.log(`[SWITCH] ${e.player} switched to ${e.to}`);
        }
      }
    }

    console.log(`=== Battle Finished! Winner: ${this.winner} ===`);
  }
}

module.exports = Battle;