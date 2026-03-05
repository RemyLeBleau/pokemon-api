const fs = require('fs');
const path = require('path');
const _ = require('lodash');

const FILE = path.resolve(__dirname, '../data/gen1-raw.json');

const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));

console.log('Total Pokemon:', data.length);
console.log('Top-level keys:', Object.keys(data[0]));

const sample = data[0];

console.log('\n=== SAMPLE STRUCTURE ===');
console.dir(sample, { depth: 3 });

/**
 * STAT NAMES
 */
const statNames = _.uniq(
  _.flatten(
    data.map(p => p.stats.map(s => s.name))
  )
);

console.log('\nStat Names:', statNames);

/**
 * MOVE LEARN METHODS
 */
const learnMethods = _.uniq(
  _.flatten(
    data.map(p =>
      p.moves.map(m => m.learn_method)
    )
  )
);

console.log('\nLearn Methods:', learnMethods);

/**
 * VERSION GROUPS
 */
const versionGroups = _.uniq(
  _.flatten(
    data.map(p =>
      p.moves
        .map(m => m.version_group)
        .filter(Boolean)
    )
  )
);

console.log('\nVersion Groups Found:', versionGroups);

/**
 * Evolution chain depth
 */
function getEvoDepth(chain, depth = 0) {
  if (!chain.evolves_to || chain.evolves_to.length === 0) {
    return depth;
  }
  return Math.max(
    ...chain.evolves_to.map(c =>
      getEvoDepth(c, depth + 1)
    )
  );
}

const evoDepths = data.map(p =>
  getEvoDepth(p.evolution_chain)
);

console.log(
  '\nMax Evolution Chain Depth:',
  Math.max(...evoDepths)
);