// db/database.js — single SQLite connection; path from config (env)
const sqlite3 = require('sqlite3').verbose();
const { DB_PATH } = require('../config');

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Failed to open DB:', err);
  } else {
    console.log('Connected to SQLite at', DB_PATH);
  }
});

module.exports = db;