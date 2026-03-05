// services/userService.js
const bcrypt = require('bcrypt');
const db = require('./db');

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (user && bcrypt.compareSync(password, user.password)) {
    return { id: user.id, username: user.username };
  }
  return null;
}

function createUser(username, password) {
  const hashed = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashed);
  return { id: info.lastInsertRowid, username };
}

module.exports = { login, createUser };