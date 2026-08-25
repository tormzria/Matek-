import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  ACTIVE_WINDOW_MS,
  HISTORY_RETENTION_MS,
  STARTING_CREDITS,
} from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "state.json");

/**
 * In-memory game state. Persisted to a JSON snapshot on an interval and on
 * shutdown so a local dev restart doesn't wipe credits/history. This stands
 * in for the Postgres/Redis pair from the design doc - swap for real
 * databases before this ever runs multi-instance or in production.
 */
export const state = {
  // tabId -> { lastHeartbeat, geo }. One entry per open browser tab/window.
  // geo is undefined (not yet looked up), null (lookup failed/private IP),
  // or { country, countryCode, city, lat, lon }. Never persisted to disk.
  sessions: new Map(),
  // userId -> { userId, credits, createdAt }
  users: new Map(),
  // { timestamp, activeVisitors }[] oldest -> newest
  history: [],
  // guessId -> guess record
  guesses: new Map(),
};

export function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    for (const u of parsed.users ?? []) state.users.set(u.userId, u);
    for (const g of parsed.guesses ?? []) state.guesses.set(g.id, g);
    state.history = parsed.history ?? [];
  } catch {
    // No snapshot yet (first run) - start fresh.
  }
}

export function persist() {
  const payload = {
    users: [...state.users.values()],
    guesses: [...state.guesses.values()],
    history: state.history,
  };
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload));
}

export function touchSession(tabId) {
  const existing = state.sessions.get(tabId);
  if (existing) existing.lastHeartbeat = Date.now();
  else state.sessions.set(tabId, { lastHeartbeat: Date.now(), geo: undefined });
}

export function removeSession(tabId) {
  state.sessions.delete(tabId);
}

export function sweepStaleSessions() {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  for (const [tabId, session] of state.sessions) {
    if (session.lastHeartbeat < cutoff) state.sessions.delete(tabId);
  }
}

export function activeVisitorCount() {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  let count = 0;
  for (const session of state.sessions.values()) {
    if (session.lastHeartbeat >= cutoff) count += 1;
  }
  return count;
}

// Whether tabId still needs a geo lookup kicked off (never attempted yet).
export function needsGeoLookup(tabId) {
  const session = state.sessions.get(tabId);
  return !!session && session.geo === undefined;
}

export function setSessionGeo(tabId, geo) {
  const session = state.sessions.get(tabId);
  if (session) session.geo = geo;
}

// Aggregated, privacy-lite view for the map: one point per active
// city/country pair with how many current sessions are there - never a
// per-visitor pin.
export function visitorLocations() {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  const buckets = new Map();
  for (const session of state.sessions.values()) {
    if (session.lastHeartbeat < cutoff || !session.geo) continue;
    const g = session.geo;
    const key = `${g.countryCode}:${g.city}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.count += 1;
    else
      buckets.set(key, {
        lat: g.lat,
        lon: g.lon,
        country: g.country,
        countryCode: g.countryCode,
        city: g.city,
        count: 1,
      });
  }
  return [...buckets.values()];
}

export function recordSnapshot() {
  const point = { timestamp: Date.now(), activeVisitors: activeVisitorCount() };
  state.history.push(point);
  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  while (state.history.length && state.history[0].timestamp < cutoff) {
    state.history.shift();
  }
  return point;
}

export function getHistory(sinceMs) {
  if (!sinceMs) return state.history;
  const cutoff = Date.now() - sinceMs;
  return state.history.filter((p) => p.timestamp >= cutoff);
}

export function getOrCreateUser(userId) {
  let id = userId;
  if (!id || !state.users.has(id)) {
    id = userId && typeof userId === "string" ? userId : randomUUID();
    if (!state.users.has(id)) {
      state.users.set(id, {
        userId: id,
        name: null,
        credits: STARTING_CREDITS,
        streak: 0,
        createdAt: Date.now(),
      });
    }
  }
  return state.users.get(id);
}

export function setUserName(userId, name) {
  const user = getOrCreateUser(userId);
  user.name = name;
  return user;
}

export function displayNameFor(userId) {
  const user = state.users.get(userId);
  if (!user) return `Player-${userId.slice(0, 4)}`;
  return user.name || `Player-${user.userId.slice(0, 4)}`;
}

export function applyStreak(userId, won) {
  const user = getOrCreateUser(userId);
  const current = user.streak || 0;
  if (won) {
    user.streak = current >= 0 ? current + 1 : 1;
  } else {
    user.streak = current <= 0 ? current - 1 : -1;
  }
  return user.streak;
}

export function saveGuess(guess) {
  state.guesses.set(guess.id, guess);
}

export function pendingGuesses() {
  return [...state.guesses.values()].filter((g) => g.status === "pending");
}

// Anonymized view of in-flight guesses for the "arena" activity feed - no
// userId, no stake/credits, just enough to render a live near-miss row.
export function pendingGuessesPublic() {
  return pendingGuesses().map((g) => ({
    id: g.id,
    displayName: displayNameFor(g.userId),
    low: g.low,
    high: g.high,
    targetTimestamp: g.targetTimestamp,
    multiplier: g.multiplier,
  }));
}

export function guessesForUser(userId) {
  return [...state.guesses.values()]
    .filter((g) => g.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function leaderboard(limit = 20) {
  return [...state.users.values()]
    .sort((a, b) => b.credits - a.credits)
    .slice(0, limit)
    .map((u, i) => ({
      rank: i + 1,
      userId: u.userId,
      displayName: displayNameFor(u.userId),
      credits: u.credits,
    }));
}
