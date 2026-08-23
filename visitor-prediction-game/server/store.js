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
  // tabId -> lastHeartbeat epoch ms. One entry per open browser tab/window.
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
  state.sessions.set(tabId, Date.now());
}

export function removeSession(tabId) {
  state.sessions.delete(tabId);
}

export function sweepStaleSessions() {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  for (const [tabId, lastSeen] of state.sessions) {
    if (lastSeen < cutoff) state.sessions.delete(tabId);
  }
}

export function activeVisitorCount() {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  let count = 0;
  for (const lastSeen of state.sessions.values()) {
    if (lastSeen >= cutoff) count += 1;
  }
  return count;
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
        credits: STARTING_CREDITS,
        createdAt: Date.now(),
      });
    }
  }
  return state.users.get(id);
}

export function saveGuess(guess) {
  state.guesses.set(guess.id, guess);
}

export function pendingGuesses() {
  return [...state.guesses.values()].filter((g) => g.status === "pending");
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
      displayName: `Player-${u.userId.slice(0, 4)}`,
      credits: u.credits,
    }));
}
