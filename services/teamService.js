// services/teamService.js
const db = require('./db');

function saveTeam(userId, teamName, teamData) {
  const dataJSON = JSON.stringify(teamData);
  db.prepare(`
    INSERT INTO teams (user_id, team_name, data)
    VALUES (?, ?, ?)
  `).run(userId, teamName, dataJSON);
}

function getUserTeams(userId) {
  return db.prepare('SELECT * FROM teams WHERE user_id = ?').all(userId)
    .map(t => ({ id: t.id, name: t.team_name, data: JSON.parse(t.data) }));
}

module.exports = { saveTeam, getUserTeams };