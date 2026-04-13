#!/usr/bin/env node
/**
 * Run N sample battles (default 1000) using the same engine as the server.
 * Logs each battle to logs/sample-battles.log; prints progress and summary to console.
 * Use: node scripts/runSampleBattles.js [count]
 */

const fs = require('fs');
const path = require('path');

const PokemonFactory = require('../engine/pokemonFactory');
const Team = require('../engine/team');
const Battle = require('../engine/battle/Battle');

const TOTAL = Math.min(Number(process.argv[2]) || 1000, 10000);
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'sample-battles.log');

async function generateRandomTeam(teamSize = 3) {
  const allSpecies = await PokemonFactory.getAllSpecies({ finalStageOnly: true });
  const shuffled = [...allSpecies].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, teamSize);
  const pokemonInstances = [];
  for (const name of selected) {
    const pkmn = await PokemonFactory.createPokemon(name);
    pokemonInstances.push(pkmn);
  }
  return new Team(pokemonInstances);
}

function formatEvent(e) {
  switch (e.type) {
    case 'move': {
      let line = `${e.actor} used ${e.move} on ${e.target} | ${e.hpBefore} -> ${e.hpAfter}`;
      if (e.crit) line += ' | CRIT';
      if (e.effectiveness > 1) line += ' | super effective';
      if (e.effectiveness > 0 && e.effectiveness < 1) line += ' | not very effective';
      return line;
    }
    case 'miss':
      return `${e.actor}'s ${e.move} missed`;
    case 'residual':
      return `${e.pokemon} residual damage | ${e.hpBefore} -> ${e.hpAfter}`;
    case 'faint':
      return `${e.pokemon} fainted`;
    case 'autoSwitch':
      return `${e.player} switched to ${e.to}`;
    case 'sleep':
      return `${e.pokemon} is asleep`;
    case 'woke':
      return `${e.pokemon} woke up`;
    case 'freeze':
      return `${e.pokemon} is frozen`;
    case 'fullPara':
      return `${e.pokemon} is paralysed`;
    default:
      return `[${e.type}]`;
  }
}

function runOneBattle(player1Name, player2Name, team1, team2, logStream) {
  const player1 = { name: player1Name, team: team1 };
  const player2 = { name: player2Name, team: team2 };
  const battle = new Battle(player1, player2);
  const lines = [];
  let turnCount = 0;

  while (!battle.isFinished()) {
    const events = battle.processTurn();
    turnCount++;
    for (const e of events) {
      lines.push(`  ${formatEvent(e)}`);
    }
  }

  return { winner: battle.winner, turnCount, lines };
}

async function main() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
  const startTime = Date.now();
  const results = { p1Wins: 0, p2Wins: 0, errors: [], turnCounts: [] };

  logStream.write(`Sample battles run at ${new Date().toISOString()}\n`);
  logStream.write(`Total battles: ${TOTAL}\n`);
  logStream.write(`${'─'.repeat(60)}\n\n`);

  for (let i = 1; i <= TOTAL; i++) {
    try {
      const team1 = await generateRandomTeam(3);
      const team2 = await generateRandomTeam(3);
      const { winner, turnCount, lines } = runOneBattle('P1', 'P2', team1, team2, logStream);

      if (winner === 'P1') results.p1Wins++;
      else results.p2Wins++;
      results.turnCounts.push(turnCount);

      logStream.write(`[Battle ${i}] Winner: ${winner} (${turnCount} turns)\n`);
      for (const line of lines) {
        logStream.write(line + '\n');
      }
      logStream.write('\n');

      if (i % 100 === 0) {
        console.log(`  ${i}/${TOTAL} battles done...`);
      }
    } catch (err) {
      results.errors.push({ battle: i, message: err.message, stack: err.stack });
      logStream.write(`[Battle ${i}] ERROR: ${err.message}\n\n`);
      console.error(`  Battle ${i} error:`, err.message);
    }
  }

  logStream.write(`${'─'.repeat(60)}\n`);
  logStream.write(`P1 wins: ${results.p1Wins} | P2 wins: ${results.p2Wins} | Errors: ${results.errors.length}\n`);
  if (results.turnCounts.length > 0) {
    const sum = results.turnCounts.reduce((a, b) => a + b, 0);
    const avg = (sum / results.turnCounts.length).toFixed(1);
    const min = Math.min(...results.turnCounts);
    const max = Math.max(...results.turnCounts);
    logStream.write(`Turns: min ${min} | max ${max} | avg ${avg}\n`);
  }
  logStream.end();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n--- Summary ---');
  console.log(`Battles: ${TOTAL} (${results.errors.length} errors)`);
  console.log(`P1 wins: ${results.p1Wins} | P2 wins: ${results.p2Wins}`);
  if (results.turnCounts.length > 0) {
    const sum = results.turnCounts.reduce((a, b) => a + b, 0);
    console.log(`Turns: min ${Math.min(...results.turnCounts)} | max ${Math.max(...results.turnCounts)} | avg ${(sum / results.turnCounts.length).toFixed(1)}`);
  }
  console.log(`Time: ${elapsed}s | Log: ${LOG_FILE}`);
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.slice(0, 10).forEach(({ battle, message }) => console.log(`  Battle ${battle}: ${message}`));
    if (results.errors.length > 10) console.log(`  ... and ${results.errors.length - 10} more`);
  }

  process.exit(results.errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
