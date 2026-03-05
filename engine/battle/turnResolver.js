// engine/battle/turnResolver.js
const { calculateDamage, applyDamage, getTypeMultiplier } = require('../damageCalculator');

/**
 * Resolves a single turn of a battle
 * @param {Object} params
 * @param {Battle} params.battle - The battle instance
 * @param {Object} params.action1 - Player 1 action { type: 'move'|'item'|'switch', move/item/switchData }
 * @param {Object} params.action2 - Player 2 action
 * @returns {Object} { events: Array }
 */
function resolveTurn({ battle, action1, action2 }) {
  const events = [];

  const p1Active = battle.p1Active;
  const p2Active = battle.p2Active;

  const p1Speed = p1Active?.stats.speed || 0;
  const p2Speed = p2Active?.stats.speed || 0;

  // Determine move order: speed first, ties favor Player1
  const first = p1Speed >= p2Speed
    ? { player: battle.player1, active: p1Active, action: action1 }
    : { player: battle.player2, active: p2Active, action: action2 };

  const second = first.player === battle.player1
    ? { player: battle.player2, active: p2Active, action: action2 }
    : { player: battle.player1, active: p1Active, action: action1 };

  // Helper: resolve an individual action
  const resolveAction = (actor, target, action) => {
    if (!actor.active || !target) return;

    switch (action.type) {
      case 'move':
        if (!action.move) return;

        const damage = calculateDamage(actor.active, target, action.move);
        const hpBefore = target.currentHP;
        applyDamage(target, damage);

        events.push({
          type: 'move',
          actor: actor.active.name,
          target: target.name,
          move: action.move.name,
          damage,
          hpBefore,
          hpAfter: target.currentHP,
          typeMultiplier: getTypeMultiplier(action.move.type, target.types),
          fainted: target.isFainted?.() || false
        });
        break;

      case 'switch':
        // auto-switch handled in Battle.processTurn
        events.push({
          type: 'switch',
          player: actor.player.name,
          from: actor.active.name,
          to: action.to.name
        });
        break;

      case 'item':
        // Placeholder: future item logic
        events.push({
          type: 'item',
          player: actor.player.name,
          item: action.item.name
        });
        break;

      default:
        events.push({ type: 'none', actor: actor.active?.name || 'unknown' });
        break;
    }
  };

  // Execute first action
  resolveAction(first, second.active, first.action);

  // Second action can only occur if the Pokémon is still alive
  if (second.active && !second.active.isFainted?.()) {
    resolveAction(second, first.active, second.action);
  }

  return { events };
}

module.exports = { resolveTurn };