import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import {
  PERSIST_INTERVAL_MS,
  SESSION_SWEEP_MS,
  SNAPSHOT_INTERVAL_MS,
  TICK_BROADCAST_MS,
} from "./config.js";
import { placeGuess, previewMultiplier, resolveGuess, ValidationError } from "./guesses.js";
import { updateVolatilityModel } from "./multiplier.js";
import {
  activeVisitorCount,
  getHistory,
  getOrCreateUser,
  guessesForUser,
  leaderboard,
  load,
  pendingGuesses,
  pendingGuessesPublic,
  persist,
  recordSnapshot,
  removeSession,
  setUserName,
  sweepStaleSessions,
  touchSession,
} from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

load();

const app = express();
app.use(express.json());
app.use(express.text({ type: "text/plain" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const RANGE_MS = { "1h": 3_600_000, "3h": 10_800_000, "24h": 86_400_000 };

app.get("/api/me", (req, res) => {
  const user = getOrCreateUser(req.query.userId);
  res.json(user);
});

app.post("/api/me/name", (req, res) => {
  const { userId, name } = req.body || {};
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId required" });
  }
  const trimmed = typeof name === "string" ? name.trim().slice(0, 20) : "";
  const user = setUserName(userId, trimmed || null);
  res.json(user);
});

app.post("/api/heartbeat", (req, res) => {
  const { tabId } = req.body || {};
  if (!tabId || typeof tabId !== "string") {
    return res.status(400).json({ error: "tabId required" });
  }
  touchSession(tabId);
  res.json({ count: activeVisitorCount() });
});

app.post("/api/leave", (req, res) => {
  const tabId = typeof req.body === "string" ? req.body : req.body?.tabId;
  if (tabId) removeSession(tabId);
  res.status(204).end();
});

app.get("/api/current-visitors", (_req, res) => {
  res.json({ count: activeVisitorCount(), timestamp: Date.now() });
});

app.get("/api/history", (req, res) => {
  const sinceMs = RANGE_MS[req.query.range] ?? RANGE_MS["3h"];
  res.json(getHistory(sinceMs));
});

app.get("/api/multiplier-preview", (req, res) => {
  try {
    const horizonSec = Number(req.query.horizonSec);
    const low = Number(req.query.low);
    const high = Number(req.query.high);
    res.json(previewMultiplier({ horizonSec, low, high }));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.post("/api/guesses", (req, res) => {
  try {
    const { userId, horizonSec, low, high, stake } = req.body || {};
    const guess = placeGuess({
      userId,
      horizonSec: Number(horizonSec),
      low: Number(low),
      high: Number(high),
      stake: Number(stake),
    });
    res.status(201).json(guess);
    broadcastActiveGuesses();
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.get("/api/guesses", (req, res) => {
  res.json(guessesForUser(req.query.userId));
});

app.get("/api/leaderboard", (_req, res) => {
  res.json(leaderboard());
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

function broadcastActiveGuesses() {
  broadcast({ type: "activeGuesses", guesses: pendingGuessesPublic() });
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  ws.send(
    JSON.stringify({ type: "tick", count: activeVisitorCount(), timestamp: Date.now() })
  );
  ws.send(JSON.stringify({ type: "activeGuesses", guesses: pendingGuessesPublic() }));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 20_000);

setInterval(sweepStaleSessions, SESSION_SWEEP_MS);

setInterval(() => {
  broadcast({ type: "tick", count: activeVisitorCount(), timestamp: Date.now() });
}, TICK_BROADCAST_MS);

let snapshotTicks = 0;
setInterval(() => {
  const point = recordSnapshot();
  broadcast({ type: "snapshot", point });
  snapshotTicks += 1;
  if (snapshotTicks % 4 === 0) updateVolatilityModel(getHistory());
}, SNAPSHOT_INTERVAL_MS);

setInterval(() => {
  const now = Date.now();
  let resolvedAny = false;
  for (const guess of pendingGuesses()) {
    if (guess.targetTimestamp <= now) {
      const actual = activeVisitorCount();
      resolveGuess(guess, actual);
      broadcast({ type: "guessResult", guess });
      resolvedAny = true;
    }
  }
  if (resolvedAny) broadcastActiveGuesses();
}, 1000);

setInterval(persist, PERSIST_INTERVAL_MS);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    persist();
    process.exit(0);
  });
}

server.listen(PORT, () => {
  console.log(`Anticipate listening on http://localhost:${PORT}`);
});
