/**
 * Full reset + seed of strict Gen 1 tables from data/gen1-clean.json.
 * For refreshing data from PokeAPI, run `npm run fetch:gen1` first, then this script.
 * Normal testers can rely on server auto-bootstrap + committed JSON instead.
 */
const db = require('../db/database');
const { reseedGen1FromFile, DEFAULT_GEN1_DATA_PATH } = require('../db/gen1Seed');

async function main() {
  console.log('Resetting strict Gen 1 schema and seeding from', DEFAULT_GEN1_DATA_PATH);
  const summary = await reseedGen1FromFile(db, DEFAULT_GEN1_DATA_PATH);
  console.log('Seed complete:', summary);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
