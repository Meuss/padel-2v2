/**
 * Client bootstrap: nickname entry, scene + input, and keeping the HUD,
 * score bug, name labels and reset-vote UI in sync with the authoritative
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
  type MatchPhase,
  type Role,
  type ShotEvent,
  type Slot,
  type Team,
  type Vec2,
  type VoteMsg,
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
import { ScoreBug, bugModel } from "./hud/scorebug.js";
import { Banner, BannerQueue, bannerForMatch, type BannerItem } from "./hud/banner.js";
import { bannerFor, goldenPointBanner } from "./hud/copy.js";
import { FinalCard, finalModel, type FinalModel } from "./hud/finalcard.js";
import {
  clipTime,
  isNotable,
  isPlaying,
  nextState,
  pointOutcome,
  type DirectorEvent,
  type DirectorState,
} from "./replay/director.js";
import { ReplayRecorder } from "./replay/recorder.js";
import { ReplayPlayer } from "./replay/player.js";
import "./hud/hud.css";

const app = document.getElementById("app")!;
const conn = document.getElementById("conn")!;
const connLabel = document.getElementById("conn-label")!;
const watching = document.getElementById("watching")!;
const watchingN = document.getElementById("watching-n")!;
const takeSeat = document.getElementById("takeseat") as HTMLButtonElement;
const hint = document.getElementById("hint")!;
const scoreBug = new ScoreBug(document.getElementById("scorebug")!);
scoreBug.render(bugModel(null, null));
const bannerQueue = new BannerQueue();
const banner = new Banner(document.getElementById("banner")!, bannerQueue);
const servePrompt = document.getElementById("serveprompt")!;
const labels = document.getElementById("labels")!;
const resetbtn = document.getElementById("resetbtn")!;
const votepanel = document.getElementById("votepanel")!;
const nickname = document.getElementById("nickname")!;
const nickInput = document.getElementById("nick-input") as HTMLInputElement;
const nickGo = document.getElementById("nick-go")!;
const nickMsg = document.getElementById("nick-msg")!;
const loading = document.getElementById("loading")!;
const loadingTitle = document.getElementById("loading-title")!;
const loadingHint = document.getElementById("loading-hint")!;
const reactbar = document.getElementById("reactbar")!;
const reactionsEl = document.getElementById("reactions")!;
const mutebtn = document.getElementById("mutebtn")!;
const replayTag = document.getElementById("replaytag")!;
const finalCard = new FinalCard(document.getElementById("finalcard")!, { accept: acceptVote, decline: declineVote });

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
/** Our rendered position (last frame), or null before the first: points at the reused `ownPoint`. */
let ownPos: { x: number; z: number } | null = null;
const ownPoint = { x: 0, z: 0 };
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
/** Dev only (?banner=<kind>): a Banner held on screen (rallies included) for screenshots. */
let devBanner: BannerItem | null = null;
/** Dev only (?forceReplay=1): every point is notable, so `pnpm shoot` can catch a replay. */
let devForceReplay = false;
/** Dev only (?finalCard=1): the Final card with synthetic stats and an open Rematch vote. */
let devFinal = false;
/** Dev only (?vote=reset|rematch): a synthetic open vote, for the vote panel. */
let devVote: VoteMsg["kind"] | null = null;

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
let lastHighlightKey: string | null = null;
const names = new Map<Slot, { name: string; team: Team }>();
const tags = new Map<Slot, HTMLDivElement>();

/** Connection indicator, top-left: shown only while the socket is not open. */
function renderConn(status: ConnStatus): void {
  const label =
    status === "connecting" ? "Connecting…" : status === "reconnecting" ? "Reconnecting…" : status === "closed" ? "Offline" : null;
  if (label) connLabel.textContent = label;
  conn.classList.toggle("show", label !== null);
}

/** "N watching" pill, top-right: the spectator count, hidden when there are none. */
function renderWatching(spectators: number): void {
  watchingN.textContent = String(spectators);
  watching.classList.toggle("show", spectators > 0);
}

/** Spectators see "Take seat" while a seat is free; once asked it waits for the next point. */
let seatRequested = false;
let lastSeatOpen = false;
/** Set by the first Welcome: before it the nickname screen is up and nothing may be requested. */
let joined = false;
function renderTakeSeat(seatOpen: boolean): void {
  lastSeatOpen = seatOpen;
  if (!seatOpen) seatRequested = false; // someone else got it: the request is void
  const show = joined && role === "spectator" && seatOpen;
  takeSeat.classList.toggle("show", show);
  takeSeat.disabled = seatRequested;
  takeSeat.textContent = seatRequested ? "Joining next point…" : "Take seat";
}
takeSeat.addEventListener("click", () => {
  seatRequested = true;
  takeSeat.disabled = true;
  takeSeat.textContent = "Joining next point…";
  net.send({ t: "takeseat" });
});

/** How long the controls hint stays up when nobody serves. */
const HINT_MS = 12_000;
let hintTimer: number | undefined;
let hintDone = false;
/** The match phase last seen while the hint is up: a serve → rally step is the first serve. */
let hintPhase: MatchPhase | null = null;

/**
 * Show the controls hint to a new player; it fades for good after HINT_MS, or sooner once
 * they watch a serve go in. Joining mid-rally does not count, so a reconnect still gets a showing.
 */
function showHint(): void {
  if (hintDone) return;
  hintPhase = null;
  hint.classList.add("show");
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(fadeHint, HINT_MS);
}

/** On each match update: fade the hint on a serve → rally transition seen since it appeared. */
function trackHintPhase(phase: MatchPhase): void {
  if (hintDone || !hint.classList.contains("show")) return;
  if (hintPhase === "serve" && phase === "rally") fadeHint();
  hintPhase = phase;
}

function fadeHint(): void {
  hintDone = true;
  window.clearTimeout(hintTimer);
  hint.classList.add("faded");
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

/**
 * Once per new match event: it ends the rally (the crowd settles), then the crowd cheers (and
 * the winners celebrate) or goes "ooh" at a Fault.
 */
function onMatchEvent(m: MatchMsg): void {
  const key = m.eventKind ? `${m.eventKind}|${m.eventTeam ?? ""}|${m.event ?? ""}` : null;
  if (key === lastCheered) return;
  lastCheered = key;
  if (!m.eventKind) return;
  setRallyShots(0);
  const reaction = crowdReaction(m.eventKind);
  if (reaction?.kind === "ooh") audio.ooh();
  if (reaction?.kind !== "cheer") return;
  scene.cheer(reaction.intensity);
  audio.cheer(reaction.intensity);
  if (m.eventTeam) scene.celebrate(m.eventTeam);
}

function setRallyShots(n: number): void {
  rallyShots = n;
  audio.crowd(crowdLevel(n));
}

/** Lower-third serve prompt: instructions for the server, "<NAME> TO SERVE" for everyone else. */
function renderServePrompt(): void {
  const m = match;
  if (!m || m.phase !== "serve" || !m.awaitingServe || !m.serverSlot) {
    servePrompt.classList.remove("show");
    return;
  }
  if (m.serverSlot === selfSlot) {
    servePrompt.replaceChildren(m.tossing ? "Click to serve" : "Press Space to toss");
  } else {
    // The nickname is user input: textContent only.
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = names.get(m.serverSlot)?.name ?? m.serverSlot;
    servePrompt.replaceChildren(who, "to serve");
  }
  servePrompt.classList.add("show");
}

/**
 * On each match update: a new event may bring a Banner (it replaces the one on screen). The rally
 * screen stays clean, so a rally (or warm-up) clears it; the Set Banner holds until replaced.
 */
function updateBanner(m: MatchMsg, prev: MatchMsg | null): void {
  if (m.phase === "rally" || m.phase === "warmup") bannerQueue.clear();
  const now = performance.now();
  const item = bannerForMatch(m, prev);
  if (item) bannerQueue.show(item, now);
  // Dev only (?banner=<kind>): hold a Banner on screen, rallies included, for screenshots.
  if (import.meta.env.DEV && devBanner && !bannerQueue.current(now)) bannerQueue.show(devBanner, now);
}

/** Once per frame: draw the Banner, and step the bug and serve prompt aside while it is up. */
function tickBanner(): void {
  banner.update(performance.now());
  document.body.classList.toggle("banner-up", banner.showing);
}

/** Name tags show between points only: they fade out when a rally starts. */
function renderTags(phase: MatchPhase | null): void {
  labels.classList.toggle("rally", phase === "rally");
}

/** The open vote (reset or rematch), from the server. */
let vote: VoteMsg | null = null;
/** We accepted the open vote (or started it): the Accept button settles. */
let acceptedVote = false;
/** What the vote panel shows now, or null while hidden. */
let votePanelKey: string | null = null;

function onVote(msg: VoteMsg): void {
  // A closed vote, or a new kind (the Rematch replaces a reset vote): our answer is spent.
  if (!msg.active || msg.kind !== vote?.kind) acceptedVote = false;
  vote = msg;
  renderVote();
}

/** Accept the open vote, or with none open, start one (a reset; after the match, a rematch). */
function acceptVote(): void {
  net.send({ t: "votereset" });
  acceptedVote = true;
  renderVote();
}

function declineVote(): void {
  net.send({ t: "votedecline" });
}

/** The vote as shown: the server's, or a dev sample (?vote=, ?finalCard=1). */
function shownVote(): VoteMsg | null {
  if (import.meta.env.DEV && (devVote || devFinal) && !vote?.active) {
    const kind = devVote ?? "rematch";
    const initiator = kind === "rematch" ? "MEUSS PADEL CLUB" : nickInput.value || "Player";
    return { t: "vote", active: true, kind, initiator, accepted: 1, needed: 2 };
  }
  return vote;
}

/**
 * The vote in its two places: the Final card's footer once the match is over, else the
 * lower-third panel (Players only, between points: the rally screen stays clean).
 */
function renderVote(): void {
  const v = shownVote();
  const active = v?.active ?? false;
  finalCard.setVote({
    active,
    accepted: v?.accepted ?? 0,
    needed: v?.needed ?? 0,
    canVote: role === "player",
    acceptedByMe: acceptedVote,
  });
  const finalPhase = finalCard.showing || finalDueAt !== null || match?.phase === "over";
  if (!v || !active || role !== "player" || finalPhase || match?.phase === "rally") {
    votepanel.classList.remove("show");
    votePanelKey = null;
    return;
  }
  // Rebuilt only when it changes, so a focused button keeps its focus across match updates.
  const key = `${v.kind}|${v.initiator}|${v.accepted}/${v.needed}|${acceptedVote}`;
  if (key === votePanelKey) return;
  votePanelKey = key;
  const rule = document.createElement("div");
  rule.className = "vt-rule";
  const title = document.createElement("div");
  title.className = "vt-title";
  title.textContent = v.kind === "rematch" ? "REMATCH?" : "RESET THE SET?";
  // The initiator's nickname is user input: textContent only.
  const who = document.createElement("span");
  who.className = "vt-who";
  who.textContent = v.initiator;
  const n = document.createElement("b");
  n.textContent = `${v.accepted}/${v.needed}`;
  const count = document.createElement("span");
  count.className = "vt-count";
  count.append(n, " accepted");
  const sub = document.createElement("div");
  sub.className = "vt-sub";
  sub.append(who, count);
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "primary-btn";
  accept.textContent = acceptedVote ? "Accepted" : "Accept";
  accept.disabled = acceptedVote;
  accept.addEventListener("click", acceptVote);
  const decline = document.createElement("button");
  decline.type = "button";
  decline.className = "ghost-btn";
  decline.textContent = "Decline";
  decline.addEventListener("click", declineVote);
  for (const b of [accept, decline]) {
    // After a mouse click, give Space back to the serve toss; keyboard users keep focus.
    b.addEventListener("click", (e) => {
      if (e.detail > 0) b.blur();
    });
  }
  const actions = document.createElement("div");
  actions.className = "vt-actions";
  actions.append(accept, decline);
  votepanel.replaceChildren(rule, title, sub, actions);
  votepanel.classList.add("show");
}

// ── Final card ───────────────────────────────────────────────────────────────

/** The Final card comes this long after the Set Banner (or when the match-point replay ends). */
const FINAL_DELAY_MS = 1200;
/** When the Final card is due (local clock), or null when none is waiting. */
let finalDueAt: number | null = null;

/** The Final card for the current match state (a dev sample with ?finalCard=1), or null. */
function currentFinal(): FinalModel | null {
  if (import.meta.env.DEV && devFinal) return finalModel(devFinalMatch(), names);
  return match ? finalModel(match, names) : null;
}

/**
 * After each match update: a finished match makes the Final card due FINAL_DELAY_MS later; a new
 * match (the Rematch, a reset) takes it off, and the PARTIDO Banner opens it.
 */
function updateFinal(): void {
  const model = currentFinal();
  if (model) {
    if (finalCard.showing) finalCard.show(model);
    else if (finalDueAt === null) finalDueAt = performance.now() + FINAL_DELAY_MS;
    return;
  }
  finalDueAt = null;
  if (finalCard.showing) {
    finalCard.hide();
    finalCardShowing = false;
    document.body.classList.remove("final-up");
  }
}

/** Once per frame: show the due Final card once the director is back to live; it replaces the Set Banner. */
function tickFinal(now: number): void {
  if (finalDueAt === null || now < finalDueAt || director.mode !== "live") return;
  finalDueAt = null;
  const model = currentFinal();
  if (!model) return;
  finalCard.show(model);
  finalCardShowing = true;
  bannerQueue.clear();
  document.body.classList.add("final-up");
  renderVote();
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

// ── Instant replay ───────────────────────────────────────────────────────────

/** The last seconds of play, recorded as snapshots arrive. */
const recorder = new ReplayRecorder();
const replayPlayer = new ReplayPlayer(recorder);
let director: DirectorState = { mode: "live" };
/** Whether the replay view (Broadcast cam, recorded play, REPLAY tag) is on screen. */
let replayShown = false;
/** True while the Final card is up: no replay starts over it. */
let finalCardShowing = false;
const TICK: DirectorEvent = { t: "tick" };
const SKIP: DirectorEvent = { t: "skip" };

/**
 * On each match update: a point that just ended may queue a replay of its clip (notable
 * points only), and a toss or a rally start cuts a replay back to live.
 */
function updateDirector(m: MatchMsg, prev: MatchMsg | null): void {
  const now = performance.now();
  const outcome = pointOutcome(m, prev);
  const end = recorder.newestMs;
  if (outcome && end !== null) {
    const notable = (import.meta.env.DEV && devForceReplay) || isNotable({ ...recorder.pointSummary(outcome.winner), ...outcome });
    const pointStartMs = recorder.pointStartMs;
    director = nextState(director, { t: "pointEnd", notable, pointStartMs, pointEndMs: end, finalCard: finalCardShowing }, now);
  }
  director = nextState(director, { t: "phase", phase: m.phase, tossing: m.tossing }, now);
  syncReplay(now);
}

/** Show or leave the replay view to match the director (call after every director change). */
function syncReplay(now: number): void {
  const on = isPlaying(director, now);
  if (on === replayShown) return;
  replayShown = on;
  if (on && director.mode === "replay") replayPlayer.start(director.fromMs);
  scene.setReplay(on);
  document.body.classList.toggle("replaying", on);
}

/** A Player skipped (us, or anyone through the server): back to live at once. */
function skipReplay(): void {
  const now = performance.now();
  director = nextState(director, SKIP, now);
  syncReplay(now);
}

/**
 * A recorded frame's events, as the replay reaches them: swings, hit feedback and sound, as
 * live (our own swing included), but the rally count and the crowd stay as they are.
 */
function playReplayEvents(_serverTime: number, shots: readonly ShotEvent[], contacts: readonly ContactEvent[]): void {
  for (const shot of shots) scene.triggerSwing(shot.slot, shot.kind);
  scene.onEvents(shots, contacts);
  for (const shot of shots) audio.shot(shot.kind, shot.timing, panAt(shot.pos));
  for (const c of contacts) audio.contact(c.surface, c.speed, panAt(c.pos));
}

/** Live events that come due during a replay are dropped: the screen shows recorded play. */
function dropEvents(): void {}

const net = new Net({
  onStatus: (s) => {
    renderConn(s);
    if (s === "closed") hideLoading();
    else showLoading(s);
  },
  onWelcome: (msg) => {
    predictor.reset();
    interp.reset();
    events.clear();
    recorder.reset();
    // Forget the old match state too: the first update after a (re)connect never counts as a
    // point end, so a near-empty recording is never replayed.
    match = null;
    director = { mode: "live" };
    syncReplay(performance.now());
    scene.resetFeedback();
    stepAccum = 0;
    hideLoading();
    role = msg.role;
    seatRequested = false;
    joined = true;
    renderTakeSeat(lastSeatOpen);
    // The skip key is for seated Players only.
    replayTag.classList.toggle("skippable", role === "player");
    scene.buildCourt(msg.court);
    if (msg.role === "player" && msg.slot && msg.team) {
      selfSlot = msg.slot;
      selfTeam = msg.team;
      scene.setPlayerCamera(msg.team);
      scene.setSelfMarker(msg.slot);
      input?.dispose();
      input = new Input(scene.domElement);
      showHint();
      resetbtn.classList.add("show");
    } else {
      input?.dispose();
      input = null;
      selfSlot = null;
      scene.setSpectatorCamera();
      scene.setSelfMarker(null);
      window.clearTimeout(hintTimer); // a seat lost mid-showing does not use up the hint
      hint.classList.remove("show");
      resetbtn.classList.remove("show");
    }
    renderVote();
    if (msg.role === "player" && devBots > 0) {
      for (let i = 0; i < devBots; i++) net.send({ t: "addbot" });
      devBots = 0;
    }
  },
  onRoster: (msg) => {
    renderWatching(msg.spectatorCount);
    renderTakeSeat(msg.seatOpen);
    names.clear();
    for (const p of msg.players) {
      names.set(p.slot, { name: p.name, team: p.team });
      scene.setPlayerName(p.slot, p.name);
    }
    renderServePrompt();
    renderBoards();
    if (finalCard.showing) updateFinal();
  },
  onMatch: (msg) => {
    scoreBug.render(bugModel(msg, match));
    updateBanner(msg, match);
    updateDirector(msg, match);
    match = msg;
    updateFinal();
    renderVote();
    renderTags(msg.phase);
    trackHintPhase(msg.phase);
    renderServePrompt();
    renderBoards();
    onMatchEvent(msg);
    if (import.meta.env.DEV && devAutoServe) autoServe();
    const hk = msg.highlight ? JSON.stringify(msg.highlight) : null;
    if (hk && hk !== lastHighlightKey) scene.showFault(msg.highlight!);
    lastHighlightKey = hk;
  },
  onVote,
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
  onReplaySkip: skipReplay,
  onReaction: (msg) => {
    showReaction(msg.slot, msg.id);
    showBoardReaction(msg.id);
  },
  onSnapshot: (msg) => {
    interp.add(msg);
    recorder.add(msg);
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
  resetbtn.classList.remove("show");
  vote = null;
  renderVote();
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
resetbtn.addEventListener("click", (e) => {
  acceptVote();
  // After a mouse click, give Space back to the serve toss; keyboard users keep focus.
  if (e.detail > 0) resetbtn.blur();
});

// ── Sound: unlocked by the first gesture, M or the HUD button toggles mute ───

const MUTE_KEY = "mpc-muted";

function renderMute(): void {
  // The toggle is labelled "Sound": pressed means sound is on (the icon follows, in CSS).
  mutebtn.setAttribute("aria-pressed", String(!audio.muted));
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
mutebtn.addEventListener("click", (e) => {
  toggleMute();
  // After a mouse click, give Space back to the serve toss; keyboard users keep focus.
  if (e.detail > 0) mutebtn.blur();
});
showNickname();

// Dev-only: ?join=<name>&bots=<n> skips the nickname card (used by `pnpm shoot`).
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  // ?quality=high|low pins the renderer quality (the shoot tool measures each level).
  const quality = q.get("quality");
  if (quality === "high" || quality === "low") scene.forceQuality(quality);
  devForceReplay = q.get("forceReplay") === "1";
  devFinal = q.get("finalCard") === "1";
  const voteKind = q.get("vote");
  if (voteKind === "reset" || voteKind === "rematch") devVote = voteKind;
  const forced = q.get("banner");
  if (forced !== null) devBanner = devBannerItem(forced);
  const auto = q.get("join");
  if (auto !== null) {
    devBots = Math.max(0, Math.min(3, Number(q.get("bots") ?? 0) || 0));
    devAutoServe = q.get("autoserve") === "1";
    nickInput.value = auto;
    play();
  }
  if (q.get("tray") === "1") setTray(true);
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

// Emote tray: the reactions in a strip, toggled with E (players only).
function setTray(open: boolean): void {
  reactbar.classList.toggle("open", open);
  document.body.classList.toggle("tray-open", open);
}

for (const id of REACTIONS) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "rb-item";
  item.title = id;
  item.setAttribute("aria-label", id);
  const img = document.createElement("img");
  img.src = `${BASE}reactions/${id}.png`;
  img.alt = "";
  item.append(img);
  item.addEventListener("click", (e) => {
    net.send({ t: "react", id });
    setTray(false);
    if (e.detail > 0) item.blur();
  });
  reactbar.append(item);
}

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "KeyB" && role === "player") net.send({ t: "addbot" });
  else if (e.code === "KeyN" && role === "player") net.send({ t: "clearbots" });
  else if (e.code === "KeyM" && !(e.ctrlKey || e.metaKey || e.altKey) && !(e.target instanceof HTMLInputElement)) {
    toggleMute();
  }
  else if (e.code === "KeyE" && role === "player" && nickname.style.display === "none") {
    setTray(!reactbar.classList.contains("open"));
  }
  // Enter skips the replay for everyone (Space stays the serve toss). A focused button keeps its Enter.
  else if (
    (e.code === "Enter" || e.code === "NumpadEnter") &&
    role === "player" &&
    replayShown &&
    !(e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement)
  ) {
    net.send({ t: "skipreplay" });
    skipReplay();
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

// Reused every frame, so the loop allocates no positions: each frame's avatar positions (for
// the reactions), the slots in this snapshot, and one point per slot.
const framePos = new Map<string, { x: number; z: number }>();
const present = new Set<string>();
const slotPoints = new Map<Slot, { x: number; z: number }>();

/** The reused point for `slot`, set to (x, z). */
function slotPoint(slot: Slot, x: number, z: number): { x: number; z: number } {
  let pt = slotPoints.get(slot);
  if (!pt) slotPoints.set(slot, (pt = { x: 0, z: 0 }));
  pt.x = x;
  pt.z = z;
  return pt;
}

/** Set our rendered position (the reused `ownPoint`). */
function setOwnPos(x: number, z: number): { x: number; z: number } {
  ownPoint.x = x;
  ownPoint.z = z;
  return ownPoint;
}

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
    // During a replay our avatar shows recorded play: no live swing on it.
    if (i.shot && selfSlot && !replayShown) scene.triggerSwing(selfSlot);
  }

  interp.update(dt * 1000);
  const now = performance.now();
  director = nextState(director, TICK, now);
  syncReplay(now);
  events.drain(interp.renderTime, replayShown ? dropEvents : playEvents, EVENT_STALE_MS);
  const s = interp.sample();
  framePos.clear();
  if (replayShown && director.mode === "replay") {
    // Recorded play through the Broadcast cam; our predicted position keeps tracking live input.
    const predicted = predictor.renderPosition(dt);
    if (predicted) ownPos = setOwnPos(predicted.x, predicted.z);
    if (replayPlayer.advance(clipTime(director, now), playReplayEvents)) {
      const pose = replayPlayer.pose;
      scene.setBall(pose.ball.x, pose.ball.y, pose.ball.z);
      scene.setBallTarget(pose.ball.x, pose.ball.z);
      scene.setBallSide(pose.ball.z);
      for (let k = 0; k < pose.count; k++) {
        const p = pose.players[k]!;
        scene.setPlayer(p.slot, p.pos.x, p.pos.y, p.pos.z, p.yaw);
        framePos.set(p.slot, p.pos);
      }
    }
  } else if (s) {
    scene.setBall(s.ball.x, s.ball.y, s.ball.z);
    scene.setBallTarget(s.ball.x, s.ball.z);
    scene.setBallSide(s.ball.z);
    present.clear();
    const predicted = predictor.renderPosition(dt);
    for (const p of s.players) {
      present.add(p.slot);
      seenSlots.add(p.slot);
      const mine = p.slot === selfSlot && predicted !== null;
      const x = mine ? predicted.x : p.pos.x;
      const z = mine ? predicted.z : p.pos.z;
      framePos.set(p.slot, slotPoint(p.slot, x, z));
      scene.setPlayer(p.slot, x, p.pos.y, z, mine ? selfYaw : p.yaw);
      updateLabel(p.slot, x, z);
      if (p.slot === selfSlot) {
        ownPos = setOwnPos(x, z);
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
  tickFinal(now);
  tickBanner();
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
  if (msg.shot && selfSlot && !replayShown) scene.triggerSwing(selfSlot);
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

// ── Dev Banner (?banner=<kind>) ──────────────────────────────────────────────

/** A sample Banner for a kind ("golden", "game", "set", "fault", "let", "start", "reset") or its title. */
function devBannerItem(raw: string): BannerItem | null {
  const k = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (k === "golden" || k === "puntodeoro") return { copy: goldenPointBanner(5, 4), durationMs: Infinity };
  const kinds = { game: "juego", set: "setypartido", fault: "falta", let: "let", start: "partido", reset: "reinicio" } as const;
  for (const [kind, title] of Object.entries(kinds) as [keyof typeof kinds, string][]) {
    if (k !== kind && k !== title) continue;
    const copy = bannerFor(kind, kind === "game" || kind === "set" ? "A" : null, 5, 4, kind === "fault" ? "Into the net" : null);
    return copy ? { copy, durationMs: Infinity } : null;
  }
  return null;
}

// ── Dev Final card (?finalCard=1) ────────────────────────────────────────────

/** A finished match with sample stats, won by our team (so a long nickname shows on the card). */
function devFinalMatch(): MatchMsg {
  const winner: Team = selfTeam ?? "A";
  return {
    t: "match",
    phase: "over",
    pointA: "0",
    pointB: "0",
    gamesA: winner === "A" ? 6 : 4,
    gamesB: winner === "A" ? 4 : 6,
    tiebreak: false,
    sideA: -1,
    serverSlot: null,
    serveBox: null,
    awaitingServe: false,
    tossing: false,
    event: "SET Y PARTIDO",
    eventKind: "set",
    eventTeam: winner,
    reason: null,
    highlight: null,
    winner,
    stats: {
      A: { shots: 132, perfect: 51, smashes: 9, points: 31 },
      B: { shots: 118, perfect: 34, smashes: 5, points: 24 },
      longestRally: 17,
      durationS: 642,
    },
  };
}
