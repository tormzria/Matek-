import { randomUUID } from "node:crypto";
import {
  MAX_HORIZON_SEC,
  MAX_STAKE,
  MIN_HORIZON_SEC,
  MIN_INTERVAL_WIDTH,
  MIN_STAKE,
} from "./config.js";
import { computeMultiplier } from "./multiplier.js";
import {
  activeVisitorCount,
  applyStreak,
  displayNameFor,
  getOrCreateUser,
  saveGuess,
} from "./store.js";

export class ValidationError extends Error {}

function validateInputs({ horizonSec, low, high, stake }) {
  if (!Number.isFinite(horizonSec) || horizonSec < MIN_HORIZON_SEC || horizonSec > MAX_HORIZON_SEC) {
    throw new ValidationError(
      `horizonSec must be between ${MIN_HORIZON_SEC} and ${MAX_HORIZON_SEC}`
    );
  }
  if (!Number.isInteger(low) || !Number.isInteger(high) || high < low) {
    throw new ValidationError("low/high must be integers with high >= low");
  }
  if (high - low + 1 < MIN_INTERVAL_WIDTH) {
    throw new ValidationError(`interval width must be >= ${MIN_INTERVAL_WIDTH}`);
  }
  if (low < 0) {
    throw new ValidationError("low must be >= 0");
  }
  if (!Number.isFinite(stake) || stake < MIN_STAKE || stake > MAX_STAKE) {
    throw new ValidationError(`stake must be between ${MIN_STAKE} and ${MAX_STAKE}`);
  }
}

export function previewMultiplier({ horizonSec, low, high }) {
  validateInputs({ horizonSec, low, high, stake: MIN_STAKE });
  const currentCount = activeVisitorCount();
  return computeMultiplier({ horizonSec, low, high, currentCount });
}

export function placeGuess({ userId, horizonSec, low, high, stake }) {
  validateInputs({ horizonSec, low, high, stake });
  const user = getOrCreateUser(userId);
  if (stake > user.credits) {
    throw new ValidationError("insufficient credits");
  }

  const currentCount = activeVisitorCount();
  const { multiplier, probability } = computeMultiplier({
    horizonSec,
    low,
    high,
    currentCount,
  });

  user.credits -= stake;

  const now = Date.now();
  const guess = {
    id: randomUUID(),
    userId: user.userId,
    createdAt: now,
    targetTimestamp: now + horizonSec * 1000,
    horizonSec,
    low,
    high,
    stake,
    multiplier,
    probabilityAtGuessTime: probability,
    countAtGuessTime: currentCount,
    potentialPayout: Math.round(stake * multiplier * 100) / 100,
    status: "pending",
    actual: null,
    payout: 0,
  };
  saveGuess(guess);
  return guess;
}

export function resolveGuess(guess, actualCount) {
  const won = actualCount >= guess.low && actualCount <= guess.high;
  guess.actual = actualCount;
  guess.status = won ? "won" : "lost";
  guess.payout = won ? guess.potentialPayout : 0;
  guess.resolvedAt = Date.now();
  if (won) {
    const user = getOrCreateUser(guess.userId);
    user.credits += guess.payout;
  }
  guess.streakAfter = applyStreak(guess.userId, won);
  guess.displayName = displayNameFor(guess.userId);
  return guess;
}
