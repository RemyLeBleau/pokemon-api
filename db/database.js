// db/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ✅ Correct path to your actual DB
const DB_PATH = path.resolve(__dirname, '../data/pokemon.db');

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error('Failed to open DB:', err);
  } else {
    console.log('Connected to SQLite DB at', DB_PATH);
  }
});

module.exports = db;