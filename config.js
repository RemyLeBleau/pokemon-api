/**
 * App config from environment. Used by server and DB layer.
 * Set PORT and DB_PATH in .env or environment for deployment.
 */
const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db', 'pokemon.sqlite');

const isProduction = NODE_ENV === 'production';
const isDevelopment = NODE_ENV === 'development';

/** PvP move pick timeout (ms); unset choice defaults to move slot 0 (M1). */
const MOVE_TURN_MS = Number(process.env.MOVE_TURN_MS) || 45000;

module.exports = {
  NODE_ENV,
  PORT,
  DB_PATH,
  isProduction,
  isDevelopment,
  MOVE_TURN_MS,
};
