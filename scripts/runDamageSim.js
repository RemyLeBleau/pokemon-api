#!/usr/bin/env node
/**
 * Run N battles and aggregate damage/crit/type-effectiveness stats.
 * Use: node scripts/runDamageSim.js [count]
 * Example: node scripts/runDamageSim.js 100000
 */

const fs = require('fs');
const path = require('path');

const PokemonFactory = require('../engine/pokemonFactory');
const Team = require('../engine/team');
const Battle = require('../engine/battle/Battle');

const TOTAL = Math.min(Number(process.argv[2]) || 100000, 1000000);
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'damage-sim-stats.json');

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

function runOneBattle(team1, team2) {
  const player1 = { name: 'P1', team: team1 };
  const player2 = { name: 'P2', team: team2 };
  const battle = new Battle(player1, player2);
  const moveStats = [];

  while (!battle.isFinished()) {
    const events = battle.processTurn();
    for (const e of events) {
      if (e.type === 'move' && e.damage != null) {
        moveStats.push({
          damage: e.damage,
          crit: !!e.crit,
          effectiveness: e.effectiveness ?? 1,
          attackerSpeed: e.attackerSpeed,
          hpBefore: e.hpBefore,
          hpAfter: e.hpAfter
        });
      }
    }
  }

  return { winner: battle.winner, turnCount: battle.turn - 1, moveStats };
}

function aggregate(stats) {
  const damages = stats.map(s => s.damage).filter(d => d > 0);
  const crits = stats.filter(s => s.crit).length;
  const total = stats.length;
  const sum = damages.reduce((a, b) => a + b, 0);
  const effectivenessBuckets = { super: 0, neutral: 0, resisted: 0 };
  const speeds = stats.map(s => s.attackerSpeed).filter(v => v != null);
  const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  stats.forEach(s => {
    const m = s.effectiveness ?? 1;
    if (m > 1) effectivenessBuckets.super++;
    else if (m < 1 && m > 0) effectivenessBuckets.resisted++;
    else effectivenessBuckets.neutral++;
  });

  return {
    totalMoves: total,
    totalDamageDealt: sum,
    damagePerMove: {
      count: damages.length,
      min: damages.length ? Math.min(...damages) : 0,
      max: damages.length ? Math.max(...damages) : 0,
      avg: damages.length ? sum / damages.length : 0,
      sum
    },
    crits: { count: crits, rate: total ? (crits / total * 100).toFixed(2) + '%' : '0%' },
    effectiveness: effectivenessBuckets,
    avgAttackerSpeed: avgSpeed.toFixed(1),
    expectedCritRatePct: avgSpeed ? ((avgSpeed / 512) * 100).toFixed(2) : null
  };
}

async function main() {
  const allMoveStats = [];
  const battleResults = { p1Wins: 0, p2Wins: 0, turnCounts: [], errors: 0 };
  const startTime = Date.now();

  console.log(`Running ${TOTAL} battles for damage/crit stats...`);

  for (let i = 0; i < TOTAL; i++) {
    try {
      const team1 = await generateRandomTeam(3);
      const team2 = await generateRandomTeam(3);
      const { winner, turnCount, moveStats } = runOneBattle(team1, team2);

      if (winner === 'P1') battleResults.p1Wins++;
      else battleResults.p2Wins++;
      battleResults.turnCounts.push(turnCount);
      allMoveStats.push(...moveStats);

      if ((i + 1) % 10000 === 0) {
        console.log(`  ${i + 1}/${TOTAL} battles...`);
      }
    } catch (err) {
      battleResults.errors++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const agg = aggregate(allMoveStats);

  const report = {
    runAt: new Date().toISOString(),
    totalBattles: TOTAL,
    totalMoveEvents: allMoveStats.length,
    battlesPerSec: (TOTAL / parseFloat(elapsed)).toFixed(1),
    elapsedSeconds: parseFloat(elapsed),
    battleResults: {
      p1Wins: battleResults.p1Wins,
      p2Wins: battleResults.p2Wins,
      errors: battleResults.errors,
      turnsMin: battleResults.turnCounts.length ? Math.min(...battleResults.turnCounts) : 0,
      turnsMax: battleResults.turnCounts.length ? Math.max(...battleResults.turnCounts) : 0,
      turnsAvg: battleResults.turnCounts.length
        ? (battleResults.turnCounts.reduce((a, b) => a + b, 0) / battleResults.turnCounts.length).toFixed(1)
        : 0
    },
    damageStats: agg
  };

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(report, null, 2));

  console.log('\n--- Damage simulation summary ---');
  console.log(`Battles: ${TOTAL} (${battleResults.errors} errors) | Time: ${elapsed}s`);
  console.log(`P1 wins: ${battleResults.p1Wins} | P2 wins: ${battleResults.p2Wins}`);
  console.log(`Turns: min ${report.battleResults.turnsMin} | max ${report.battleResults.turnsMax} | avg ${report.battleResults.turnsAvg}`);
  console.log(`Move events: ${agg.totalMoves}`);
  console.log(`Damage per move: min ${agg.damagePerMove.min} | max ${agg.damagePerMove.max} | avg ${agg.damagePerMove.avg.toFixed(1)}`);
  console.log(`Crit rate: ${agg.crits.rate}`);
  console.log(`Effectiveness: super ${agg.effectiveness.super} | neutral ${agg.effectiveness.neutral} | resisted ${agg.effectiveness.resisted}`);
  console.log(`Log: ${LOG_FILE}`);

  process.exit(battleResults.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
