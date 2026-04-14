/**
 * Entry point: load env, ensure Gen 1 SQLite from bundled JSON if needed, then start HTTP/Socket.io app.
 * PokeAPI fetch is NOT run here — use `npm run fetch:gen1` when refreshing source data.
 */
require('dotenv').config();

(async () => {
  try {
    const db = require('./db/database');
    const config = require('./config');
    const { ensureGen1Dataset } = require('./db/gen1Seed');
    const r = await ensureGen1Dataset(db);
    if (r.bootstrapped) {
      console.log('[gen1] Seeded SQLite from bundled JSON:', r.summary);
    } else if (config.isDevelopment) {
      console.log('[gen1] Using existing Gen 1 data:', r.summary);
    }
  } catch (err) {
    console.error('[gen1] Bootstrap failed:', err.message);
    process.exit(1);
  }
  require('./serverApp');
})();
