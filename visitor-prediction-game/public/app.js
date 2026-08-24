const RANGE_MS = { "1h": 3_600_000, "3h": 10_800_000, "24h": 86_400_000 };
const HEARTBEAT_INTERVAL_MS = 10_000;

const el = (id) => document.getElementById(id);

const dot = el("connDot");
const creditsValue = el("creditsValue");
const visitorCount = el("visitorCount");
const chartCanvas = el("historyChart");
const chartStats = el("chartStats");
const rangeToggle = el("rangeToggle");
const horizonPresets = el("horizonPresets");
const horizonMinutes = el("horizonMinutes");
const lowInput = el("lowInput");
const highInput = el("highInput");
const stakeInput = el("stakeInput");
const multiplierValue = el("multiplierValue");
const payoutValue = el("payoutValue");
const placeGuessBtn = el("placeGuessBtn");
const guessError = el("guessError");
const guessesList = el("guessesList");
const leaderboardList = el("leaderboardList");
const arenaList = el("arenaList");
const streakLabel = el("streakLabel");
const toast = el("toast");
const nicknameInput = el("nicknameInput");

function uuid() {
  return crypto.randomUUID();
}

const tabId = sessionStorage.getItem("tabId") || uuid();
sessionStorage.setItem("tabId", tabId);

let userId = localStorage.getItem("userId") || uuid();
localStorage.setItem("userId", userId);

let currentRange = "1h";
let historyPoints = [];
let lastGuesses = [];
let hasSuggestedRange = false;
let latestCount = 0;
let activeGuesses = [];
let recentResults = [];
let revealInProgress = false;

// ---------- Heartbeat (defines "active visitor") ----------

function sendHeartbeat() {
  fetch("/api/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabId }),
  }).catch(() => {});
}
sendHeartbeat();
setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

window.addEventListener("pagehide", () => {
  navigator.sendBeacon?.("/api/leave", tabId);
});

// ---------- WebSocket (live push) ----------

function setConnected(isConnected) {
  dot.classList.toggle("connected", isConnected);
}

function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => setConnected(true);
  ws.onclose = () => {
    setConnected(false);
    setTimeout(connectWS, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "tick") updateVisitorCount(msg.count);
    else if (msg.type === "snapshot") {
      pushHistoryPoint(msg.point);
      drawChart();
    } else if (msg.type === "guessResult") handleGuessResult(msg.guess);
    else if (msg.type === "activeGuesses") {
      activeGuesses = msg.guesses;
      renderArena();
    }
  };
}
connectWS();

function updateVisitorCount(count) {
  latestCount = count;
  visitorCount.textContent = count;
  if (!hasSuggestedRange) {
    hasSuggestedRange = true;
    lowInput.value = Math.max(0, count - 5);
    highInput.value = count + 5;
    scheduleMultiplierPreview();
  }
  renderArena();
}

// ---------- History chart ----------

function pushHistoryPoint(point) {
  historyPoints.push(point);
  const cutoff = Date.now() - RANGE_MS[currentRange];
  while (historyPoints.length && historyPoints[0].timestamp < cutoff) {
    historyPoints.shift();
  }
}

async function fetchHistory(range) {
  const res = await fetch(`/api/history?range=${range}`);
  historyPoints = await res.json();
  drawChart();
}

function drawChart() {
  const ctx = chartCanvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = chartCanvas.clientWidth || 400;
  const cssHeight = 220;
  chartCanvas.width = cssWidth * dpr;
  chartCanvas.height = cssHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  if (historyPoints.length < 2) {
    chartStats.textContent = "Collecting data…";
    return;
  }

  const values = historyPoints.map((p) => p.activeVisitors);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(1, (max - min) * 0.15);
  const yMin = Math.max(0, min - pad);
  const yMax = max + pad;
  const t0 = historyPoints[0].timestamp;
  const t1 = historyPoints[historyPoints.length - 1].timestamp;

  const marginLeft = 30;
  const marginBottom = 18;
  const w = cssWidth - marginLeft - 8;
  const h = cssHeight - marginBottom - 8;

  const x = (t) => marginLeft + ((t - t0) / Math.max(1, t1 - t0)) * w;
  const y = (v) => 8 + h - ((v - yMin) / Math.max(1, yMax - yMin)) * h;

  // grid
  ctx.strokeStyle = "#262b45";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const gy = 8 + (h / 3) * i;
    ctx.beginPath();
    ctx.moveTo(marginLeft, gy);
    ctx.lineTo(cssWidth - 8, gy);
    ctx.stroke();
    const val = Math.round(yMax - ((yMax - yMin) / 3) * i);
    ctx.fillStyle = "#9aa0c0";
    ctx.font = "10px sans-serif";
    ctx.fillText(String(val), 2, gy + 3);
  }

  // area fill
  ctx.beginPath();
  ctx.moveTo(x(historyPoints[0].timestamp), y(historyPoints[0].activeVisitors));
  for (const p of historyPoints) ctx.lineTo(x(p.timestamp), y(p.activeVisitors));
  ctx.lineTo(x(t1), 8 + h);
  ctx.lineTo(x(t0), 8 + h);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, 8, 0, 8 + h);
  gradient.addColorStop(0, "rgba(124,107,255,0.35)");
  gradient.addColorStop(1, "rgba(124,107,255,0)");
  ctx.fillStyle = gradient;
  ctx.fill();

  // line
  ctx.beginPath();
  ctx.moveTo(x(historyPoints[0].timestamp), y(historyPoints[0].activeVisitors));
  for (const p of historyPoints) ctx.lineTo(x(p.timestamp), y(p.activeVisitors));
  ctx.strokeStyle = "#7c6bff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // x-axis time labels
  ctx.fillStyle = "#9aa0c0";
  ctx.font = "10px sans-serif";
  const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  ctx.fillText(fmt(t0), marginLeft, cssHeight - 4);
  ctx.fillText(fmt(t1), cssWidth - 44, cssHeight - 4);

  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  chartStats.innerHTML = `Now: <b>${values[values.length - 1]}</b> &middot; Min: <b>${min}</b> &middot; Max: <b>${max}</b> &middot; Avg: <b>${avg}</b>`;
}

rangeToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  currentRange = btn.dataset.range;
  [...rangeToggle.children].forEach((b) => b.classList.toggle("active", b === btn));
  fetchHistory(currentRange);
});

window.addEventListener("resize", () => drawChart());

// ---------- Live activity arena (other players' in-flight/resolved guesses) ----------

function renderArena() {
  const now = Date.now();
  recentResults = recentResults.filter((r) => r.expiresAt > now);

  const resolvedRows = recentResults.map((g) => {
    const won = g.status === "won";
    return `<div class="row-item arena-resolved ${won ? "won" : "lost"}">
      <div>
        <div>${g.displayName || "Player"} &middot; ${g.low}–${g.high}</div>
        <div class="muted">actual: <b>${g.actual}</b></div>
      </div>
      <span class="badge ${won ? "won" : "lost"}">${won ? `WIN x${g.multiplier.toFixed(2)}` : "LOSS"}</span>
    </div>`;
  });

  const pendingRows = [...activeGuesses]
    .sort((a, b) => a.targetTimestamp - b.targetTimestamp)
    .slice(0, 12)
    .map((g) => {
      const inRange = latestCount >= g.low && latestCount <= g.high;
      return `<div class="row-item">
        <div>
          <div>${g.displayName} &middot; ${g.low}–${g.high}</div>
          <div class="muted">live: <b class="arena-live ${inRange ? "in" : "out"}">${latestCount}</b> &middot; ${formatCountdown(g.targetTimestamp)}</div>
        </div>
        <span class="badge pending">x${g.multiplier.toFixed(2)}</span>
      </div>`;
    });

  const rows = [...resolvedRows, ...pendingRows];
  arenaList.innerHTML = rows.length
    ? rows.join("")
    : `<div class="row-item"><span class="muted">No predictions in flight right now.</span></div>`;
}

// ---------- Prediction form ----------

horizonPresets.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sec]");
  if (!btn) return;
  horizonMinutes.value = Number(btn.dataset.sec) / 60;
  [...horizonPresets.children].forEach((b) => b.classList.toggle("active", b === btn));
  scheduleMultiplierPreview();
});

let previewTimer = null;
function scheduleMultiplierPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updateMultiplierPreview, 200);
  [...horizonPresets.children].forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.sec) === Math.round(Number(horizonMinutes.value) * 60))
  );
}

[horizonMinutes, lowInput, highInput, stakeInput].forEach((input) =>
  input.addEventListener("input", scheduleMultiplierPreview)
);

async function updateMultiplierPreview() {
  const horizonSec = Math.round(Number(horizonMinutes.value) * 60);
  const low = Number(lowInput.value);
  const high = Number(highInput.value);
  if (!(horizonSec > 0) || !(high >= low)) {
    multiplierValue.textContent = "x–";
    payoutValue.textContent = "–";
    return;
  }
  try {
    const res = await fetch(`/api/multiplier-preview?horizonSec=${horizonSec}&low=${low}&high=${high}`);
    const data = await res.json();
    if (!res.ok) {
      multiplierValue.textContent = "x–";
      payoutValue.textContent = "–";
      return;
    }
    multiplierValue.textContent = `x${data.multiplier.toFixed(2)}`;
    const stake = Number(stakeInput.value) || 0;
    payoutValue.textContent = Math.round(stake * data.multiplier * 100) / 100;
  } catch {
    multiplierValue.textContent = "x–";
  }
}

placeGuessBtn.addEventListener("click", async () => {
  guessError.textContent = "";
  const horizonSec = Math.round(Number(horizonMinutes.value) * 60);
  const low = Number(lowInput.value);
  const high = Number(highInput.value);
  const stake = Number(stakeInput.value);
  placeGuessBtn.disabled = true;
  try {
    const res = await fetch("/api/guesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, horizonSec, low, high, stake }),
    });
    const data = await res.json();
    if (!res.ok) {
      guessError.textContent = data.error || "Something went wrong";
      return;
    }
    await Promise.all([fetchMe(), fetchGuesses()]);
  } catch {
    guessError.textContent = "Network error, please try again.";
  } finally {
    placeGuessBtn.disabled = false;
  }
});

// ---------- Me / balance ----------

let nicknameLoaded = false;

function streakText(streak) {
  const s = streak || 0;
  if (s >= 5) return { text: "Reading the crowd like a pro", cls: "hot" };
  if (s >= 3) return { text: "On a roll", cls: "hot" };
  if (s >= 1) return { text: "Warming up", cls: "hot" };
  if (s <= -5) return { text: "Ice cold", cls: "cold" };
  if (s <= -3) return { text: "Due for a bounce", cls: "cold" };
  if (s <= -1) return { text: "Cooling off", cls: "cold" };
  return { text: "", cls: "" };
}

async function fetchMe() {
  const res = await fetch(`/api/me?userId=${userId}`);
  const user = await res.json();
  userId = user.userId;
  localStorage.setItem("userId", userId);
  creditsValue.textContent = Math.round(user.credits * 100) / 100;
  const streak = streakText(user.streak);
  streakLabel.textContent = streak.text;
  streakLabel.className = `streak-tag ${streak.cls}`;
  if (!nicknameLoaded) {
    nicknameInput.value = user.name || "";
    nicknameInput.placeholder = `Player-${userId.slice(0, 4)}`;
    nicknameLoaded = true;
  }
}

let nicknameSaveTimer = null;
nicknameInput.addEventListener("input", () => {
  clearTimeout(nicknameSaveTimer);
  nicknameSaveTimer = setTimeout(saveNickname, 600);
});
nicknameInput.addEventListener("blur", saveNickname);

async function saveNickname() {
  clearTimeout(nicknameSaveTimer);
  try {
    await fetch("/api/me/name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, name: nicknameInput.value }),
    });
    fetchLeaderboard();
  } catch {
    // best-effort; the nickname just won't be saved this time
  }
}

// ---------- My guesses ----------

async function fetchGuesses() {
  const res = await fetch(`/api/guesses?userId=${userId}`);
  lastGuesses = await res.json();
  renderGuesses();
}

function renderGuesses() {
  if (!lastGuesses.length) {
    guessesList.innerHTML = `<div class="row-item"><span class="muted">No predictions yet.</span></div>`;
    return;
  }
  guessesList.innerHTML = lastGuesses
    .map((g) => {
      const badge =
        g.status === "pending"
          ? `<span class="badge pending">${formatCountdown(g.targetTimestamp)}</span>`
          : g.status === "won"
          ? `<span class="badge won">WIN x${g.multiplier.toFixed(2)}</span>`
          : `<span class="badge lost">LOSS</span>`;
      const actual = g.actual !== null ? ` &middot; actual: <b>${g.actual}</b>` : "";
      return `<div class="row-item" data-id="${g.id}" data-status="${g.status}">
        <div>
          <div>${g.low}–${g.high} &middot; stake ${g.stake}${actual}</div>
          <div class="muted">${new Date(g.createdAt).toLocaleTimeString()} → ${new Date(g.targetTimestamp).toLocaleTimeString()}</div>
        </div>
        ${badge}
      </div>`;
    })
    .join("");
}

function formatCountdown(targetTimestamp) {
  const remaining = Math.max(0, targetTimestamp - Date.now());
  const s = Math.ceil(remaining / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

setInterval(() => {
  if (!revealInProgress && lastGuesses.some((g) => g.status === "pending")) renderGuesses();
}, 1000);

function handleGuessResult(guess) {
  // Everyone sees every resolution in the live activity arena.
  recentResults.unshift({ ...guess, expiresAt: Date.now() + 6000 });
  activeGuesses = activeGuesses.filter((g) => g.id !== guess.id);
  renderArena();

  if (guess.userId !== userId) {
    fetchLeaderboard();
    return;
  }

  const row = guessesList.querySelector(`[data-id="${guess.id}"]`);
  if (row && row.dataset.status === "pending") {
    animateOwnReveal(row, guess);
  } else {
    finalizeOwnResult(guess);
  }
}

function animateOwnReveal(row, guess) {
  revealInProgress = true;
  row.dataset.status = "resolving";
  const badge = row.querySelector(".badge");
  if (badge) {
    badge.className = "badge pending";
    badge.textContent = "LOCKING IN…";
  }

  setTimeout(() => {
    const start = latestCount;
    const end = guess.actual;
    const duration = 700;
    const startTime = performance.now();
    function step(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const value = Math.round(start + (end - start) * t);
      if (badge) badge.textContent = String(value);
      if (t < 1) requestAnimationFrame(step);
      else finishReveal();
    }
    requestAnimationFrame(step);
  }, 600);

  function finishReveal() {
    const won = guess.status === "won";
    row.classList.add(won ? "reveal-flash-win" : "reveal-flash-lose");
    if (badge) {
      badge.className = `badge ${won ? "won" : "lost"}`;
      badge.textContent = won ? `WIN x${guess.multiplier.toFixed(2)}` : "LOSS";
    }
    setTimeout(() => {
      revealInProgress = false;
      finalizeOwnResult(guess);
    }, 900);
  }
}

function finalizeOwnResult(guess) {
  fetchMe();
  fetchGuesses();
  fetchLeaderboard();
  const won = guess.status === "won";
  showToast(
    won ? "win" : "lose",
    won
      ? `You won! Guess: ${guess.low}–${guess.high}, actual: ${guess.actual}. Payout: ${guess.payout}`
      : `You lost. Guess: ${guess.low}–${guess.high}, actual: ${guess.actual}.`
  );
}

function showToast(kind, text) {
  toast.textContent = text;
  toast.className = `toast show ${kind}`;
  setTimeout(() => toast.classList.remove("show"), 5000);
}

// ---------- Leaderboard ----------

async function fetchLeaderboard() {
  const res = await fetch("/api/leaderboard");
  const rows = await res.json();
  leaderboardList.innerHTML = rows
    .map(
      (r) => `<div class="row-item ${r.userId === userId ? "me" : ""}">
        <span>#${r.rank} ${r.displayName}${r.userId === userId ? " (you)" : ""}</span>
        <span>${Math.round(r.credits * 100) / 100}</span>
      </div>`
    )
    .join("");
}

setInterval(fetchLeaderboard, 15000);

// ---------- Init ----------

(async function init() {
  renderArena();
  await Promise.all([fetchMe(), fetchHistory(currentRange), fetchGuesses(), fetchLeaderboard()]);
  const cur = await fetch("/api/current-visitors").then((r) => r.json());
  updateVisitorCount(cur.count);
  updateMultiplierPreview();
})();
