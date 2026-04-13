const { typeChart } = require('./typeChart');

function getTypeMultiplier(moveType, targetTypes) {
  return targetTypes.reduce(
    (mult, t) => mult * (typeChart[moveType]?.[t] ?? 1),
    1
  );
}

function calculateDamage(attacker, defender, move, rng) {
  if (!move || move.power <= 0) {
    return { damage: 0, isCrit: false, typeMult: 1 };
  }

  const isPhysical = move.damageClass === 'physical';
  const A = attacker.getModifiedStat(isPhysical ? 'attack' : 'special');
  const D = defender.getModifiedStat(isPhysical ? 'defense' : 'special');

  const level = attacker.level || 75;

  // Base Gen1 damage formula
  let base = Math.floor(Math.floor((2 * level / 5 + 2) * move.power * (A / D)) / 50) + 2;

  // STAB
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;

  // Type effectiveness
  const typeMult = getTypeMultiplier(move.type, defender.types);

  // Gen1 crit chance = Speed / 512
  const critChance = (attacker.stats.speed || 1) / 512;
  const critRoll = rng ? rng.int(0, 1000) / 1000 : Math.random();
  const isCrit = critRoll < critChance;
  const crit = isCrit ? 2 : 1;

  // Random factor 217–255 / 255
  const randInt = rng ? rng.int(217, 255) : 217 + Math.floor(Math.random() * 39);
  const randomFactor = randInt / 255;

  let damage = Math.floor(base * stab * typeMult * crit * randomFactor);
  if (damage < 1) damage = 1;

  return { damage, isCrit, typeMult };
}

function applyDamage(target, damage) {
  target.currentHP = Math.max(0, target.currentHP - damage);
}

module.exports = { calculateDamage, applyDamage };