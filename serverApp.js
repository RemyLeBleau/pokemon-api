/* ---------------- External Libraries ---------------- */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

/* ---------------- Local Modules ---------------- */

const config = require('./config');
const PokemonFactory = require('./engine/pokemonFactory');
const Team = require('./engine/team');
const Battle = require('./engine/battle/Battle');
const UserManager = require('./engine/userManager');
const MatchmakingQueue = require('./services/matchmakingQueue');

/// ---------------- Express App Setup ---------------- ///
const app = express();      // ← MUST COME FIRST
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());    // ← now this works
 

if (config.isDevelopment) {
  console.log('Dev mode enabled');
}

// Sessions (required for Passport Google OAuth)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.use(passport.initialize());
app.use(passport.session());

// Static front end (ROM-style PvP client)
app.use(express.static('public'));

// ---------- Passport / Google OAuth ----------
// Only configure Google OAuth if credentials are provided.
// callbackURL must match an "Authorized redirect URI" in Google Cloud (full URL, not a path).
const googleCallbackURL =
  process.env.GOOGLE_CALLBACK_URL ||
  `http://localhost:${config.PORT}/auth/google/callback`;

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: googleCallbackURL
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email = profile.emails && profile.emails[0] && profile.emails[0].value;
        const displayName = profile.displayName;
        const user = await UserManager.findOrCreateGoogleUser(googleId, email, displayName);
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  ));
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await UserManager.findById(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

// ---------- Health ----------
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'pokemon-pvp' });
});

app.get('/api/auth/google-enabled', (req, res) => {
  res.json({ enabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: { id: req.user.id, username: req.user.username, email: req.user.email || null } });
});

// ---------- Debug Route (Demo for VS Code Auto-Update) ----------
app.get('/api/debug/ping', (req, res) => {
  res.json({
    message: 'pong',
    timestamp: Date.now(),
    status: 'server is alive'
  });
});

// ---------- Auth (for front end login) ----------
/** POST /api/register - Body: { username, password } */
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const user = await UserManager.register(username, password);
    res.json({ ok: true, username: user.username });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Registration failed' });
  }
});

/** POST /api/login - Body: { username, password } */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const user = await UserManager.login(username, password);
    res.json({ ok: true, username: user.username });
  } catch (err) {
    res.status(401).json({ error: err.message || 'Invalid credentials' });
  }
});

// ---------- Google OAuth routes ----------
// Only add OAuth routes if Google OAuth is configured
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  // Start OAuth with Google
  app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  // OAuth callback URL (set GOOGLE_CALLBACK_URL accordingly in env for prod)
  app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
      // On success, user is in req.user (session). Redirect to front end.
      res.redirect('/');
    }
  );
}

// ---------- Team builder API ----------
/** GET /api/species - list pickable species with pokedex id (for sprites) */
app.get('/api/species', async (req, res) => {
  try {
    const species = await PokemonFactory.getSpeciesWithIds();
    res.json({ species });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/presets - preset powerful variety teams */
app.get('/api/presets', (req, res) => {
  res.json({ presets: require('./engine/pokemonFactory').PRESET_TEAMS });
});

/** POST /api/team - requires auth: set team for logged-in user. Body: { username, password, speciesNames } */
app.post('/api/team', async (req, res) => {
  try {
    const { username, password, speciesNames, teamName } = req.body || {};
    const user = req.user || (username && password ? await UserManager.login(username, password) : null);
    if (!user) return res.status(401).json({ error: 'username/password or OAuth session required' });
    if (!Array.isArray(speciesNames) || speciesNames.length > 6) {
      return res.status(400).json({ error: 'speciesNames array required (max 6)' });
    }
    const team = await buildTeamFromSpecies(speciesNames);
    await UserManager.saveTeam(user.id, team.pokemon, teamName);
    res.json({ ok: true, username: user.username, teamSize: team.pokemon.length, teamName: (teamName && String(teamName).trim()) || 'My team' });
  } catch (err) {
    res.status(err.message === 'Invalid password' || err.message === 'User not found' ? 401 : 400).json({ error: err.message });
  }
});

/** GET /api/me/stats - get current user's stats. Query: ?username=&password= (or use session when OAuth) */
app.get('/api/me/stats', async (req, res) => {
  try {
    const { username, password } = req.query || {};
    if (!username || !password) return res.status(401).json({ error: 'username and password required' });
    const user = await UserManager.login(username, password);
    const usage = await new Promise((resolve, reject) => {
      const db = require('./db/database');
      db.all(
        `SELECT species_name, battles_played, wins_with, total_damage_done, total_damage_taken
         FROM user_pokemon_usage WHERE user_id = ? ORDER BY battles_played DESC LIMIT 20`,
        [user.id],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });
    res.json({
      username: user.username,
      totalWins: user.total_wins,
      totalLosses: user.total_losses,
      totalMatches: user.total_matches,
      rating: user.rating,
      topPokemon: usage
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

/** POST /api/me/team - get current user's team. Body: { username, password } */
app.post('/api/me/team', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = req.user || (username && password ? await UserManager.login(username, password) : null);
    if (!user) return res.status(401).json({ error: 'username/password or OAuth session required' });
    const teamData = await UserManager.loadTeam(user.id);
    const species = teamData?.pokemon?.length ? teamData.pokemon.map((p) => p.name) : [];
    res.json({ username: user.username, species, teamName: teamData?.teamName || 'My team' });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ---------- Battle rooms: turn-based PvP ----------
const matchmakingQueue = new MatchmakingQueue(io);

function getBattleId(socket) {
  return socket.data.battleId;
}

// ---------- Socket.IO handlers ----------
io.on('connection', socket => {
  console.log(`User connected: ${socket.id}`);

  /** Login: set socket.data.user for subsequent setTeam / joinBattle. Payload: { username, password } */
  socket.on('login', async ({ username, password }) => {
    try {
      if (!username) {
        socket.emit('loginResult', { ok: false, error: 'username required' });
        return;
      }
      let user;
      if (password) {
        user = await UserManager.login(username, password);
      } else {
        user = await UserManager.findByUsername(username);
        if (!user) throw new Error('User not found');
      }
      socket.data.user = { id: user.id, username: user.username, rating: user.rating };
      socket.emit('loginResult', { ok: true, username: user.username });
    } catch (err) {
      socket.emit('loginResult', { ok: false, error: err.message });
    }
  });

  /** Set team (must be logged in). Payload: { speciesNames, teamName? } */
  socket.on('setTeam', async ({ speciesNames, teamName }) => {
    try {
      const user = socket.data.user;
      if (!user) {
        socket.emit('error', 'Login first');
        return;
      }
      if (!Array.isArray(speciesNames) || speciesNames.length > 6) {
        socket.emit('error', 'speciesNames array required (max 6)');
        return;
      }
      const team = await buildTeamFromSpecies(speciesNames);
      await UserManager.saveTeam(user.id, team.pokemon, teamName);
      socket.emit('setTeamResult', { ok: true, teamSize: team.pokemon.length });
    } catch (err) {
      socket.emit('error', err.message);
    }
  });

  /** Join matchmaking queue (must be logged in). Optional payload: { speciesNames } (3–6) from client memory; else saved team from DB. */
  socket.on('joinBattle', async (payload = {}) => {
    try {
      const user = socket.data.user;
      if (!user) {
        socket.emit('error', 'Login first');
        return;
      }

      if (socket.data.inQueue) {
        socket.emit('error', 'Already in queue');
        return;
      }

      if (socket.data.inBattle) {
        socket.emit('error', 'Already in battle');
        return;
      }

      const sn = payload.speciesNames;
      const PokemonInstance = require('./engine/pokemonInstance');
      let team;

      if (Array.isArray(sn) && sn.length >= 3 && sn.length <= 6) {
        const built = await buildTeamFromSpecies(sn);
        team = built;
      } else {
        let teamData = await UserManager.loadTeam(user.id);
        if (!teamData || !teamData.pokemon?.length) {
          team = await generateRandomTeam();
          await UserManager.saveTeam(user.id, team.pokemon, teamData?.teamName);
        } else {
          const reconstructed = teamData.pokemon.map((p) => new PokemonInstance(p));
          reconstructed.forEach((p) => p.fullHeal?.());
          team = new Team(reconstructed);
        }
      }

      matchmakingQueue.addPlayer(socket, user, team);
      socket.emit('queueJoined', { message: 'Joined matchmaking queue' });
      
    } catch (err) {
      console.error(err);
      socket.emit('error', err.message);
    }
  });

  /** Leave matchmaking queue */
  socket.on('leaveBattle', () => {
    if (socket.data.inQueue) {
      matchmakingQueue.removePlayer(socket.id);
      socket.emit('queueLeft', { message: 'Left matchmaking queue' });
    }
  });

  /** Player sends move choice: { moveIndex: 0..3 } */
  socket.on('chooseMove', (payload) => {
    const battleId = getBattleId(socket);
    if (!battleId) return socket.emit('error', 'Not in a battle');
    
    const moveIndex = payload?.moveIndex;
    if (typeof moveIndex !== 'number' || moveIndex < 0 || moveIndex > 3) {
      socket.emit('error', 'Invalid moveIndex (0-3)');
      return;
    }

    const choice = { type: 'move', moveIndex };
    matchmakingQueue.processTurn(battleId, socket, choice);
  });

  /** Spectate a battle */
  socket.on('spectateBattle', ({ battleId }) => {
    if (!battleId) {
      // Send list of active battles
      const activeBattles = matchmakingQueue.getActiveBattles();
      socket.emit('battleList', activeBattles);
      return;
    }

    matchmakingQueue.addSpectator(battleId, socket);
  });

  /** Stop spectating */
  socket.on('stopSpectating', () => {
    if (socket.data.spectating) {
      matchmakingQueue.removeSpectator(socket.data.spectating, socket);
      socket.emit('spectateStopped', { message: 'Stopped spectating' });
    }
  });

  /** Handle disconnection */
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    matchmakingQueue.handleDisconnect(socket);
  });

  /** Get current queue status */
  socket.on('getQueueStatus', () => {
    const status = {
      playersInQueue: matchmakingQueue.waitingPlayers.size,
      activeBattles: matchmakingQueue.activeBattles.size,
      averageWaitTime: matchmakingQueue.calculateAverageWaitTime(),
      onlinePlayers: matchmakingQueue.getOnlinePlayerCount()
    };
    socket.emit('queueStatus', status);
  });

  /** Get queue list (for admin/visibility) */
  socket.on('getQueueList', () => {
    const queueList = matchmakingQueue.getQueueList();
    socket.emit('queueList', queueList);
  });
});

async function buildTeamFromSpecies(speciesNames) {
  const pokemonInstances = [];
  for (const name of speciesNames) {
    const pkmn = await PokemonFactory.createPokemon(name);
    pokemonInstances.push(pkmn);
  }
  return new Team(pokemonInstances);
}

async function generateRandomTeam(teamSize = 3) {
  const allSpecies = await PokemonFactory.getAllSpecies({ finalStageOnly: true });
  const shuffled = [...allSpecies].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, teamSize);
  const pokemonInstances = [];
  for (const name of selected) {
    const pkmn = await PokemonFactory.createPokemon(name);
    pokemonInstances.push(pkmn);
  }
  return new Team(pokemonInstances);
}

const { PORT } = config;
server.listen(PORT, () => console.log(`PvP server running on http://localhost:${PORT}`));

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);