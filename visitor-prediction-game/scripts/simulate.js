// Statistical validation of the payout model.
//
// Builds a synthetic random-walk visitor-count history (the same shape of
// data the real server accumulates), feeds it through the *actual* pricing
// code in server/multiplier.js at a realistic recomputation cadence, fires
// many synthetic guesses against it, and reports the platform's realized
// edge. This is the "statistical simulation" the design doc calls for
// before trusting the multiplier formula with real credits.
//
// Run: npm run simulate

import { computeMultiplier, updateVolatilityModel } from "../server/multiplier.js";
import { HOUSE_EDGE } from "../server/config.js";

const SNAPSHOT_INTERVAL_MS = 5000;
const SIM_HOURS = 48;
const TICKS = Math.round((SIM_HOURS * 3600 * 1000) / SNAPSHOT_INTERVAL_MS);
const RECALIBRATE_EVERY_TICKS = 200; // ~17min, similar order to prod cadence
const GUESSES_PER_CHECKPOINT = 40;
const HORIZONS_SEC = [60, 300, 900, 1800, 3600, 7200];

function randn() {
  // Box-Muller
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function buildHistory() {
  const history = [];
  let count = 120;
  const t0 = Date.now() - TICKS * SNAPSHOT_INTERVAL_MS;
  // Traffic isn't pure noise in real life (daily cycle + drift), so mix a
  // slow sinusoidal seasonal component into the walk to stress-test the
  // "mean = current count, no drift" assumption used at guess time.
  for (let i = 0; i < TICKS; i++) {
    const hourOfDay = ((i * SNAPSHOT_INTERVAL_MS) / 3_600_000) % 24;
    const seasonal = 40 * Math.sin((hourOfDay / 24) * 2 * Math.PI);
    const target = 150 + seasonal;
    const pull = (target - count) * 0.01; // gentle mean reversion toward the daily curve
    const noise = randn() * Math.max(1, Math.sqrt(count) * 0.6);
    count = Math.max(0, Math.round(count + pull + noise));
    history.push({ timestamp: t0 + i * SNAPSHOT_INTERVAL_MS, activeVisitors: count });
  }
  return history;
}

function runSimulation() {
  const history = buildHistory();
  let totalStaked = 0;
  let totalPaidOut = 0;
  let wins = 0;
  let losses = 0;
  const byHorizon = new Map();

  for (let i = RECALIBRATE_EVERY_TICKS; i < history.length; i += RECALIBRATE_EVERY_TICKS) {
    const knownHistory = history.slice(0, i + 1);
    updateVolatilityModel(knownHistory);
    const currentCount = history[i].activeVisitors;

    for (let g = 0; g < GUESSES_PER_CHECKPOINT; g++) {
      const horizonSec = HORIZONS_SEC[Math.floor(Math.random() * HORIZONS_SEC.length)];
      const stepsAhead = Math.round((horizonSec * 1000) / SNAPSHOT_INTERVAL_MS);
      const targetIndex = i + stepsAhead;
      if (targetIndex >= history.length) continue;

      const width = 3 + Math.floor(Math.random() * 30);
      const offset = Math.floor((Math.random() - 0.5) * width * 2);
      const low = Math.max(0, currentCount + offset - Math.floor(width / 2));
      const high = low + width - 1;
      const stake = 10;

      const { multiplier } = computeMultiplier({ horizonSec, low, high, currentCount });
      const actual = history[targetIndex].activeVisitors;
      const won = actual >= low && actual <= high;
      const payout = won ? stake * multiplier : 0;

      totalStaked += stake;
      totalPaidOut += payout;
      if (won) wins++;
      else losses++;

      const bucket = byHorizon.get(horizonSec) ?? { staked: 0, paidOut: 0, n: 0 };
      bucket.staked += stake;
      bucket.paidOut += payout;
      bucket.n += 1;
      byHorizon.set(horizonSec, bucket);
    }
  }

  const realizedEdge = (totalStaked - totalPaidOut) / totalStaked;

  console.log(`Simulated ${SIM_HOURS}h of traffic, ${wins + losses} guesses (${wins} won / ${losses} lost)`);
  console.log(`Configured house edge: ${(HOUSE_EDGE * 100).toFixed(2)}%`);
  console.log(`Realized platform edge: ${(realizedEdge * 100).toFixed(2)}%`);
  console.log(`Total staked: ${totalStaked.toFixed(0)}  Total paid out: ${totalPaidOut.toFixed(0)}`);
  console.log("\nBy horizon:");
  for (const [horizonSec, b] of [...byHorizon.entries()].sort((a, b) => a[0] - b[0])) {
    const edge = ((b.staked - b.paidOut) / b.staked) * 100;
    console.log(
      `  ${String(horizonSec).padStart(5)}s  n=${String(b.n).padStart(4)}  edge=${edge.toFixed(2)}%`
    );
  }
}

runSimulation();
