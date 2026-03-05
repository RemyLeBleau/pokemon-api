const typeChart = require('./typeChart');

function getTypeMultiplier(moveType, targetTypes) {
  return targetTypes.reduce(
    (mult, t) => mult * (typeChart[moveType]?.[t] ?? 1),
    1
  );
}

function calculateDamage(attacker, defender, move, rng) {
  if (!move || move.power <= 0) return 0;

  const isPhysical = move.damageClass === 'physical';
  const A = isPhysical ? attacker.stats.attack : attacker.stats.special;
  const D = isPhysical ? defender.stats.defense : defender.stats.special;

  const level = attacker.level;

  const base =
    Math.floor(
      Math.floor((2 * level / 5 + 2) * move.power * (A / D)) / 50
    ) + 2;

  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const typeMult = getTypeMultiplier(move.type, defender.types);

  const critChance = attacker.stats.speed / 512;
  const isCrit = Math.random() < critChance;
  const crit = isCrit ? 2 : 1;

  const randomFactor = (217 + Math.floor(Math.random() * 39)) / 255;

  return {
    damage: Math.floor(base * stab * typeMult * crit * randomFactor),
    isCrit,
    typeMult
  };
}

function applyDamage(target, damage) {
  target.currentHP = Math.max(0, target.currentHP - damage);
}

module.exports = { calculateDamage, applyDamage };