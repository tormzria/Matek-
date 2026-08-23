import {
  DEFAULT_RELATIVE_VOLATILITY,
  HOUSE_EDGE,
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
  MIN_PROBABILITY,
  REFERENCE_HORIZON_SEC,
} from "./config.js";

// Horizons (seconds) at which we try to measure real volatility from
// history. Anything in between/beyond is extrapolated with a random-walk
// (Brownian) sqrt-time scaling from the nearest measured anchor.
const REFERENCE_HORIZONS_SEC = [60, 300, 1800, 7200];
const MIN_SAMPLES_PER_ANCHOR = 5;

let volatilityModel = { anchors: [], updatedAt: 0 };

/**
 * Recomputes empirical volatility anchors from recorded history: for each
 * reference horizon, look at how much the active-visitor count actually
 * moved over that many seconds, across the whole retained history, and use
 * the standard deviation of that movement as sigma for that horizon.
 * This is what lets the multiplier reflect this site's real traffic
 * patterns instead of a guessed constant.
 */
export function updateVolatilityModel(history) {
  const anchors = [];
  for (const horizonSec of REFERENCE_HORIZONS_SEC) {
    const horizonMs = horizonSec * 1000;
    const tolerance = Math.max(2000, horizonMs * 0.1);
    const deltas = [];
    let j = 0;
    for (let i = 0; i < history.length; i++) {
      const target = history[i].timestamp + horizonMs;
      while (j < history.length && history[j].timestamp < target - tolerance) j++;
      if (
        j < history.length &&
        Math.abs(history[j].timestamp - target) <= tolerance
      ) {
        deltas.push(history[j].activeVisitors - history[i].activeVisitors);
      }
    }
    if (deltas.length >= MIN_SAMPLES_PER_ANCHOR) {
      const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const variance =
        deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length;
      anchors.push({ horizonSec, sigma: Math.max(0.5, Math.sqrt(variance)) });
    }
  }
  volatilityModel = { anchors, updatedAt: Date.now() };
  return volatilityModel;
}

function fallbackSigma(horizonSec, currentCount) {
  const base = Math.max(1, DEFAULT_RELATIVE_VOLATILITY * currentCount);
  return base * Math.sqrt(horizonSec / REFERENCE_HORIZON_SEC);
}

export function estimateSigma(horizonSec, currentCount) {
  const { anchors } = volatilityModel;
  if (!anchors.length) return fallbackSigma(horizonSec, currentCount);

  // Nearest anchor in log-horizon space, then scale to the requested
  // horizon assuming variance grows linearly with time (sqrt with sigma).
  let nearest = anchors[0];
  let bestDist = Infinity;
  for (const a of anchors) {
    const dist = Math.abs(Math.log(a.horizonSec) - Math.log(horizonSec));
    if (dist < bestDist) {
      bestDist = dist;
      nearest = a;
    }
  }
  return nearest.sigma * Math.sqrt(horizonSec / nearest.horizonSec);
}

// Abramowitz & Stegun 7.1.26 approximation of the error function.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x, mean, sigma) {
  if (sigma <= 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (sigma * Math.SQRT2)));
}

/**
 * Probability that the actual visitor count lands in [low, high], modeled
 * as a random walk from the current count: mean = currentCount (no drift
 * assumed - we don't try to predict trend direction, only spread), sigma
 * estimated from historical volatility at that horizon. Continuity
 * correction (+/-0.5) accounts for the count being an integer.
 */
export function guessProbability({ horizonSec, low, high, currentCount }) {
  const sigma = estimateSigma(horizonSec, currentCount);
  const p =
    normalCdf(high + 0.5, currentCount, sigma) -
    normalCdf(low - 0.5, currentCount, sigma);
  return { probability: Math.min(1, Math.max(0, p)), sigma };
}

/**
 * Fair-odds multiplier, then a flat house edge applied on top, clamped to
 * sane bounds so a mispriced tail guess can't sink the whole credit pool.
 */
export function computeMultiplier({ horizonSec, low, high, currentCount }) {
  const { probability, sigma } = guessProbability({
    horizonSec,
    low,
    high,
    currentCount,
  });
  const clampedProbability = Math.max(probability, MIN_PROBABILITY);
  const fairMultiplier = 1 / clampedProbability;
  const payoutMultiplier = fairMultiplier * (1 - HOUSE_EDGE);
  const multiplier = Math.min(
    MAX_MULTIPLIER,
    Math.max(MIN_MULTIPLIER, payoutMultiplier)
  );
  return {
    multiplier: Math.round(multiplier * 100) / 100,
    probability: clampedProbability,
    sigma,
  };
}

export function getVolatilityModel() {
  return volatilityModel;
}
