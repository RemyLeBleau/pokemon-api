const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET /pokemon  (from SQLite)
router.get('/', (req, res) => {
  const { type } = req.query;

  let query = "SELECT * FROM pokemon ORDER BY id ASC";
  let params = [];

  if (type) {
    query = "SELECT * FROM pokemon WHERE types LIKE ? ORDER BY id ASC";
    params.push(`%${type.toLowerCase()}%`);
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    const result = rows.map(p => ({
      id: p.id,
      name: p.name,
      types: JSON.parse(p.types),
      hp: p.hp
    }));

    res.json(result);
  });
});

module.exports = router;