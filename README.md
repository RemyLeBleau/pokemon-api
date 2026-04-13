⚠️ Development Status: Active

This project is under active development. The CLI battle engine is fully functional, user accounts and teams are persisted via SQLite, and a live PvP server using Socket.io has been implemented for multiplayer testing. The Express API layer is still in progress for programmatic access and future frontend integration.

# Rob’s Wild World of Pokémon

## Gen 1 Battle Simulator (Node.js)

A Generation 1 Pokémon battle simulator built in Node.js with SQLite persistence and modular architecture.

The project supports CLI and automated battle simulation, persistent user accounts and teams, and is evolving toward a full Express API battle simulator capable of deterministic battle resolution and real-time PvP.

---

## Features

### Battle Engine
- Generation 1 battle mechanics
- Type effectiveness (full Gen 1 type chart)
- STAB (Same-Type Attack Bonus)
- Critical hit calculations
- Turn-based battle resolution
- Numerical HP tracking
- Deterministic RNG system

### Team & User System
- Create user accounts with hashed passwords
- Save and reload Pokémon teams
- Teams stored persistently via SQLite
- 6-Pokémon team structure

### AI Battles
- AI-controlled trainers
- AI move selection logic
- Automatically generated AI teams
- CLI and automated battle simulation

### PvP Multiplayer
- Live battle server using Socket.io
- Real-time turn-by-turn battle event streaming
- Automatic matchmaking between connected users
- Winner statistics updated persistently

### Persistence
- SQLite database via better-sqlite3
- Users, teams, and battle stats saved between sessions

---

## Tech Stack
- Node.js v22
- SQLite
- Express (API layer)
- Socket.io (real-time PvP)
- better-sqlite3
- axios (PokeAPI data ingestion)
- readline-sync (CLI interaction)
- bcrypt (password hashing)

---

## Project Architecture

```
pokemon-api/
│
├── app.js                # Express application configuration
├── server.js             # Starts PvP server and HTTP endpoints
│
├── data/                 # Data files and preprocessing outputs
│   ├── gen1-clean.json
│   ├── gen1-raw.json
│   └── pokemon.json
│
├── db/
│   ├── database.js       # SQLite connection utilities
│   ├── pokemon.sqlite    # Primary database
│   └── statCalculator.js
│
├── engine/
│   ├── battle/
│   │   ├── Battle.js
│   │   └── turnResolver.js
│   ├── core/
│   │   └── RNG.js        # Deterministic RNG
│   ├── helpers/
│   │   └── pokemonHelpers.js
│   ├── damageCalculator.js
│   ├── pokemonFactory.js
│   ├── pokemonInstance.js
│   ├── team.js
│   ├── testBattle.js     # CLI and automated battle runner
│   └── typeChart.js
│
├── routes/
│   └── pokemon.js        # API endpoints
│
├── scripts/
│   ├── analyzeGen1.js
│   ├── fetchGen1.js
│   └── seedAll.js
│
└── services/
    ├── aiTeams.js
    ├── db.js
    ├── teamService.js
    └── userService.js
```

---

## CLI & Simulation

**Entry point:**  
`engine/testBattle.js`

**Capabilities:**
- User login / creation
- Team selection and persistence
- AI and automated battle simulation
- Turn-by-turn battle output and logging

## Server PvP

**Entry point:**  
`server.js`

**Capabilities:**
- Live real-time battles via Socket.io
- Automatic matchmaking
- Battle events streamed to clients
- Winner stats updated persistently

## API & Socket events

**HTTP**
- `GET /health` — health check (returns `{ ok: true }`); use for load balancers.
- `GET /api/species` — list pickable species (final-stage Gen 1) for team builder.
- `POST /api/team` — set team for a user. Body: `{ username, speciesNames }` (creates user if needed).
- `GET /api/team/:username` — get current team species for a user.

**Socket.io**
- `setTeam` — payload `{ username, speciesNames }`; saves team for that user.
- `joinBattle` — payload `{ username }`; matchmaking, then turn-based battle.
- `chooseMove` — payload `{ moveIndex: 0..3 }`; your move for the current turn.
- Server emits: `battleStart`, `requestMove`, `battleEvents`, `battleState`, `battleFinished`.

---

## Installation

```sh
git clone <repo>
cd pokemon-api
npm install
```

**Run the PvP server:**
```sh
npm start          # production
npm run dev        # development with nodemon
```

**Optional:** Copy `.env.example` to `.env` and set `PORT`, `DB_PATH`, or `NODE_ENV` for deployment.

**Test (smoke check):**
```sh
npm test           # runs 5 sample battles; exits 0 on success
```

**CLI battle (no server):**
```sh
node engine/testBattle.js
```

---

## Database

SQLite database stores:

**Users** (`users` table):  
`id`, `username`, `password_hash`, `total_wins`

**Teams** (`teams` table):  
`id`, `user_id`, `team_name`, `team_json`

---

## Known Issues
- Circular dependency warnings in some modules
- Duplicate damage/type calculation logic in multiple modules
- CLI password input visible (bcrypt hashing implemented in UserManager)
- AI team composition and strategy improvements needed

---

## Roadmap

### Engine Improvements
- Refactor battle engine and turn resolution
- Resolve circular dependencies
- Optimize damage and type calculations

### Security
- Bcrypt password hashing fully implemented
- Hide password input in CLI

### AI Improvements
- Smarter move selection and trainer teams
- More deterministic AI behavior

### API Expansion
- Complete Express battle API
- Persistent battle sessions
- Battle history storage

### Data Expansion
- Full Gen 1 Pokémon database
- Complete move tables

---

## Future Ideas
- Web-based battle interface
- Multiplayer battles
- Replay system
- Competitive battle simulations
- AI vs AI simulation

---

## Deployment

1. **Environment**
   - Set `PORT` (e.g. `3000` or platform default).
   - Set `DB_PATH` to an absolute path if the process cwd differs (e.g. `/app/db/pokemon.sqlite`).
   - Set `NODE_ENV=production` if desired.

2. **Database**
   - Ensure the SQLite file exists at `DB_PATH`. If you use a fresh instance, run the seed first:
     - `node scripts/seedAll.js` (fetches Gen 1 from PokeAPI and fills DB; requires network).

3. **Start**
   - `npm start` (runs `node server.js`).

4. **Health**
   - Hit `GET /health`; 200 + `{ ok: true }` means the app is up. Use this for readiness probes.

5. **Platforms**
   - **Railway / Render / Fly.io:** Set `PORT` from the platform; persist `DB_PATH` on a volume if you need data to survive restarts, or use their persistent disk path.
   - **Docker:** Use `node:22-alpine`, copy app, `npm ci --omit=dev`, expose `PORT`, run `node server.js`; mount a volume for `db/` if you want to keep the SQLite file.

---

## Author

**Rob Hudson**  
Backend developer focused on system architecture, integrations, automation, and backend tooling

GitHub: https://github.com/RemyLeBleau


