/**
 * Client bootstrap: nickname entry, scene + input, and keeping the HUD,
 * scoreboard, name labels and reset-vote UI in sync with the authoritative
 * match state. Sends throttled activity pings so the server can idle-kick.
 */
import {
  PLAYER,
  REACTIONS,
  sanitizeName,
  type InputMsg,
  type MatchMsg,
  type Role,
  type Slot,
  type Team,
} from "@padel/shared";
import { Input } from "./input.js";
import { InterpBuffer } from "./interp.js";
import type { ConnStatus } from "./net.js";
import { Net } from "./net.js";
import { PadelScene } from "./scene.js";
import { Predictor, fixedSteps } from "./predict.js";

const app = document.getElementById("app")!;
const hud = document.getElementById("hud")!;
const hint = document.getElementById("hint")!;
const scoreboard = document.getElementById("scoreboard")!;
const flash = document.getElementById("flash")!;
const servePrompt = document.getElementById("serveprompt")!;
const labels = document.getElementById("labels")!;
const resetbtn = document.getElementById("resetbtn")!;
const votepanel = document.getElementById("votepanel")!;
const nickname = document.getElementById("nickname")!;
const nickInput = document.getElementById("nick-input") as HTMLInputElement;
const nickGo = document.getElementById("nick-go")!;
const nickMsg = document.getElementById("nick-msg")!;
const serving = document.getElementById("serving")!;
const loading = document.getElementById("loading")!;
const loadingTitle = document.getElementById("loading-title")!;
const loadingHint = document.getElementById("loading-hint")!;
const reactbar = document.getElementById("reactbar")!;
const reactionsEl = document.getElementById("reactions")!;

const BASE = import.meta.env.BASE_URL;

const scene = new PadelScene(app);
if (import.meta.env.DEV) (window as unknown as { __padelScene: PadelScene }).__padelScene = scene;
const interp = new InterpBuffer();
const seenSlots = new Set<string>();

let input: Input | null = null;
let role: Role = "spectator";
let selfSlot: Slot | null = null;
let selfTeam: Team | null = null;
let ownPos: { x: number; z: number } | null = null;
let inputSeq = 0;
const predictor = new Predictor();
let stepAccum = 0;
let carrySwing = false;
let carryServe = false;
let selfYaw = 0;
let outdated = false;
let devBots = 0;

let match: MatchMsg | null = null;

/** z-sign of the half our team defends right now (changes on ends-swaps). */
function selfSide(): -1 | 1 {
  const sideA = match?.sideA ?? -1;
  return selfTeam === "B" ? (sideA === -1 ? 1 : -1) : sideA;
}

/** True while we are the server waiting to serve: the server pins us in place. */
function selfLocked(): boolean {
  return match !== null && match.phase === "serve" && match.serverSlot === selfSlot;
}
let lastFlashed: string | null = null;
let lastHighlightKey: string | null = null;
let flashTimer: number | undefined;
const names = new Map<Slot, { name: string; team: Team }>();
const tags = new Map<Slot, HTMLDivElement>();

const state = {
  status: "idle" as ConnStatus | "idle",
  role: "—",
  slot: "" as string,
  players: 0,
  spectators: 0,
};

function renderHud(): void {
  const statusClass = state.status === "open" ? "status-good" : "status-bad";
  const statusLabel =
    state.status === "open"
      ? "connected"
      : state.status === "connecting"
        ? "connecting…"
        : state.status === "reconnecting"
          ? "server waking up / reconnecting…"
          : "—";
  hud.innerHTML = `
    <div>🎾 <strong>Padel 2v2</strong></div>
    <div>status: <span class="${statusClass}">${statusLabel}</span></div>
    <div>you: <span class="role">${state.role}${
      state.slot ? ` (${state.slot})` : ""
    }</span></div>
    <div>players: ${state.players}/4 · spectators: ${state.spectators}</div>
    ${
      state.role === "player"
        ? `<div style="margin-top:4px;opacity:.7;font-size:12px">
      <strong>B</strong> add bot · <strong>N</strong> clear bots
    </div>`
        : ""
    }
  `;
}

function teamOfSlot(slot: Slot | null): Team | null {
  return slot ? (slot.startsWith("A") ? "A" : "B") : null;
}

const SEATS: Slot[] = ["A1", "A2", "B1", "B2"];
let lastCheered: string | null = null;

/** Push the current match state and seated names to the LED boards. */
function renderBoards(): void {
  scene.setBoards({
    phase: match?.phase ?? "warmup",
    gamesA: match?.gamesA ?? 0,
    gamesB: match?.gamesB ?? 0,
    pointA: match?.pointA ?? "0",
    pointB: match?.pointB ?? "0",
    names: SEATS.map((s) => names.get(s)?.name ?? ""),
    reaction: null,
  });
}

/** Cheer once per new point/game/set event. */
function maybeCheer(event: string | null): void {
  if (event === lastCheered) return;
  lastCheered = event;
  if (event && /^(Point|Game|Set)/.test(event)) scene.cheer(event.startsWith("Point") ? 0.5 : 1);
}

function renderServing(): void {
  const m = match;
  if (m && m.serverSlot && (m.phase === "serve" || m.phase === "rally")) {
    const nm = names.get(m.serverSlot)?.name ?? m.serverSlot;
    serving.textContent = `🎾 ${nm} is serving`;
    serving.style.display = "block";
  } else {
    serving.style.display = "none";
  }
}

function renderScoreboard(): void {
  renderServing();
  if (!match || match.phase === "warmup") {
    scoreboard.innerHTML = match
      ? `<span>Warm-up · need a player on each team to start a match</span>`
      : "";
    servePrompt.style.display = "none";
    return;
  }
  const serveTeam = teamOfSlot(match.serverSlot);
  const tag = (team: Team, label: string, color: string, games: number, pts: string) => `
    <span class="team ${team === "A" ? "blue" : "red"}">
      <span class="dot" style="background:${color}"></span>${label}
      <span class="pts">${games} &nbsp; ${pts}</span>${serveTeam === team ? " 🎾" : ""}
    </span>`;
  scoreboard.innerHTML =
    tag("A", "BLUE", "#3b82f6", match.gamesA, match.pointA) +
    `<span style="opacity:.4">vs</span>` +
    tag("B", "RED", "#ef4444", match.gamesB, match.pointB) +
    (match.phase === "over"
      ? ` <span class="serving">— match over</span>`
      : match.tiebreak
        ? ` <span class="serving">tiebreak</span>`
        : "");

  if (match.phase === "serve" && match.awaitingServe) {
    if (match.serverSlot === selfSlot) {
      servePrompt.textContent = "🎾 Your serve — press SPACE";
      servePrompt.className = "";
    } else {
      servePrompt.textContent = `Waiting for ${match.serverSlot} to serve…`;
      servePrompt.className = "waiting";
    }
    servePrompt.style.display = "block";
  } else {
    servePrompt.style.display = "none";
  }
}

function maybeFlash(): void {
  if (!match) return;
  if (match.phase === "serve") lastFlashed = null;
  const e = match.event;
  if (!e || e === lastFlashed || match.phase === "rally") return;
  lastFlashed = e;
  const title = document.createElement("div");
  title.textContent = e;
  flash.replaceChildren(title);
  if (match.reason) {
    const why = document.createElement("div");
    why.style.cssText = "font-size:16px;font-weight:600;opacity:.9;margin-top:6px";
    why.textContent = match.reason;
    flash.append(why);
  }
  flash.classList.add("show");
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => flash.classList.remove("show"), 2000);
}

function renderVote(active: boolean, initiator = "", accepted = 0, needed = 0): void {
  if (!(active && role === "player")) {
    votepanel.style.display = "none";
    return;
  }
  // Built with DOM nodes: the initiator's nickname is user input.
  const who = document.createElement("strong");
  who.textContent = initiator;
  const line = document.createElement("div");
  line.append(who, " wants to reset the set.");
  const count = document.createElement("div");
  count.style.cssText = "opacity:.8;margin-top:4px";
  count.textContent = `${accepted}/${needed} players accepted`;
  const accept = document.createElement("button");
  accept.className = "accept";
  accept.textContent = "Accept";
  accept.addEventListener("click", () => net.send({ t: "votereset" }));
  const decline = document.createElement("button");
  decline.className = "decline";
  decline.textContent = "Decline";
  decline.addEventListener("click", () => net.send({ t: "votedecline" }));
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(accept, decline);
  votepanel.replaceChildren(line, count, actions);
  votepanel.style.display = "block";
}

function showLoading(status: ConnStatus): void {
  // Only relevant once the player has chosen to connect (nickname dismissed).
  if (nickname.style.display !== "none") return;
  loadingTitle.textContent =
    status === "reconnecting" ? "Reconnecting…" : "Waking up the server…";
  loadingHint.textContent =
    status === "open"
      ? "Connected — entering the court…"
      : status === "reconnecting"
        ? "The server went to sleep — waking it back up…"
        : "Connecting…";
  loading.classList.add("show");
}

function hideLoading(): void {
  loading.classList.remove("show");
}

const net = new Net({
  onStatus: (s) => {
    state.status = s;
    if (s === "closed") hideLoading();
    else showLoading(s);
    renderHud();
  },
  onWelcome: (msg) => {
    predictor.reset();
    stepAccum = 0;
    hideLoading();
    role = msg.role;
    state.role = msg.role;
    state.slot = msg.slot ?? "";
    scene.buildCourt(msg.court);
    if (msg.role === "player" && msg.slot && msg.team) {
      selfSlot = msg.slot;
      selfTeam = msg.team;
      scene.setPlayerCamera(msg.team);
      input?.dispose();
      input = new Input(scene.domElement);
      hint.style.display = "block";
      resetbtn.style.display = "block";
    } else {
      input?.dispose();
      input = null;
      selfSlot = null;
      scene.setSpectatorCamera();
      hint.style.display = "none";
      resetbtn.style.display = "none";
    }
    if (msg.role === "player" && devBots > 0) {
      for (let i = 0; i < devBots; i++) net.send({ t: "addbot" });
      devBots = 0;
    }
    renderHud();
  },
  onRoster: (msg) => {
    state.players = msg.players.length;
    state.spectators = msg.spectatorCount;
    names.clear();
    for (const p of msg.players) names.set(p.slot, { name: p.name, team: p.team });
    renderHud();
    renderServing();
    renderBoards();
  },
  onMatch: (msg) => {
    match = msg;
    renderScoreboard();
    renderBoards();
    maybeCheer(msg.event);
    maybeFlash();
    const hk = msg.highlight ? JSON.stringify(msg.highlight) : null;
    if (hk && hk !== lastHighlightKey) scene.showFault(msg.highlight!);
    lastHighlightKey = hk;
  },
  onVote: (msg) => renderVote(msg.active, msg.initiator, msg.accepted, msg.needed),
  onKicked: (reason) => {
    showNickname(reason);
  },
  onOutdated: () => {
    outdated = true;
    hideLoading();
    nickInput.style.display = "none";
    nickGo.textContent = "Reload";
    nickMsg.textContent = "A new version of Meuss Padel Club is out.";
    nickname.style.display = "flex";
  },
  onReaction: (msg) => showReaction(msg.slot, msg.id),
  onSnapshot: (msg) => {
    interp.add(msg);
    if (selfSlot) {
      const me = msg.players.find((p) => p.slot === selfSlot);
      if (me) predictor.reconcile({ x: me.pos.x, z: me.pos.z }, me.ack, selfSide(), selfLocked());
    }
    for (const p of msg.players) {
      if (p.swing && p.slot !== selfSlot) scene.triggerSwing(p.slot);
    }
  },
});

// ── Nickname / connection flow ───────────────────────────────────────────────

function showNickname(message = ""): void {
  hideLoading();
  nickMsg.textContent = message;
  nickname.style.display = "flex";
  resetbtn.style.display = "none";
  votepanel.style.display = "none";
  nickInput.focus();
}

function play(): void {
  if (outdated) {
    location.reload();
    return;
  }
  const name = sanitizeName(nickInput.value, "Player");
  nickname.style.display = "none";
  net.connect(name);
}

nickGo.addEventListener("click", play);
nickInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") play();
});
resetbtn.addEventListener("click", () => net.send({ t: "votereset" }));
showNickname();

// Dev-only: ?join=<name>&bots=<n> skips the nickname card (used by `pnpm shoot`).
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  const auto = q.get("join");
  if (auto !== null) {
    devBots = Math.max(0, Math.min(3, Number(q.get("bots") ?? 0) || 0));
    nickInput.value = auto;
    play();
  }
}

// ── Activity pings (throttled) so the server can idle-kick ───────────────────

let lastActivity = 0;
function ping(): void {
  const now = performance.now();
  if (now - lastActivity > 5000) {
    lastActivity = now;
    net.send({ t: "activity" });
  }
}
for (const ev of ["mousemove", "keydown", "mousedown"] as const) {
  window.addEventListener(ev, ping);
}

// Reaction picker: build the bar, toggle with E (players only).
for (const id of REACTIONS) {
  const img = document.createElement("img");
  img.src = `${BASE}reactions/${id}.png`;
  img.title = id;
  img.addEventListener("click", () => {
    net.send({ t: "react", id });
    reactbar.classList.remove("open");
  });
  reactbar.appendChild(img);
}

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "KeyB" && role === "player") net.send({ t: "addbot" });
  else if (e.code === "KeyN" && role === "player") net.send({ t: "clearbots" });
  else if (e.code === "KeyE" && role === "player" && nickname.style.display === "none") {
    reactbar.classList.toggle("open");
  }
});

// ── Emote reactions over avatars ─────────────────────────────────────────────

interface ActiveReaction {
  slot: Slot;
  el: HTMLImageElement;
  born: number;
}
const reactionList: ActiveReaction[] = [];

function showReaction(slot: Slot, id: string): void {
  // One reaction per player at a time — replace any existing.
  for (let i = reactionList.length - 1; i >= 0; i--) {
    if (reactionList[i]!.slot === slot) {
      reactionList[i]!.el.remove();
      reactionList.splice(i, 1);
    }
  }
  const img = document.createElement("img");
  img.className = "reaction";
  img.src = `${BASE}reactions/${id}.png`;
  reactionsEl.appendChild(img);
  reactionList.push({ slot, el: img, born: performance.now() });
}

function updateReactions(framePos: Map<string, { x: number; z: number }>): void {
  const now = performance.now();
  for (let i = reactionList.length - 1; i >= 0; i--) {
    const r = reactionList[i]!;
    const age = now - r.born;
    if (age > 2600) {
      r.el.remove();
      reactionList.splice(i, 1);
      continue;
    }
    const pos = framePos.get(r.slot);
    if (!pos) {
      r.el.style.display = "none";
      continue;
    }
    const p = scene.projectToScreen(pos.x, PLAYER.height + 1.4, pos.z);
    if (!p.visible) {
      r.el.style.display = "none";
      continue;
    }
    r.el.style.display = "block";
    r.el.style.left = `${p.x}px`;
    r.el.style.top = `${p.y}px`;
    r.el.style.opacity = age > 2200 ? String(1 - (age - 2200) / 400) : "1";
  }
}

// ── Render / input loop ──────────────────────────────────────────────────────

renderHud();

scene.start((dt) => {
  // Input and fixed-step sends run first so this frame's applyInput is already
  // reflected in the predicted position sampled below. Aim uses last frame's ownPos.
  if (input) {
    const i = input.poll();
    // A click between ticks must still reach the next tick.
    carrySwing ||= i.swing;
    carryServe ||= i.serve;
    const aim =
      ownPos !== null
        ? scene.aimFromPointer(i.pointer.x, i.pointer.y, ownPos.x, ownPos.z)
        : { x: 0, z: selfTeam === "A" ? 1 : -1 };
    if (aim.x !== 0 || aim.z !== 0) selfYaw = Math.atan2(aim.x, aim.z);
    const { steps, accumulator } = fixedSteps(stepAccum, dt);
    stepAccum = accumulator;
    for (let k = 0; k < steps; k++) {
      const msg: InputMsg = {
        t: "input",
        seq: inputSeq++,
        ts: performance.now(),
        move: i.move,
        aim,
        swing: carrySwing,
        serve: carryServe,
      };
      carrySwing = false;
      carryServe = false;
      net.send(msg);
      predictor.applyInput({ seq: msg.seq, move: msg.move }, selfSide(), selfLocked());
    }
    if (i.swing && selfSlot) scene.triggerSwing(selfSlot);
  }

  interp.update(dt * 1000);
  const s = interp.sample();
  const framePos = new Map<string, { x: number; z: number }>();
  if (s) {
    scene.setBall(s.ball.x, s.ball.y, s.ball.z);
    const present = new Set<string>();
    const predicted = predictor.renderPosition(dt);
    for (const p of s.players) {
      present.add(p.slot);
      seenSlots.add(p.slot);
      const mine = p.slot === selfSlot && predicted !== null;
      const x = mine ? predicted.x : p.pos.x;
      const z = mine ? predicted.z : p.pos.z;
      framePos.set(p.slot, { x, z });
      scene.setPlayer(p.slot, x, p.pos.y, z, mine ? selfYaw : p.yaw);
      updateLabel(p.slot, x, z);
      if (p.slot === selfSlot) {
        ownPos = { x, z };
        scene.focusCamera(x, p.pos.y, z);
      }
    }
    for (const slot of seenSlots) {
      if (!present.has(slot)) {
        scene.removePlayer(slot as Slot);
        removeLabel(slot as Slot);
        seenSlots.delete(slot);
      }
    }
  }
  updateReactions(framePos);
});

// ── Name labels above avatars ────────────────────────────────────────────────

function updateLabel(slot: Slot, x: number, z: number): void {
  const info = names.get(slot);
  if (!info) {
    removeLabel(slot);
    return;
  }
  let el = tags.get(slot);
  if (!el) {
    el = document.createElement("div");
    el.className = `nametag ${info.team}`;
    labels.appendChild(el);
    tags.set(slot, el);
  }
  el.textContent = info.name;
  const p = scene.projectToScreen(x, PLAYER.height + 0.55, z);
  if (p.visible) {
    el.style.display = "block";
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  } else {
    el.style.display = "none";
  }
}

function removeLabel(slot: Slot): void {
  const el = tags.get(slot);
  if (el) {
    el.remove();
    tags.delete(slot);
  }
}
