const bcrypt = require('bcrypt');
const db = require('../db/database');

// Initialize tables if not exist (and migrate older schemas)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    email TEXT,
    google_id TEXT UNIQUE,
    total_wins INTEGER DEFAULT 0,
    total_losses INTEGER DEFAULT 0,
    total_matches INTEGER DEFAULT 0,
    rating REAL DEFAULT 1000
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    team_json TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Best-effort migration for older DBs (ignore duplicate-column errors)
  const addColumn = (sql) => {
    db.run(sql, (err) => {
      if (err && !/duplicate column/i.test(err.message)) {
        console.error('User table migration error:', err.message);
      }
    });
  };

  addColumn(`ALTER TABLE users ADD COLUMN email TEXT`);
  addColumn(`ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE`);
  addColumn(`ALTER TABLE users ADD COLUMN total_losses INTEGER DEFAULT 0`);
  addColumn(`ALTER TABLE users ADD COLUMN total_matches INTEGER DEFAULT 0`);
  addColumn(`ALTER TABLE users ADD COLUMN rating REAL DEFAULT 1000`);
  addColumn(`ALTER TABLE teams ADD COLUMN team_name TEXT`);

  db.run(`CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now')),
    p1_user_id INTEGER,
    p2_user_id INTEGER,
    winner_user_id INTEGER,
    turns INTEGER,
    p1_team_json TEXT,
    p2_team_json TEXT,
    FOREIGN KEY(p1_user_id) REFERENCES users(id),
    FOREIGN KEY(p2_user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_pokemon_usage (
    user_id INTEGER,
    species_name TEXT,
    battles_played INTEGER DEFAULT 0,
    wins_with INTEGER DEFAULT 0,
    total_damage_done INTEGER DEFAULT 0,
    total_damage_taken INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, species_name),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

class UserManager {
  static async register(username, password) {
    const hash = await bcrypt.hash(password, 10);
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO users (username, password_hash) VALUES (?, ?)`,
        [username, hash],
        function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, username });
        }
      );
    });
  }

  static async login(username, password) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, row) => {
        if (err) return reject(err);
        if (!row) return reject(new Error('User not found'));
        if (!row.password_hash) return reject(new Error('Password login not available for this account'));
        const valid = await bcrypt.compare(password, row.password_hash);
        if (!valid) return reject(new Error('Invalid password'));
        resolve({
          id: row.id,
          username: row.username,
          email: row.email,
          total_wins: row.total_wins,
          total_losses: row.total_losses,
          total_matches: row.total_matches,
          rating: row.rating
        });
      });
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE id = ?`, [id], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        resolve({
          id: row.id,
          username: row.username,
          email: row.email,
          total_wins: row.total_wins,
          total_losses: row.total_losses,
          total_matches: row.total_matches,
          rating: row.rating
        });
      });
    });
  }

  static async findByUsername(username) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        resolve({
          id: row.id,
          username: row.username,
          email: row.email,
          total_wins: row.total_wins,
          total_losses: row.total_losses,
          total_matches: row.total_matches,
          rating: row.rating,
          hasPassword: !!row.password_hash
        });
      });
    });
  }

  static async findOrCreateGoogleUser(googleId, email, displayName) {
    if (!googleId) throw new Error('googleId required');
    const existing = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE google_id = ?`, [googleId], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
    if (existing) {
      return {
        id: existing.id,
        username: existing.username,
        email: existing.email,
        total_wins: existing.total_wins,
        total_losses: existing.total_losses,
        total_matches: existing.total_matches,
        rating: existing.rating
      };
    }

    // Derive a username from email or display name
    let baseUsername =
      (email && email.split('@')[0]) ||
      (displayName && displayName.replace(/\s+/g, '').toLowerCase()) ||
      `google_${googleId.slice(0, 8)}`;

    const tryInsert = (suffix = '') =>
      new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO users (username, email, google_id) VALUES (?, ?, ?)`,
          [baseUsername + suffix, email || null, googleId],
          function(err) {
            if (err) {
              if (/UNIQUE constraint failed: users.username/.test(err.message) && suffix === '') {
                // Retry with a random suffix once
                const rand = '-' + Math.floor(Math.random() * 10000);
                return resolve(tryInsert(rand));
              }
              return reject(err);
            }
            resolve({
              id: this.lastID,
              username: baseUsername + suffix,
              email: email || null,
              total_wins: 0,
              total_losses: 0,
              total_matches: 0,
              rating: 1000
            });
          }
        );
      });

    return tryInsert();
  }

  static async saveTeam(userId, team, teamName) {
    const json = JSON.stringify(team);
    const name = (teamName && String(teamName).trim()) || 'My team';
    return new Promise((resolve, reject) => {
      db.get(`SELECT id FROM teams WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [userId], (err, row) => {
        if (err) return reject(err);
        if (row) {
          db.run(
            `UPDATE teams SET team_json = ?, team_name = ? WHERE id = ?`,
            [json, name, row.id],
            function(err2) {
              if (err2) return reject(err2);
              resolve(true);
            }
          );
        } else {
          db.run(
            `INSERT INTO teams (user_id, team_json, team_name) VALUES (?, ?, ?)`,
            [userId, json, name],
            function(err2) {
              if (err2) return reject(err2);
              resolve(true);
            }
          );
        }
      });
    });
  }

  /** @returns {Promise<{ pokemon: object[], teamName: string } | null>} */
  static async loadTeam(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT team_json, team_name FROM teams WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
        [userId],
        (err, row) => {
          if (err) return reject(err);
          if (!row) return resolve(null);
          try {
            const pokemon = JSON.parse(row.team_json);
            resolve({
              pokemon: Array.isArray(pokemon) ? pokemon : [],
              teamName: row.team_name || 'My team'
            });
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }

  static async incrementWin(userId) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE users SET total_wins = total_wins + 1 WHERE id = ?`, [userId], function(err) {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }

  static async incrementLoss(userId) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE users SET total_losses = total_losses + 1 WHERE id = ?`, [userId], function(err) {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }

  static async incrementMatches(userId) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE users SET total_matches = total_matches + 1 WHERE id = ?`, [userId], function(err) {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }

  static async updateElo(userId, opponentId, won, K = 32) {
    const [userRow, oppRow] = await Promise.all([
      new Promise((resolve, reject) => {
        db.get(`SELECT rating FROM users WHERE id = ?`, [userId], (err, r) => (err ? reject(err) : resolve(r)));
      }),
      new Promise((resolve, reject) => {
        db.get(`SELECT rating FROM users WHERE id = ?`, [opponentId], (err, r) => (err ? reject(err) : resolve(r)));
      })
    ]);
    const Ra = (userRow?.rating ?? 1000);
    const Rb = (oppRow?.rating ?? 1000);
    const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
    const Sa = won ? 1 : 0;
    const newRa = Ra + K * (Sa - Ea);
    return new Promise((resolve, reject) => {
      db.run(`UPDATE users SET rating = ? WHERE id = ?`, [newRa, userId], (err) => (err ? reject(err) : resolve(newRa)));
    });
  }

  static async recordBattle(p1UserId, p2UserId, winnerUserId, turns, p1TeamJson, p2TeamJson) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO battles (p1_user_id, p2_user_id, winner_user_id, turns, p1_team_json, p2_team_json) VALUES (?, ?, ?, ?, ?, ?)`,
        [p1UserId, p2UserId, winnerUserId, turns, p1TeamJson, p2TeamJson],
        function(err) {
          if (err) return reject(err);
          resolve(this.lastID);
        }
      );
    });
  }

  static async recordPokemonUsage(userId, speciesName, won, damageDone = 0, damageTaken = 0) {
    const row = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM user_pokemon_usage WHERE user_id = ? AND species_name = ?`, [userId, speciesName], (err, r) => {
        if (err) return reject(err);
        resolve(r);
      });
    });
    if (row) {
      return new Promise((resolve, reject) => {
        db.run(
          `UPDATE user_pokemon_usage SET battles_played = battles_played + 1, wins_with = wins_with + ?,
           total_damage_done = total_damage_done + ?, total_damage_taken = total_damage_taken + ?
           WHERE user_id = ? AND species_name = ?`,
          [won ? 1 : 0, damageDone, damageTaken, userId, speciesName],
          (err) => (err ? reject(err) : resolve(true))
        );
      });
    }
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO user_pokemon_usage (user_id, species_name, battles_played, wins_with, total_damage_done, total_damage_taken)
         VALUES (?, ?, 1, ?, ?, ?)`,
        [userId, speciesName, won ? 1 : 0, damageDone, damageTaken],
        (err) => (err ? reject(err) : resolve(true))
      );
    });
  }
}

module.exports = UserManager;