// engine/ai.js

function chooseMove(player, activePokemon) {
  return activePokemon.moves[0];
}

module.exports = { chooseMove };