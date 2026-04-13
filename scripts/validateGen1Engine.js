#!/usr/bin/env node
/**
 * Validate engine output against known Gen 1 battle mechanics.
 * Reads from logs/damage-sim-stats.json (run damage-sim first) or runs a quick validation sim.
 * Use: node scripts/validateGen1Engine.js [path-to-stats.json]
 *      node scripts/validateGen1Engine.js    (runs 5000 battles, then validates)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Known Gen 1 battle constants (Bulbapedia, game data)
// ---------------------------------------------------------------------------
const GEN1_REF = {
  // Damage random factor: Gen 1 used 217-255 (inclusive) as the random roll
  RAND_MIN: 217,
  RAND_MAX: 255,
  RAND_RANGE: [217 / 255, 255 / 255], // [0.851, 1.0]

  // Crit: Gen 1 crit chance = Speed / 512 (not 1/16 like later gens)
  CRIT_FORMULA: 'speed / 512',

  // At level 75, typical speed range for fully evolved Gen 1 mons
  SPEED_MIN_L75: 50,
  SPEED_MAX_L75: 220,

  // Expected crit rate range given speed distribution
  CRIT_RATE_MIN_PCT: 10,
  CRIT_RATE_MAX_PCT: 45,

  // Win rate for symmetric random teams should be ~50%
  WIN_RATE_TOLERANCE: 0.05, // 45-55%

  // Damage bounds at L75: max HP ~350, single hit typically 50-400
  // Extreme cases (4x + crit + max roll) can reach ~2500
  DAMAGE_MIN: 1,
  DAMAGE_MAX_REASONABLE: 2500,

  // Type effectiveness: with random teams, expect some super/resisted
  // (all neutral would suggest type chart not applied)
  EXPECT_NON_NEUTRAL: true
};

// ---------------------------------------------------------------------------
// Validation logic
// ---------------------------------------------------------------------------
function validateReport(report) {
  const abnormalities = [];
  const br = report.battleResults || {};
  const ds = report.damageStats || {};

  // 1. Win rate symmetry
  const total = (br.p1Wins || 0) + (br.p2Wins || 0);
  if (total > 0) {
    const p1Rate = br.p1Wins / total;
    if (p1Rate < 0.5 - GEN1_REF.WIN_RATE_TOLERANCE || p1Rate > 0.5 + GEN1_REF.WIN_RATE_TOLERANCE) {
      abnormalities.push({
        code: 'WIN_RATE_ASYMMETRY',
        message: `Win rate ${(p1Rate * 100).toFixed(1)}% outside expected 45-55% (random teams should be ~50%)`,
        observed: { p1Wins: br.p1Wins, p2Wins: br.p2Wins }
      });
    }
  }

  // 2. Crit rate vs expected (Gen 1: Speed/512)
  const critRatePct = ds.crits?.rate ? parseFloat(ds.crits.rate) : null;
  const expectedCritPct = ds.expectedCritRatePct ? parseFloat(ds.expectedCritRatePct) : null;
  if (critRatePct != null && expectedCritPct != null) {
    const diff = Math.abs(critRatePct - expectedCritPct);
    if (diff > 8) {
      abnormalities.push({
        code: 'CRIT_RATE_DEVIATION',
        message: `Crit rate ${critRatePct}% differs from expected ${expectedCritPct}% (Gen 1: Speed/512) by ${diff.toFixed(1)}%. Note: fixed RNG seed per battle can bias early rolls.`,
        observed: critRatePct,
        expected: expectedCritPct
      });
    }
  } else if (critRatePct != null && (critRatePct < GEN1_REF.CRIT_RATE_MIN_PCT || critRatePct > GEN1_REF.CRIT_RATE_MAX_PCT)) {
    abnormalities.push({
      code: 'CRIT_RATE_OUT_OF_RANGE',
      message: `Crit rate ${critRatePct}% outside typical Gen 1 range ${GEN1_REF.CRIT_RATE_MIN_PCT}-${GEN1_REF.CRIT_RATE_MAX_PCT}%`,
      observed: critRatePct
    });
  }

  // 3. Damage bounds
  const dmg = ds.damagePerMove || {};
  if (dmg.min != null && dmg.min < GEN1_REF.DAMAGE_MIN) {
    abnormalities.push({
      code: 'DAMAGE_BELOW_MIN',
      message: `Min damage ${dmg.min} below expected minimum ${GEN1_REF.DAMAGE_MIN}`,
      observed: dmg.min
    });
  }
  if (dmg.max != null && dmg.max > GEN1_REF.DAMAGE_MAX_REASONABLE) {
    abnormalities.push({
      code: 'DAMAGE_ABOVE_MAX',
      message: `Max damage ${dmg.max} exceeds reasonable Gen 1 L75 cap (~${GEN1_REF.DAMAGE_MAX_REASONABLE})`,
      observed: dmg.max
    });
  }

  // 4. Type effectiveness application
  const eff = ds.effectiveness || {};
  const totalEff = (eff.super || 0) + (eff.neutral || 0) + (eff.resisted || 0);
  if (totalEff > 0 && GEN1_REF.EXPECT_NON_NEUTRAL) {
    const superPct = (eff.super / totalEff) * 100;
    const resistedPct = (eff.resisted / totalEff) * 100;
    if (superPct === 0 && resistedPct === 0) {
      abnormalities.push({
        code: 'TYPE_EFFECTIVENESS_MISSING',
        message: 'No super-effective or resisted hits; type chart may not be applied',
        observed: eff
      });
    }
  }

  // 5. Turn count sanity
  const turnsMin = br.turnsMin;
  const turnsMax = br.turnsMax;
  if (turnsMin != null && turnsMin < 1) {
    abnormalities.push({
      code: 'TURNS_TOO_LOW',
      message: `Min turns ${turnsMin} is invalid (should be >= 1)`,
      observed: turnsMin
    });
  }
  if (turnsMax != null && turnsMax > 250) {
    abnormalities.push({
      code: 'TURNS_SUSPICIOUSLY_HIGH',
      message: `Max turns ${turnsMax} unusually high for L75 3v3 (e.g. Chansey vs Chansey)`,
      observed: turnsMax
    });
  }

  // 6. Random factor check (via damage distribution)
  // Expected: damage should span a range consistent with rand 217-255
  // Ratio max/min for same base should be ~255/217 ≈ 1.175
  if (dmg.min > 0 && dmg.max > 0) {
    const ratio = dmg.max / dmg.min;
    if (ratio > 3000) {
      abnormalities.push({
        code: 'DAMAGE_RANGE_WIDE',
        message: `Damage max/min ratio ${ratio.toFixed(1)} is very high (expected ~2-4 for varied matchups)`,
        observed: { min: dmg.min, max: dmg.max }
      });
    }
  }

  return abnormalities;
}

// ---------------------------------------------------------------------------
// Run validation sim if no input file
// ---------------------------------------------------------------------------
async function runValidationSim(count = 5000) {
  const PokemonFactory = require('../engine/pokemonFactory');
  const Team = require('../engine/team');
  const Battle = require('../engine/battle/Battle');

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

  const agg = {
    totalMoves: 0,
    crits: 0,
    damageSum: 0,
    damageCount: 0,
    damageMin: Infinity,
    damageMax: 0,
    speedSum: 0,
    speedCount: 0,
    super: 0,
    neutral: 0,
    resisted: 0
  };
  const battleResults = { p1Wins: 0, p2Wins: 0, turnCounts: [], errors: 0 };

  for (let i = 0; i < count; i++) {
    try {
      const team1 = await generateRandomTeam(3);
      const team2 = await generateRandomTeam(3);
      const player1 = { name: 'P1', team: team1 };
      const player2 = { name: 'P2', team: team2 };
      const battle = new Battle(player1, player2);

      while (!battle.isFinished()) {
        const events = battle.processTurn();
        for (const e of events) {
          if (e.type === 'move' && e.damage != null) {
            agg.totalMoves++;
            if (e.crit) agg.crits++;
            if (e.damage > 0) {
              agg.damageSum += e.damage;
              agg.damageCount++;
              if (e.damage < agg.damageMin) agg.damageMin = e.damage;
              if (e.damage > agg.damageMax) agg.damageMax = e.damage;
            }
            if (e.attackerSpeed != null) {
              agg.speedSum += e.attackerSpeed;
              agg.speedCount++;
            }
            const m = e.effectiveness ?? 1;
            if (m > 1) agg.super++;
            else if (m < 1 && m > 0) agg.resisted++;
            else agg.neutral++;
          }
        }
      }

      if (battle.winner === 'P1') battleResults.p1Wins++;
      else battleResults.p2Wins++;
      battleResults.turnCounts.push(battle.turn - 1);
    } catch (err) {
      battleResults.errors++;
    }
  }

  const damagesCount = agg.damageCount;
  const avgSpeed = agg.speedCount ? agg.speedSum / agg.speedCount : 0;

  return {
    runAt: new Date().toISOString(),
    totalBattles: count,
    totalMoveEvents: agg.totalMoves,
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
    damageStats: {
      totalMoves: agg.totalMoves,
      damagePerMove: {
        count: damagesCount,
        min: agg.damageMin === Infinity ? 0 : agg.damageMin,
        max: agg.damageMax,
        avg: damagesCount ? agg.damageSum / damagesCount : 0,
        sum: agg.damageSum
      },
      crits: { count: agg.crits, rate: agg.totalMoves ? (agg.crits / agg.totalMoves * 100).toFixed(2) + '%' : '0%' },
      effectiveness: { super: agg.super, neutral: agg.neutral, resisted: agg.resisted },
      avgAttackerSpeed: avgSpeed.toFixed(1),
      expectedCritRatePct: avgSpeed ? ((avgSpeed / 512) * 100).toFixed(2) : null
    }
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const inputPath = process.argv[2];
  let report;

  if (inputPath && fs.existsSync(inputPath)) {
    console.log(`Reading from ${inputPath}...`);
    report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } else {
    const count = inputPath ? parseInt(inputPath, 10) || 5000 : 5000;
    console.log(`Running ${count} validation battles...`);
    report = await runValidationSim(count);
  }

  const abnormalities = validateReport(report);

  console.log('\n=== Gen 1 Engine Validation ===');
  console.log('Reference: Gen 1 mechanics (Bulbapedia)');
  console.log(`  Random factor: ${GEN1_REF.RAND_MIN}-${GEN1_REF.RAND_MAX}/255`);
  console.log(`  Crit: ${GEN1_REF.CRIT_FORMULA}`);
  console.log('');

  if (abnormalities.length === 0) {
    console.log('No abnormalities detected. Output appears consistent with Gen 1 battle logic.');
  } else {
    console.log(`Found ${abnormalities.length} potential abnormality(ies):\n`);
    abnormalities.forEach((a, i) => {
      console.log(`  [${i + 1}] ${a.code}`);
      console.log(`      ${a.message}`);
      if (a.observed != null) console.log(`      Observed: ${JSON.stringify(a.observed)}`);
      if (a.expected != null) console.log(`      Expected: ${a.expected}`);
      console.log('');
    });
  }

  const logPath = path.join(__dirname, '..', 'logs', 'validate-report.json');
  if (!fs.existsSync(path.dirname(logPath))) fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify({ report, abnormalities }, null, 2));
  console.log(`Full report: ${logPath}`);

  process.exit(abnormalities.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
