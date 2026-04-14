function calculateGen1Damage(attacker, defender, move) {
    const level = attacker.level;
    const attack = attacker.attack;
    const defense = defender.defense;
    const power = move.power;

    // Gen 1 damage formula
    const damage = Math.floor(((2 * level / 5 + 2) * power * attack / defense) / 50) + 2;

    return damage;      
}