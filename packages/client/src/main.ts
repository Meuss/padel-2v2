/**
 * Client bootstrap: nickname entry, scene + input, and keeping the HUD,
 * scoreboard, name labels and reset-vote UI in sync with the authoritative
 * match state. Sends throttled activity pings so the server can idle-kick.
 */
import {
  COURT,
  PLAYER,
  REACTIONS,
  SERVICE_LINE_DIST,
  sanitizeName,
  tossApex,
  type ContactEvent,
  type InputMsg,
  type MatchMsg,
  type Role,
  type ShotEvent,
  type Slot,
  type Team,
  type Vec2,
} from "@padel/shared";
import { Input } from "./input.js";
import { InterpBuffer } from "./interp.js";
import { EVENT_STALE_MS, EventQueue } from "./events.js";
import { AudioEngine } from "./audio/engine.js";
import { crowdLevel, crowdReaction, screenPan, shouldPlay } from "./audio/voices.js";
import type { ConnStatus } from "./net.js";
import { Net } from "./net.js";
import { PadelScene } from "./scene.js";
import { Predictor, fixedSteps } from "./predict.js";
import { teamFromEvent } from "./world/boards.js";

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
const mutebtn = document.getElementById("mutebtn")!;

const BASE = import.meta.env.BASE_URL;

const scene = new PadelScene(app);
if (import.meta.env.DEV) (window as unknown as { __padelScene: PadelScene }).__padelScene = scene;
const interp = new InterpBuffer();
/** Snapshot events, held until the rendered ball reaches them. */
const events = new EventQueue();
const seenSlots = new Set<string>();
const audio = new AudioEngine();
if (import.meta.env.DEV) (window as unknown as { __padelAudioStats: AudioEngine["stats"] }).__padelAudioStats = audio.stats;
/** Shots in the current rally: the crowd grows louder as it goes on. */
let rallyShots = 0;

let input: Input | null = null;
let role: Role = "spectator";
let selfSlot: Slot | null = null;
let selfTeam: Team | null = null;
let ownPos: { x: number; z: number } | null = null;
let inputSeq = 0;
const predictor = new Predictor();
let stepAccum = 0;
let carryShot: "drive" | "lob" | null = null;
let carryServe = false;
let selfYaw = 0;
let outdated = false;
let devBots = 0;
/** Dev only (?autoserve=1): serve by itself so `pnpm shoot` can show rallies. */
let devAutoServe = false;

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
    <div>🎾 <strong>Meuss Padel Club</strong></div>
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
/** How long a reaction stays on the LED boards. */
const BOARD_REACTION_MS = 4000;
let boardReaction: { id: string; until: number } | null = null;
let boardReactionTimer: ReturnType<typeof setTimeout> | null = null;

/** Show a reaction on the LED boards for BOARD_REACTION_MS, then clear it. */
function showBoardReaction(id: string): void {
  boardReaction = { id, until: performance.now() + BOARD_REACTION_MS };
  renderBoards();
  if (boardReactionTimer !== null) clearTimeout(boardReactionTimer);
  boardReactionTimer = setTimeout(() => {
    boardReactionTimer = null;
    boardReaction = null; // expired (cleared outright: timers may fire a hair early)
    renderBoards();
  }, BOARD_REACTION_MS);
}

/** Push the current match state and seated names to the LED boards. */
function renderBoards(): void {
  scene.setBoards({
    phase: match?.phase ?? "warmup",
    gamesA: match?.gamesA ?? 0,
    gamesB: match?.gamesB ?? 0,
    pointA: match?.pointA ?? "0",
    pointB: match?.pointB ?? "0",
    names: SEATS.map((s) => names.get(s)?.name ?? ""),
    reaction: boardReaction && performance.now() < boardReaction.until ? boardReaction.id : null,
  });
}

/** Cheer (and let the winners celebrate), or "ooh" at a Fault, once per new match event. */
function maybeCheer(event: string | null): void {
  if (event === lastCheered) return;
  lastCheered = event;
  const reaction = crowdReaction(event);
  if (reaction?.kind === "ooh") audio.ooh();
  if (reaction?.kind !== "cheer") return;
  scene.cheer(reaction.intensity);
  audio.cheer(reaction.intensity);
  const winner = teamFromEvent(event);
  if (winner) scene.celebrate(winner);
}

function setRallyShots(n: number): void {
  rallyShots = n;
  audio.crowd(crowdLevel(n));
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
      servePrompt.textContent = match.tossing ? "Click to serve!" : "🎾 Your serve — Press SPACE to toss";
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
    interp.reset();
    events.clear();
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
    for (const p of msg.players) {
      names.set(p.slot, { name: p.name, team: p.team });
      scene.setPlayerName(p.slot, p.name);
    }
    renderHud();
    renderServing();
    renderBoards();
  },
  onMatch: (msg) => {
    match = msg;
    renderScoreboard();
    renderBoards();
    maybeCheer(msg.event);
    if (msg.phase === "serve" && rallyShots !== 0) setRallyShots(0);
    maybeFlash();
    if (import.meta.env.DEV && devAutoServe) autoServe();
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
  onReaction: (msg) => {
    showReaction(msg.slot, msg.id);
    showBoardReaction(msg.id);
  },
  onSnapshot: (msg) => {
    interp.add(msg);
    if (import.meta.env.DEV) lastSnapshot = { serverTime: msg.serverTime, at: performance.now() };
    events.schedule(msg.serverTime, msg.shots ?? [], msg.contacts ?? []);
    if (selfSlot) {
      const me = msg.players.find((p) => p.slot === selfSlot);
      if (me) predictor.reconcile({ x: me.pos.x, z: me.pos.z }, me.ack, selfSide(), selfLocked());
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

// ── Sound: unlocked by the first gesture, M or the HUD button toggles mute ───

const MUTE_KEY = "mpc-muted";

function renderMute(): void {
  mutebtn.textContent = audio.muted ? "🔇" : "🔊";
  mutebtn.title = audio.muted ? "Sound off (M to unmute)" : "Sound on (M to mute)";
  mutebtn.setAttribute("aria-pressed", String(audio.muted));
}

function toggleMute(): void {
  audio.setMuted(!audio.muted);
  try {
    localStorage.setItem(MUTE_KEY, audio.muted ? "1" : "0");
  } catch {
    // storage blocked (private mode): the choice lasts for this page only
  }
  renderMute();
}

try {
  audio.setMuted(localStorage.getItem(MUTE_KEY) === "1");
} catch {
  // storage blocked: start unmuted
}
renderMute();
// Browsers only allow audio after a user gesture; every gesture also resumes a suspended context.
for (const ev of ["pointerdown", "keydown"] as const) {
  window.addEventListener(ev, () => audio.unlock(), { capture: true });
}
mutebtn.addEventListener("click", () => {
  toggleMute();
  mutebtn.blur(); // keep Space for the serve toss
});
showNickname();

// Dev-only: ?join=<name>&bots=<n> skips the nickname card (used by `pnpm shoot`).
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  // ?quality=high|low pins the renderer quality (the shoot tool measures each level).
  const quality = q.get("quality");
  if (quality === "high" || quality === "low") scene.forceQuality(quality);
  const auto = q.get("join");
  if (auto !== null) {
    devBots = Math.max(0, Math.min(3, Number(q.get("bots") ?? 0) || 0));
    devAutoServe = q.get("autoserve") === "1";
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
  else if (e.code === "KeyM" && !(e.target instanceof HTMLInputElement)) toggleMute();
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

/** Stereo pan for a world position, from where it is on screen. */
function panAt(pos: { x: number; y: number; z: number }): number {
  return screenPan(scene.projectToScreen(pos.x, pos.y, pos.z).x, scene.domElement.clientWidth);
}

/**
 * One snapshot's shots and contacts, now that the rendered ball has reached them:
 * avatar swings, hit feedback, then sound. Our own swing already played on the click,
 * unless the server made it a Smash. The queue already dropped events older than
 * EVENT_STALE_MS; sound is stricter, since a late sound is heard as lag.
 */
function playEvents(
  serverTime: number,
  shots: readonly ShotEvent[],
  contacts: readonly ContactEvent[],
  lateMs: number,
): void {
  for (const shot of shots) {
    if (shot.slot === selfSlot && shot.kind !== "smash") continue;
    scene.triggerSwing(shot.slot, shot.kind);
  }
  scene.onEvents(shots, contacts);
  if (shots.length > 0) setRallyShots(rallyShots + shots.length);
  if (!shouldPlay(serverTime, serverTime + lateMs)) {
    audio.skipLate(shots.length + contacts.length);
    return;
  }
  for (const shot of shots) audio.shot(shot.kind, shot.timing, panAt(shot.pos));
  for (const c of contacts) audio.contact(c.surface, c.speed, panAt(c.pos));
}

// ── Render / input loop ──────────────────────────────────────────────────────

renderHud();

scene.start((dt) => {
  // Input and fixed-step sends run first so this frame's applyInput is already
  // reflected in the predicted position sampled below. Aim uses last frame's ownPos.
  if (input) {
    const i = input.poll();
    // A click between ticks must still reach the next tick.
    carryShot = i.shot ?? carryShot;
    carryServe ||= i.serve;
    const aim =
      import.meta.env.DEV && devAutoServe && selfLocked() && ownPos !== null
        ? serveAimAtBoxCentre(ownPos)
        : ownPos !== null
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
        shot: carryShot,
        view: interp.renderTime,
        serve: carryServe,
      };
      carryShot = null;
      carryServe = false;
      net.send(msg);
      predictor.applyInput({ seq: msg.seq, move: msg.move }, selfSide(), selfLocked());
    }
    if (i.shot && selfSlot) scene.triggerSwing(selfSlot);
  }

  interp.update(dt * 1000);
  events.drain(interp.renderTime, playEvents, EVENT_STALE_MS);
  const s = interp.sample();
  const framePos = new Map<string, { x: number; z: number }>();
  if (s) {
    scene.setBall(s.ball.x, s.ball.y, s.ball.z);
    scene.setBallTarget(s.ball.x, s.ball.z);
    scene.setBallSide(s.ball.z);
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

// ── Dev auto-serve (?autoserve=1) ────────────────────────────────────────────
// Every call site is behind `import.meta.env.DEV`, so production builds drop all of this.
// Timer-driven rather than per frame: headless SwiftShader renders at ~2 fps, slower than
// the toss lasts, and its render clock drifts well behind the server's.

const AUTOSERVE_DELAY_MS = 600;
let autoServeState: "idle" | "tossing" | "striking" = "idle";
let autoServeTimer: number | undefined;
/** The newest snapshot's server time and when it arrived, to estimate the server clock. */
let lastSnapshot: { serverTime: number; at: number } | null = null;

/** Estimated server clock (ms) right now. */
function serverClockNow(): number {
  return lastSnapshot ? lastSnapshot.serverTime + (performance.now() - lastSnapshot.at) : interp.renderTime;
}

/**
 * On each match update: as the server awaiting the serve, toss AUTOSERVE_DELAY_MS later,
 * then strike a Drive at the toss apex. The toss started when we first see `tossing`, so
 * its apex is tossApex() later; the server judges the strike at our `view`, so a view of
 * that apex time is a perfect serve whenever the strike arrives within LAG.maxRewindMs.
 */
function autoServe(): void {
  if (!selfLocked() || !match?.awaitingServe) {
    window.clearTimeout(autoServeTimer);
    autoServeState = "idle";
    return;
  }
  if (!match.tossing && autoServeState === "idle") {
    autoServeState = "tossing";
    autoServeTimer = window.setTimeout(() => sendDevInput({ serve: true }), AUTOSERVE_DELAY_MS);
  } else if (match.tossing && autoServeState !== "striking") {
    autoServeState = "striking";
    window.clearTimeout(autoServeTimer);
    const apexMs = tossApex() * 1000;
    const apex = serverClockNow() + apexMs;
    autoServeTimer = window.setTimeout(() => sendDevInput({ shot: "drive", view: apex }), apexMs);
  }
}

/** Send one extra input outside the frame loop (we are locked at the serve spot, so no movement). */
function sendDevInput(extra: Partial<InputMsg>): void {
  if (ownPos === null) return;
  const msg: InputMsg = {
    t: "input",
    seq: inputSeq++,
    ts: performance.now(),
    move: { x: 0, z: 0 },
    aim: serveAimAtBoxCentre(ownPos),
    shot: null,
    view: interp.renderTime,
    serve: false,
    ...extra,
  };
  net.send(msg);
  predictor.applyInput({ seq: msg.seq, move: msg.move }, selfSide(), selfLocked());
  if (msg.shot && selfSlot) scene.triggerSwing(selfSlot);
}

/** Unit aim from the serve spot to the centre of the diagonal service box. */
function serveAimAtBoxCentre(from: { x: number; z: number }): Vec2 {
  const side = selfSide();
  const target = { x: (-Math.sign(from.x) * COURT.width) / 4, z: (-side * SERVICE_LINE_DIST) / 2 };
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const len = Math.hypot(dx, dz);
  return { x: dx / len, z: dz / len };
}

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
