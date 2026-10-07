/**
 * Client bootstrap: nickname entry, scene + input, and keeping the HUD,
 * scoreboard, name labels and reset-vote UI in sync with the authoritative
 * match state. Sends throttled activity pings so the server can idle-kick.
 */
import {
  PLAYER,
  REACTIONS,
  sanitizeName,
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
let outdated = false;

let match: MatchMsg | null = null;
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
    renderHud();
  },
  onRoster: (msg) => {
    state.players = msg.players.length;
    state.spectators = msg.spectatorCount;
    names.clear();
    for (const p of msg.players) names.set(p.slot, { name: p.name, team: p.team });
    renderHud();
    renderServing();
  },
  onMatch: (msg) => {
    match = msg;
    renderScoreboard();
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
  interp.update(dt * 1000);
  const s = interp.sample();
  const framePos = new Map<string, { x: number; z: number }>();
  if (s) {
    scene.setBall(s.ball.x, s.ball.y, s.ball.z);
    const present = new Set<string>();
    for (const p of s.players) {
      present.add(p.slot);
      seenSlots.add(p.slot);
      framePos.set(p.slot, { x: p.pos.x, z: p.pos.z });
      scene.setPlayer(p.slot, p.pos.x, p.pos.y, p.pos.z, p.yaw);
      updateLabel(p.slot, p.pos.x, p.pos.z);
      if (p.slot === selfSlot) {
        ownPos = { x: p.pos.x, z: p.pos.z };
        scene.focusCamera(p.pos.x, p.pos.y, p.pos.z);
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

  if (input) {
    const i = input.poll();
    const aim =
      ownPos !== null
        ? scene.aimFromPointer(i.pointer.x, i.pointer.y, ownPos.x, ownPos.z)
        : { x: 0, z: selfTeam === "A" ? 1 : -1 };
    net.send({
      t: "input",
      seq: inputSeq++,
      ts: performance.now(),
      move: i.move,
      aim,
      swing: i.swing,
      serve: i.serve,
    });
    if (i.swing && selfSlot) scene.triggerSwing(selfSlot);
  }
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
