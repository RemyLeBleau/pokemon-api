// app.js
const express = require('express');
const db = require('./db/database');
const Battle = require('./engine/battle/Battle');
const { createPokemonById } = require('./engine/helpers/pokemonHelpers');

const app = express();

function chooseMove(player, pokemon) {
  if (!pokemon || !pokemon.moves || pokemon.moves.length === 0) {
    return null;
  }

  // Simple temporary AI: always choose first available move
  return pokemon.moves[0];
}

// -------------------------------
// Middleware
// -------------------------------
app.use(express.json());

// -------------------------------
// In-memory Battle Storage
// -------------------------------
const battles = {};
let nextBattleId = 1;

// -------------------------------
// Pokémon Routes
// -------------------------------

// Get all Pokémon
app.get('/pokemon', (req, res) => {
  db.all('SELECT * FROM pokemon', [], (err, rows) => {
    if (err) {
      return res.status(500).json({
        error: 'Database error',
        details: err.message
      });
    }

    res.json(rows);
  });
});

// Get Pokémon by ID
app.get('/pokemon/:id', (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid pokemon id' });
  }

  db.get('SELECT * FROM pokemon WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({
        error: 'Database error',
        details: err.message
      });
    }

    if (!row) {
      return res.status(404).json({ error: 'Pokemon not found' });
    }

    res.json(row);
  });
});

// -------------------------------
// Battle Routes
// -------------------------------

// Start a battle
app.post('/battle/start', async (req, res) => {
  try {
    const { player1Ids, player2Ids, level = 75 } = req.body;

    if (!Array.isArray(player1Ids) || !Array.isArray(player2Ids)) {
      return res.status(400).json({
        error: 'player1Ids and player2Ids arrays are required'
      });
    }

    if (player1Ids.length > 6 || player2Ids.length > 6) {
      return res.status(400).json({
        error: 'Maximum team size is 6 Pokémon'
      });
    }

    const p1Pokemon = await Promise.all(
      player1Ids.map(id => createPokemonById(id, level))
    );

    const p2Pokemon = await Promise.all(
      player2Ids.map(id => createPokemonById(id, level))
    );

    const player1 = {
      name: 'Player 1',
      isAI: true,
      team: { pokemon: p1Pokemon }
    };

    const player2 = {
      name: 'Player 2',
      isAI: true,
      team: { pokemon: p2Pokemon }
    };

    const battle = new Battle(player1, player2);

    const battleId = nextBattleId++;
    battles[battleId] = battle;

    console.log(`Battle ${battleId} started`);

    res.json({
      battleId,
      message: 'Battle started',
      initialState: battle.getState()
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Battle creation failed',
      details: err.message
    });
  }
});

// Advance battle turn
app.post('/battle/turn', async (req, res) => {
  try {
    const { battleId, player1Move, player2Move } = req.body;

    const id = Number(battleId);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: 'Invalid battleId'
      });
    }

    const battle = battles[id];

    if (!battle) {
      return res.status(404).json({
        error: 'Battle not found'
      });
    }

    const move1Obj = player1Move?.move ?? chooseMove(battle.player1, battle.p1Active);
    const move2Obj = player2Move?.move ?? chooseMove(battle.player2, battle.p2Active);
    const idx1 = battle.p1Active?.moves?.findIndex(m => m === move1Obj) ?? 0;
    const idx2 = battle.p2Active?.moves?.findIndex(m => m === move2Obj) ?? 0;
    const turnResult = battle.processTurn(
      { type: 'move', moveIndex: Math.max(0, idx1) },
      { type: 'move', moveIndex: Math.max(0, idx2) }
    );

    console.log(`Battle ${id} turn processed`);

    res.json({
      battleId: id,
      turnResult,
      state: battle.getState()
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Turn failed',
      details: err.message
    });
  }
});

// -------------------------------

module.exports = app;