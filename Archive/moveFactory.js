const db = require('../db/database');

function getMoveByName(name) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM moves WHERE name = ?`,
      [name.toLowerCase()],
      (err, move) => {
        if (err || !move) return reject('Move not found');

        resolve({
          name: move.name,
          power: move.power,
          type: move.type,
          category: isSpecial(move.type) ? 'special' : 'physical'
        });
      }
    );
  });
}

function isSpecial(type) {
  const specialTypes = [
    'fire',
    'water',
    'grass',
    'electric',
    'ice',
    'psychic',
    'dragon'
  ];

  return specialTypes.includes(type);
}

module.exports = { getMoveByName };