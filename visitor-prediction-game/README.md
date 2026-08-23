# Realtime Visitor Prediction Game — MVP

A live dashboard where the website's own real-time visitor count *is* the
game: players predict how many active visitors there will be at a future
point in time, choosing both the target time and the visitor-count range.
The narrower the range and the further out the time, the higher the payout
multiplier. Virtual credits only — no real money.

This is the Phase 1 ("core game loop") implementation from the project
brief, built to run entirely on one machine with zero external services.

## Running it

```bash
cd visitor-prediction-game
npm install
npm start        # or: npm run dev  (auto-restarts on file changes)
```

Open `http://localhost:3000` in **several browser tabs/windows** (or from
several devices on the same network, using your machine's LAN IP instead of
localhost) — each open tab counts as one active visitor, live, on the
dashboard.

To sanity-check the payout model:

```bash
npm run simulate
```

## How the pieces fit together

```
Browser tab
  |
  |  POST /api/heartbeat every 10s   (defines "active visitor")
  |  WebSocket /ws                    (live count, chart ticks, results)
  v
Express + ws server (server/index.js)
  |
  +-- session registry (in-memory, server/store.js)
  +-- visitor history snapshots, every 5s
  +-- guesses + resolution loop (server/guesses.js)
  +-- multiplier / volatility model (server/multiplier.js)
  v
JSON snapshot file (data/state.json) — persisted every 10s
```

No Postgres/Redis: an MVP running on a single process doesn't need them, so
this uses in-memory state with a periodic JSON snapshot for durability
across restarts. The `users` / `guesses` / `visitor_snapshots` shape mirrors
the tables proposed in the design doc, so swapping in a real database later
is a storage-layer change, not a redesign — see "Scaling beyond the MVP"
below.

## Game loop, end to end

1. Every open tab sends a heartbeat; a tab counts as an **active visitor**
   as long as its last heartbeat was less than 30 seconds ago.
2. Every 5 seconds the server snapshots the active count into history — this
   feeds both the chart and the multiplier model.
3. The player picks a horizon (1 min demo / 5 min / 30 min / 2 h / custom)
   and a visitor-count range, sees a live multiplier, and places a guess for
   a stake in virtual credits.
4. The moment the target time arrives, the server resolves the guess against
   the *live* active-visitor count at that instant (no waiting for the next
   snapshot) and updates the player's balance and the leaderboard.
5. Results push to the browser over WebSocket — no polling/refresh needed.

## The multiplier model

Implemented in `server/multiplier.js`. Rather than a hand-picked table of
multipliers, it's derived from a statistical model so the pricing stays
sane as horizons and ranges vary continuously:

1. Treat the future visitor count as a **random walk from the current
   count** (no attempt to predict trend direction — only the spread).
2. Estimate the standard deviation of that walk at a horizon from the site's
   *own* recorded history: sample how much the count actually moved over
   that many seconds, historically, and use the empirical stddev. For
   horizons without enough samples yet (cold start, or an unusual horizon),
   scale from the nearest measured horizon assuming variance grows linearly
   with time (`sigma(H) = sigma_ref * sqrt(H / H_ref)`), falling back to a
   flat 15%-of-current-count heuristic when there's no history at all.
3. Compute the probability the actual count lands in the requested range
   using the normal CDF (with a continuity correction, since visitor counts
   are integers).
4. Fair-odds multiplier = `1 / probability`; apply a flat **5% house edge**
   on top; clamp to `[1.01x, 50x]` so a badly-priced tail guess can't blow a
   hole in the credit pool.

### Validating it: `npm run simulate`

`scripts/simulate.js` generates 48 hours of synthetic traffic (a random walk
with a mean-reverting daily seasonal curve layered on top — deliberately
*not* a pure random walk, to stress-test the model's assumptions), runs the
real pricing code against it for thousands of synthetic guesses, and reports
the realized platform edge versus the configured 5%.

Current finding, worth being upfront about: the realized edge comes out
higher than 5% and uneven across horizons (see the script's output). That's
the "no drift, current count is the best guess" assumption breaking down
against traffic that actually has a predictable daily shape — the model
prices every horizon as if tomorrow's shape is as uncertain as this
minute's, which isn't true once there's enough history to see the curve.
Before this goes anywhere near real money, the fix is to feed a
seasonal/time-of-day baseline into the mean instead of a flat "current
count," and to recalibrate sigma per horizon against realized outcomes
rather than only against historical *movement*. That's flagged as an open
item, not silently smoothed over.

## Design decisions made on your behalf

The brief calls out several open questions (section 11) that needed an
answer to actually ship an MVP. Here's what this build assumes, and why:

| Question | Decision |
|---|---|
| What counts as "active"? | Last heartbeat < 30s ago (per-tab, via `sessionStorage`'s ephemeral ID — reload keeps it, closing the tab doesn't). Opening the same page in two tabs correctly counts as two visitors, per the brief's explicit test ("multiple browser windows appear as active visitors"). |
| Heartbeat interval | 10s, well under the 30s window, so one dropped request doesn't flip a tab inactive. |
| Official measurement at resolution | The *live* active-visitor count computed at the instant the target time is reached — not a possibly-stale periodic snapshot. |
| Bots / inflating the count | Not solved here — heartbeats are unauthenticated and trivially scriptable. Documented as a known gap; the real fix (rate-limiting per IP, proof-of-work or session tokens tied to a real page load, anomaly detection on registration bursts) is Phase 2+ work once there's real traffic to tune against. |
| Accounts | None. A `userId` persisted in `localStorage` stands in for an account — credits and guess history survive reloads on the same browser, but there's no cross-device identity or auth. Good enough for a local MVP; real accounts are a Phase 2 item. |
| Virtual currency | A single `credits` balance per anonymous user, starting at 1000, adjusted directly server-side on guess placement/resolution. No packs/purchases wired up (that's Phase 3, monetization, deliberately out of scope here). |
| Min/max horizon | 15s (demo-friendly) to 24h, enforced server-side (`server/config.js`). |
| Leaderboard | Simple top-20 by current credit balance, refreshed on every guess resolution and every 15s otherwise. |

## What's deliberately not here

Per the brief's own phasing, this is Phase 1 only. Not implemented:
accounts/auth, real payments, daily challenges/streaks/XP, ads, sponsored
challenges, tournaments, and the B2B/analytics layer. The architecture
doesn't block adding them — guesses/users/history are already separate,
swappable modules — it's just scoped out so the MVP doesn't get top-heavy
before the core loop is proven fun.

## API

```
GET  /api/current-visitors            -> { count, timestamp }
GET  /api/history?range=1h|3h|24h     -> [{ timestamp, activeVisitors }]
POST /api/heartbeat  { tabId }        -> { count }
POST /api/leave      tabId            -> 204   (sendBeacon on tab close)
GET  /api/me?userId=                  -> { userId, credits, createdAt }
GET  /api/multiplier-preview?horizonSec=&low=&high=
POST /api/guesses   { userId, horizonSec, low, high, stake }
GET  /api/guesses?userId=
GET  /api/leaderboard
WS   /ws  ->  { type: "tick" | "snapshot" | "guessResult", ... }
```

## Scaling beyond the MVP

Swap `server/store.js`'s in-memory maps for Postgres (users, guesses,
visitor_snapshots tables) and the session registry for Redis once this
needs to run across more than one process — the rest of the code (routing,
multiplier model, resolution loop) doesn't need to change to do that.
