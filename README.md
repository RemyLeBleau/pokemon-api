# Gen 1 Pokémon PvP (Node.js)

A **Generation 1** Pokémon battle stack: deterministic battle engine, SQLite-backed users and teams, Express + Socket.io server, and a **static web client** (GameBoy-style UI) for lobby, team building, and PvP.

---

## Current State

- **Backend**
  - National Dex **1–151** only; fetch/seed pipeline produces cleaned JSON and fills SQLite (species, moves, legal move links, evolutions).
  - **Battle engine** (`engine/battle/Battle.js`, damage calculator, type chart, RNG) runs the same turn logic for CLI sims and live PvP.
  - **Users / teams / stats** via `engine/userManager.js` (bcrypt passwords, optional Google account link, ELO-style rating fields, battle and per-species usage records).

- **Server**
  - **`server.js`** / **`serverApp.js`**: on startup, ensures Gen 1 battle tables in SQLite are populated from committed **`data/gen1-clean.json`** if the DB is missing or incomplete (no PokeAPI call). Then static `public/`, REST auth and team APIs, Passport Google OAuth when configured, Socket.io matchmaking and battles.

- **Frontend**
  - **Mid-refactor / in progress**: screen flow (`boot` → `auth` → `lobby` / `team` → `battle`), sprite grid + slot team builder (no dropdown team UI), lobby stats, queue UI, battle field + move buttons + matrix-style event log, optional spectate list inside lobby.
  - Socket login, `joinBattle` with optional in-memory `speciesNames` or server-stored team, move pick timeout defaulting to move slot 0.

---

## Design Goal

- **Single source of truth for combat**: engine resolves turns from explicit move indices; server does not reimplement damage formulas for PvP.
- **Gen 1 fidelity** within the scope of the implemented ruleset (type effectiveness, STAB, crits, status/speed order as coded—not a full Showdown port).
- **Thin client**: browser sends choices; state and resolution stay on the server.

---

## Looking for Feedback

- Battle **feel** (pace, clarity of whose turn, timeout length).
- **Matchmaking** behavior (queue visibility, errors when port/socket conflicts, two-player test flow).
- **Team builder** usability (dex search, presets, save vs queue-without-save).
- Engine or **data** bugs (wrong move lists, damage edge cases) with repro steps.

---

## Not Looking for Feedback Yet

- Pixel-art parity with official games, animation systems, or asset pipelines.
- Generations beyond Gen 1, ranked ladders, or production security hardening.
- Mobile layout polish (layout targets desktop/small desktop first).

---

## Run Locally

**Testers (typical):** clone, install, run — no fetch/seed required if **`data/gen1-clean.json`** is in the repo (it is). The server creates or repairs the SQLite file at **`DB_PATH`** using that JSON on first start.

```sh
git clone <repo-url>
cd pokemon-api
npm install
npm run dev
```

Open **`http://localhost:3000`** (or the port set in `.env`).

**Developers refreshing data from PokeAPI** (network; not part of normal tester flow):

```sh
npm run fetch:gen1
npm run seed
```

`npm run seed` is still available for a **full reset** of Gen 1 tables from `gen1-clean.json` without starting the app.

Smoke test (headless sample battles):

```sh
npm test
```

---

## Environment

Copy **`.env.example`** to **`.env`** and adjust as needed.

| Variable | Role |
|----------|------|
| `PORT` | HTTP/Socket.io port (default `3000`). |
| `DB_PATH` | SQLite file path (default `db/pokemon.sqlite`). |
| `NODE_ENV` | `development` / `production`. |
| `SESSION_SECRET` | Session cookie signing (set in production). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Google OAuth; omit both to disable. |
| `GOOGLE_CALLBACK_URL` | Full redirect URI for Google (default `http://localhost:<PORT>/auth/google/callback`). |
| `MOVE_TURN_MS` | PvP move pick timeout in ms (default `45000`). |

---

## Features

- **Engine**: Turn-based resolution, move accuracy, damage + crit + STAB + type multiplier, fainting and auto-switch to next living party member, residual damage (burn/poison/toxic), sleep/freeze/paralysis gates as implemented.
- **Data**: Gen 1 species and moves live in SQLite; runtime always reads SQLite. Committed JSON seeds the DB on startup or via `npm run seed`; `fetch:gen1` is for maintenance only.
- **Accounts**: Register/login over HTTP; session + optional Google OAuth; team name + species list persisted.
- **PvP**: Matchmaking queue, paired battle room, simultaneous move selection with server-side timeout, events streamed to clients; spectator hook for active battles.
- **Client**: Lobby metrics, team screen, battle UI with HP and move PP.

---

## Tech Stack

- **Runtime**: Node.js (see `package.json`).
- **Server**: Express 5, `express-session`, Passport + `passport-google-oauth20` (optional), Socket.io.
- **Database**: `sqlite3` driver, single file SQLite (`db/database.js` → `config.DB_PATH`).
- **Auth**: bcrypt (`engine/userManager.js`).
- **Client**: Static HTML/CSS/JS under `public/` (no bundler in repo).
- **Data ingestion**: `axios` / `node-fetch`, scripts under `scripts/`.

---

## Project Architecture

```
pokemon-api/
├── server.js              # Entry: dotenv, ensure Gen 1 SQLite from JSON, then load serverApp
├── serverApp.js           # Express, session, Passport, Socket.io, static public/
├── config.js              # PORT, DB_PATH, MOVE_TURN_MS
├── db/gen1Seed.js         # Shared Gen 1 seed / ensure logic (JSON → SQLite)
├── app.js                 # Legacy Express demo (not the PvP entry point)
├── public/                # Web client (index.html, app.js, style.css)
├── engine/
│   ├── battle/Battle.js   # Turn loop, move resolution
│   ├── damageCalculator.js
│   ├── typeChart.js
│   ├── pokemonFactory.js / pokemonInstance.js / team.js
│   ├── userManager.js     # DB access for users, teams, battles, usage
│   └── testBattle.js      # CLI-oriented battle runner
├── services/
│   └── matchmakingQueue.js
├── db/
│   ├── database.js        # sqlite3 connection
│   └── pokemon.sqlite     # Created by seed (path configurable)
├── scripts/
│   ├── fetchGen1.js
│   ├── seedAll.js
│   ├── runSampleBattles.js / runDamageSim.js / validateGen1Engine.js
│   └── pvpClient.js       # Minimal Socket.io client for testing
├── routes/pokemon.js      # Present in repo; not mounted by server.js (legacy / reference)
└── data/                  # JSON inputs/outputs for Gen 1 pipeline
```

---

## Core Flow

1. **Data**: `npm run fetch:gen1` → raw/clean JSON; `npm run seed` → SQLite.
2. **Server**: Loads env, opens DB, serves `public/`, accepts HTTP + WebSocket.
3. **User**: Register or login (or OAuth); socket `login` attaches `socket.data.user`.
4. **Team**: Build species list in UI; `POST /api/team` persists; or rely on DB when queuing.
5. **Queue**: `joinBattle` with optional `{ speciesNames }` (3–6) or empty payload for saved team.
6. **Battle**: Both players choose moves per turn; engine emits events; HP and win condition updated on server.

---

## API and Socket Overview

### HTTP (selected)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/health` | `{ ok: true, service: 'pokemon-pvp' }` |
| `GET` | `/api/auth/google-enabled` | `{ enabled: boolean }` |
| `GET` | `/api/me` | Current session user (OAuth) or 401 |
| `POST` | `/api/register` | `{ username, password }` |
| `POST` | `/api/login` | `{ username, password }` |
| `GET` | `/api/species` | Pickable species + dex ids for sprites |
| `GET` | `/api/presets` | Preset team definitions |
| `POST` | `/api/team` | Save team: `speciesNames`, `teamName`; session or `username`/`password` |
| `POST` | `/api/me/team` | Load team species + name; session or credentials |
| `GET` | `/api/me/stats` | User stats (currently expects query username/password) |

Google OAuth (when configured): `GET /auth/google`, `GET /auth/google/callback`.

### Socket.io (client → server)

| Event | Payload (concept) |
|-------|---------------------|
| `login` | `{ username, password? }` |
| `setTeam` | `{ speciesNames, teamName? }` |
| `joinBattle` | `{}` or `{ speciesNames: string[] }` (3–6) |
| `leaveBattle` | Leave queue |
| `chooseMove` | `{ moveIndex: 0..3 }` |
| `spectateBattle` | `{}` (list battles) or `{ battleId }` |
| `stopSpectating` | — |
| `getQueueStatus` / `getQueueList` | Lobby metrics |

### Socket.io (server → client)

Includes: `loginResult`, `queueStatus`, `queueList`, `queueJoined`, `queueLeft`, `battleStart`, `requestMove`, `moveStatus`, `turnResolving`, `battleEvents`, `battleState`, `battleFinished`, `battleDisconnected`, `battleList`, `spectateStart`, `spectateEnd`, `error`.

---

## Database

- **Gen 1 battle data** (`pokemon`, `move_defs`, `pokemon_legal_moves`, `evolutions`, `moves`): created and filled by `db/gen1Seed.js` from **`data/gen1-clean.json`** when the server starts (if incomplete) or when you run `npm run seed`.
- **Accounts / meta** (**users**, **teams**, **battles**, **user_pokemon_usage**): created/migrated in `engine/userManager.js`.

All runtime reads go through SQLite at `DB_PATH` (default `db/pokemon.sqlite`).

---

## Known Issues

- **Port conflicts**: A previous `npm run dev` can leave port `3000` in use (`EADDRINUSE`); stop the old process or change `PORT`.
- **Frontend** state is still being unified (screens, team vs lobby); edge cases if socket connects before auth completes are mitigated in client but not formally tested everywhere.
- **Dependency overlap**: `better-sqlite3` is listed in `package.json` but `db/database.js` uses `sqlite3`; only one path is active unless you refactor.
- **Root `app.js`**: Separate from `server.js` / `serverApp.js`; check `package.json` `scripts` for the real entry point.
- **Missing `data/gen1-clean.json`**: server bootstrap fails until you run `npm run fetch:gen1` (dev) or restore that file from the repo.

---

## Development Notes

- Engine changes affect CLI scripts (`engine/testBattle.js`, `scripts/runSampleBattles.js`) and PvP—keep behavior aligned or document divergence.
- `npm run validate-engine` compares engine output to expectations for regression checks.
- Logs under `logs/` are gitignored; damage-sim output can be passed to `validate-engine:file` per `package.json`.
- **`npm run fetch:gen1`** updates local JSON from the network; **`npm run seed`** reapplies JSON to SQLite; neither runs automatically on `npm run dev`.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` / `npm start` | Dev with nodemon / production `node server.js` (auto-seeds Gen 1 SQLite from JSON if DB missing/incomplete) |
| `npm run fetch:gen1` | Download/normalize Gen 1 JSON from PokeAPI (dev/maintenance; not required for testers) |
| `npm run seed` | Full reset of Gen 1 tables from `data/gen1-clean.json` (optional; same source as server bootstrap) |
| `npm test` | `runSampleBattles.js` with 5 battles |
| `npm run sample-battles` | Longer sample battle runs |
| `npm run damage-sim` | Aggregate damage stats from many battles |
| `npm run validate-engine` | Validation harness |

---

## Deployment

- Set **`PORT`**, **`NODE_ENV`**, **`SESSION_SECRET`**, and **`DB_PATH`** (absolute path if cwd differs).
- Persist the SQLite file on a volume if the host wipes ephemeral disks.
- Use **`GET /health`** for readiness.
- For OAuth, register the production callback URL in Google Cloud Console and set **`GOOGLE_CALLBACK_URL`**.

---

## Author

**Rob Hudson** — backend / systems focus  

GitHub: [RemyLeBleau](https://github.com/RemyLeBleau)
