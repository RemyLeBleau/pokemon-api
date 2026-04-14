const readline = require('readline-sync');
const { chooseMove } = require('./ai');

// ---------------- Full Type Chart
const typeChart = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, rock: 2, dark: 2, psychic: 0.5, flying: 0.5, poison: 0.5, bug: 0.5, ghost: 0 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, steel: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2 },
  dragon: { dragon: 2 },
  dark: { psychic: 2, fighting: 0.5, dark: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5 }
};

// ---------------- Type Effectiveness
function getTeamTypeMultiplier(moveType, defenderTypes) {
  let multiplier = 1;
  defenderTypes.forEach(type => {
    if (typeChart[moveType] && typeChart[moveType][type] !== undefined) {
      multiplier *= typeChart[moveType][type];
    }
  });
  return multiplier;
}

// ---------------- Accuracy Stage Multiplier (Gen 1)
function getAccuracyMultiplier(stage) {
  const table = {
    '-6': 3/9, '-5': 3/8, '-4': 3/7,
    '-3': 3/6, '-2': 3/5, '-1': 3/4,
    '0': 1,
    '1': 4/3, '2': 5/3, '3': 6/3,
    '4': 7/3, '5': 8/3, '6': 9/3
  };
  return table[stage] || 1;
}

// ---------------- Accuracy Check
function checkIfMoveHits(attacker, defender, move) {
  if (move.accuracy === undefined || move.accuracy === null) return true;

  const baseAccuracy = move.accuracy / 100;
  const accuracyMod = getAccuracyMultiplier(attacker.statStages.accuracy);
  const evasionMod = getAccuracyMultiplier(defender.statStages.evasion);

  const finalAccuracy = baseAccuracy * (accuracyMod / evasionMod);
  return Math.random() < finalAccuracy;
}

// ---------------- Critical Hit (Gen 1)
function isCriticalHit(attacker, move) {
  let critChance = attacker.stats.speed / 512;
  if (move.highCrit) critChance = attacker.stats.speed / 64;
  return Math.random() < critChance;
}

// ---------------- Damage Formula
function calculateMoveDamage(attacker, defender, move) {
  const critical = isCriticalHit(attacker, move);
  const level = critical ? attacker.level * 2 : attacker.level;

  const attackStat =
    move.damageClass === 'physical'
      ? attacker.stats.attack
      : attacker.stats.special;

  const defenseStat =
    move.damageClass === 'physical'
      ? defender.stats.defense
      : defender.stats.special;

  const base =
    (((2 * level) / 5 + 2) * move.power * (attackStat / defenseStat)) / 50 + 2;

  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const typeMultiplier = getTeamTypeMultiplier(move.type, defender.types);

  const totalDamage = Math.floor(base * stab * typeMultiplier);

  return { damage: totalDamage, critical, typeMultiplier };
}

// ---------------- Switching
function promptSwitch(player, currentActive) {
  console.log("\nChoose Pokémon to switch to:");

  const valid = player.team.pokemon.filter(
    p => p !== currentActive && p.currentHP > 0
  );

  valid.forEach((p, i) => {
    console.log(`${i + 1}. ${p.name} (HP: ${p.currentHP})`);
  });

  const choice = readline.questionInt("Select: ") - 1;
  return valid[choice];
}

// ---------------- Action Selection
function promptAction(player, activePokemon) {
  console.log(`\n${player.name}, choose action for ${activePokemon.name}`);
  console.log("0. Switch Pokémon");

  activePokemon.moves.forEach((move, i) => {
    console.log(`${i + 1}. ${move.name}`);
  });

  const choice = readline.questionInt("Select: ");

  if (choice === 0) return { type: "switch" };

  return {
    type: "move",
    move: activePokemon.moves[choice - 1]
  };
}

// ---------------- Execute Turn
function executeTurn(attacker, defender, move) {
  console.log(`\n${attacker.name} uses ${move.name}!`);

  if (!checkIfMoveHits(attacker, defender, move)) {
    console.log("But it missed!");
    return;
  }

  const result = calculateMoveDamage(attacker, defender, move);

  defender.currentHP = Math.max(0, defender.currentHP - result.damage);

  console.log(`It dealt ${result.damage} damage!`);
  if (result.critical) console.log("Critical hit!");
  if (result.typeMultiplier > 1) console.log("It's super effective!");
  if (result.typeMultiplier > 0 && result.typeMultiplier < 1) console.log("It's not very effective...");
  if (result.typeMultiplier === 0) console.log("It had no effect!");

  console.log(`${defender.name} HP: ${defender.currentHP}/${defender.stats.hp}`);
}

// ---------------- Get Next Alive
function getNextAlivePokemon(team) {
  return team.pokemon.find(p => p.currentHP > 0);
}

// ---------------- Main Battle Loop
function battle(player1, player2) {
  console.log(`\n${player1.name} VS ${player2.name}\n`);

  let p1Active = getNextAlivePokemon(player1.team);
  let p2Active = getNextAlivePokemon(player2.team);

  while (p1Active && p2Active) {
    console.log("\n---------------------------");
    console.log(`${p1Active.name} HP: ${p1Active.currentHP}/${p1Active.stats.hp}`);
    console.log(`${p2Active.name} HP: ${p2Active.currentHP}/${p2Active.stats.hp}`);

    const action1 = player1.isAI
      ? { type: "move", move: chooseMove(player1, p1Active) }
      : promptAction(player1, p1Active);

    const action2 = player2.isAI
      ? { type: "move", move: chooseMove(player2, p2Active) }
      : promptAction(player2, p2Active);

    // Switching resolves first
    if (action1.type === "switch") {
      p1Active = promptSwitch(player1, p1Active);
      console.log(`${player1.name} switched to ${p1Active.name}!`);
    }

    if (action2.type === "switch") {
      p2Active = promptSwitch(player2, p2Active);
      console.log(`${player2.name} switched to ${p2Active.name}!`);
    }

    if (action1.type === "switch" || action2.type === "switch") {
      continue;
    }

    // Speed order
    const first =
      p1Active.stats.speed >= p2Active.stats.speed
        ? { attacker: p1Active, defender: p2Active, move: action1.move }
        : { attacker: p2Active, defender: p1Active, move: action2.move };

    const second =
      first.attacker === p1Active
        ? { attacker: p2Active, defender: p1Active, move: action2.move }
        : { attacker: p1Active, defender: p2Active, move: action1.move };

    executeTurn(first.attacker, first.defender, first.move);

    if (first.defender.currentHP <= 0) {
      console.log(`${first.defender.name} fainted!`);
      if (first.defender === p1Active) p1Active = getNextAlivePokemon(player1.team);
      else p2Active = getNextAlivePokemon(player2.team);
      continue;
    }

    executeTurn(second.attacker, second.defender, second.move);

    if (second.defender.currentHP <= 0) {
      console.log(`${second.defender.name} fainted!`);
      if (second.defender === p1Active) p1Active = getNextAlivePokemon(player1.team);
      else p2Active = getNextAlivePokemon(player2.team);
    }

    if (!p1Active) return console.log(`${player2.name} wins!`);
    if (!p2Active) return console.log(`${player1.name} wins!`);
  }
}

module.exports = {
  battle,
  executeTurn,
  getNextAlivePokemon,
  getTeamTypeMultiplier,
  calculateMoveDamage
};