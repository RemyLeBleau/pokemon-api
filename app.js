// app.js
const express = require('express');
const db = require('./db/database');
const Battle = require('./engine/battle/Battle');
const { createPokemon } = require('./engine/pokemonFactory');
const { chooseMove } = require('./engine/ai');
const { createPokemonById } = require('./engine/helpers/pokemonHelpers');

const app = express();

// -------------------------------
// Middleware
// -------------------------------
app.use(express.json()); // parse JSON bodies

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
    if (err) return res.status(500).json({ error: 'Database error', details: err.message });
    res.json(rows);
  });
});

// Get a single Pokémon by ID
app.get('/pokemon/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM pokemon WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error', details: err.message });
    if (!row) return res.status(404).json({ error: 'Pokemon not found' });
    res.json(row);
  });
});

// -------------------------------
// Battle Routes
// -------------------------------

// Start a new battle
app.post('/battle/start', async (req, res) => {
  try {
    const body = req.body || {};
    const { player1Ids, player2Ids, level = 75 } = body;

    if (!player1Ids || !player2Ids || !Array.isArray(player1Ids) || !Array.isArray(player2Ids)) {
      return res.status(400).json({ error: 'player1Ids and player2Ids arrays are required' });
    }

    // Create Pokémon instances for both players
    const p1Pokemon = await Promise.all(player1Ids.map(id => createPokemonById(id, level)));
    const p2Pokemon = await Promise.all(player2Ids.map(id => createPokemonById(id, level)));

    const player1 = { name: 'Player 1', isAI: true, team: { pokemon: p1Pokemon } };
    const player2 = { name: 'Player 2', isAI: true, team: { pokemon: p2Pokemon } };

    const battle = new Battle(player1, player2);
    const battleId = nextBattleId++;
    battles[battleId] = battle;

    res.json({
      battleId,
      message: 'Battle started',
      initialState: battle.getState()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Battle creation failed', details: err.message });
  }
});

// Advance a turn
app.post('/battle/turn', async (req, res) => {
  try {
    const body = req.body || {};
    const { battleId, player1Move, player2Move } = body;

    if (!battleId) return res.status(400).json({ error: 'battleId is required' });

    const battle = battles[battleId];
    if (!battle) return res.status(404).json({ error: 'Battle not found' });

    // If moves are missing, choose AI moves automatically
    const move1 = player1Move || { type: 'move', move: chooseMove(battle.player1, battle.p1Active) };
    const move2 = player2Move || { type: 'move', move: chooseMove(battle.player2, battle.p2Active) };

    const turnResult = battle.processTurn(move1, move2);

    res.json({
      battleId,
      turnResult,
      state: battle.getState()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Turn failed', details: err.message });
  }
});

// -------------------------------
// Helper: Create Pokémon by DB ID (future-ready)
// -------------------------------
async function createPokemonById(id, level) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM pokemon WHERE id = ?', [id], async (err, row) => {
      if (err) return reject(err);
      if (!row) return reject(new Error(`Pokemon ID ${id} not found`));

      // Determine Pokémon types
      const types = row.type2 ? [row.type1, row.type2] : [row.type1];

      // Base stats from DB
      const baseStats = {
        base_hp: row.base_hp,
        base_attack: row.base_attack,
        base_defense: row.base_defense,
        base_special: row.base_special,
        base_speed: row.base_speed
      };

      // Optional placeholders for future mechanics
      const options = {
        status: null,               // Current status effect (burn, freeze, etc.)
        ability: null,              // Placeholder for abilities
        heldItem: null,             // Placeholder for held items
        ivs: {                      // Default IVs (0-15 Gen 1)
          hp: 0, attack: 0, defense: 0, special: 0, speed: 0
        },
        evs: {                      // Default EVs (0-65535 Gen 1)
          hp: 0, attack: 0, defense: 0, special: 0, speed: 0
        },
        evolution: null,            // Placeholder for evolution info
        isShiny: false              // Shiny placeholder
      };

      // Create the Pokémon instance via the factory
      const pokemon = await createPokemon(row.name, level, types, [], baseStats, options);

      resolve(pokemon);
    });
  });
}

module.exports = app;