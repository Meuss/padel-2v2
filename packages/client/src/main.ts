/**
 * Client bootstrap: nickname entry, scene + input, and keeping the HUD,
 * score bug, name labels and reset-vote UI in sync with the authoritative
 * match state. Sends throttled activity pings so the server can idle-kick.
 */
import {
  COURT,
  NAME_MAX_LENGTH,
  sanitizeName,
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
import { Net, resolveServerUrl } from "./net.js";
import { PadelScene } from "./scene.js";
import { Predictor, fixedSteps } from "./predict.js";
import { ScoreBug, bugModel } from "./hud/scorebug.js";
import { Banner, BannerQueue, bannerForMatch, type BannerItem } from "./hud/banner.js";
import { servePrompt } from "./hud/copy.js";
import { AutoServe, devBannerItem, devFaultHighlight, devFinalMatch, startDevFault, type DevFault } from "./dev.js";
import { FinalCard, finalModel, type FinalModel } from "./hud/finalcard.js";
import { VotePanel, votePanelView } from "./hud/votepanel.js";
import { blurAfterClick } from "./hud/button.js";
import { EmoteTray, NameTags, Reactions, type Project } from "./hud/overlays.js";
import { capName, countsLine, fetchRoomCounts, fillJoinLegend, nameCount, roomLine, type RoomCounts } from "./hud/join.js";
import { CONTROLS_SEEN_KEY, ControlsCard, ControlsLegend, escapeCloses, persistSeenOnClose, shouldShowCard } from "./hud/controls.js";
import { FINAL_DELAY_MS, ReplayController, finalDue } from "./replay/controller.js";
import "./hud/hud.css";

// Asked before anything is built: the request goes out (and wakes a sleeping server) while the
// scene builds, and its 4 s timeout is not spent waiting behind that work.
const roomCountsAtLoad = fetchRoomCounts(resolveServerUrl());

const app = document.getElementById("app")!;
const conn = document.getElementById("conn")!;
const connLabel = document.getElementById("conn-label")!;
const watching = document.getElementById("watching")!;
const watchingN = document.getElementById("watching-n")!;
const takeSeat = document.getElementById("takeseat") as HTMLButtonElement;
const scoreBug = new ScoreBug(document.getElementById("scorebug")!);
scoreBug.render(bugModel(null, null));
const bannerQueue = new BannerQueue();
const banner = new Banner(document.getElementById("banner")!, bannerQueue);
const servePromptEl = document.getElementById("serveprompt")!;
const resetbtn = document.getElementById("resetbtn")!;
const joinScreen = document.getElementById("join")!;
const joinForm = document.getElementById("join-form") as HTMLFormElement;
const nickInput = document.getElementById("nick-input") as HTMLInputElement;
const nickGo = document.getElementById("nick-go")!;
const nickMsg = document.getElementById("nick-msg")!;
const nickCount = document.getElementById("nick-count")!;
const joinRoom = document.getElementById("join-room")!;
const loadingTitle = document.getElementById("loading-title")!;
const loadingHint = document.getElementById("loading-hint")!;
const mutebtn = document.getElementById("mutebtn")!;
const replayTag = document.getElementById("replaytag")!;
const finalCard = new FinalCard(document.getElementById("finalcard")!, { accept: acceptVote, decline: declineVote });
const votePanel = new VotePanel(document.getElementById("votepanel")!, { accept: acceptVote, decline: declineVote });

const BASE = import.meta.env.BASE_URL;

const scene = new PadelScene(app);
const project: Project = (x, y, z) => scene.projectToScreen(x, y, z);
const nameTags = new NameTags(document.getElementById("labels")!, project, (slot) => names.get(slot));
const reactions = new Reactions(document.getElementById("reactions")!, BASE, project);
const tray = new EmoteTray(document.getElementById("reactbar")!, BASE, (id) => net.send({ t: "react", id }));
// The court is shared constants (the Welcome sends the same): build it now, so the join screen
// shows the floodlit arena rather than empty stands.
scene.buildCourt({ ...COURT });
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
/** Dev only (?fault=<kind>[&faultAt=<ms>]): a synthetic fault, looped, or held `faultAt` ms in. */
let devFault: DevFault | null = null;

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

// ── Controls: the card (first time, and on "?") and the compact legend ──────

let controlsSeen = false;
try {
  controlsSeen = localStorage.getItem(CONTROLS_SEEN_KEY) === "1";
} catch {
  // storage blocked (private mode): the card shows on each visit
}
/** Dev only (?controls=1): the card opens on every Welcome, seen or not, and holds through serves (screenshots). */
let devControls = false;
const controlsCard = new ControlsCard(document.getElementById("controls")!, closeControls);
const ctlLegend = document.getElementById("ctl-legend")!;
const controlsLegend = new ControlsLegend(ctlLegend, toggleControls);
/** The match phase last seen while the card is up: a serve → rally step is a serve going in. */
let controlsPhase: MatchPhase | null = null;
/** The first-time card waits while the Final card is up (or due), and opens when it closes. */
let controlsPending = false;

function openControls(): void {
  controlsPhase = null;
  controlsCard.show(role);
  controlsLegend.setExpanded(true);
}

/** Close the card (button, Esc, "?", or the first serve); it no longer opens by itself. */
function closeControls(): void {
  if (!controlsCard.showing) return;
  controlsCard.hide();
  controlsLegend.setExpanded(false);
  const shown = controlsCard.shownRole;
  if (controlsSeen || !shown || !persistSeenOnClose(shown)) return;
  controlsSeen = true;
  try {
    localStorage.setItem(CONTROLS_SEEN_KEY, "1");
  } catch {
    // storage blocked: it is seen for this page only
  }
}

function toggleControls(): void {
  if (controlsCard.showing) closeControls();
  else openControls();
}

/** On each Welcome: the legend for our role, and the card the first time we take a seat. */
function renderControls(): void {
  controlsLegend.render(role);
  ctlLegend.classList.add("show");
  ctlLegend.classList.toggle("spectator", role === "spectator");
  controlsPending = false;
  if (shouldShowCard(controlsSeen, role) || (import.meta.env.DEV && devControls)) {
    if (finalCard.showing || finalDueAt !== null) controlsPending = true;
    else openControls();
  } else if (controlsCard.showing) controlsCard.show(role); // redrawn for a new role
}

/** The Final card is opening: a first-time card already up (we joined just as the match ended) steps back until it closes. */
function deferControls(): void {
  if (!controlsCard.showing || controlsSeen || role !== "player") return;
  controlsCard.hide();
  controlsLegend.setExpanded(false);
  controlsPending = true;
}

/** The Final card closed: the deferred first-time card opens now. */
function openPendingControls(): void {
  if (!controlsPending) return;
  controlsPending = false;
  if (shouldShowCard(controlsSeen, role) || (import.meta.env.DEV && devControls)) openControls();
}

/** On each match update: the card goes away once a serve goes in, and the legend dims for the rally. */
function trackControlsPhase(phase: MatchPhase): void {
  document.body.classList.toggle("in-rally", phase === "rally");
  if (!controlsCard.showing) return;
  if (controlsPhase === "serve" && phase === "rally" && !(import.meta.env.DEV && devControls)) closeControls();
  controlsPhase = phase;
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

/**
 * Lower-third serve prompt: instructions for the server, "<NAME> TO SERVE" for everyone else, and
 * the add-a-bot hint for a Player warming up with a seat open.
 */
function renderServePrompt(): void {
  const prompt = servePrompt(match, role, selfSlot, lastSeatOpen);
  if (!prompt) {
    servePromptEl.classList.remove("show");
    return;
  }
  if ("text" in prompt) {
    servePromptEl.replaceChildren(prompt.text);
  } else {
    // The nickname is user input: textContent only.
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = names.get(prompt.server)?.name ?? prompt.server;
    servePromptEl.replaceChildren(who, "to serve");
  }
  servePromptEl.classList.add("show");
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

/** The open vote (reset or rematch), from the server. */
let vote: VoteMsg | null = null;
/** We accepted the open vote (or started it): the Accept button settles. */
let acceptedVote = false;

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
  const at = { player: role === "player", finalPhase, rally: match?.phase === "rally" };
  votePanel.render(votePanelView(v, at, acceptedVote));
}

// ── Final card ───────────────────────────────────────────────────────────────

/** When the Final card is due (local clock), or null when none is waiting. */
let finalDueAt: number | null = null;

/** The Final card for the current match state (a dev sample with ?finalCard=1), or null. */
function currentFinal(): FinalModel | null {
  if (import.meta.env.DEV && devFinal) return finalModel(devFinalMatch(selfTeam ?? "A"), names);
  // A dev fault (?fault=) is shot over whatever state the shared dev room is in.
  if (import.meta.env.DEV && devFault) return null;
  return match ? finalModel(match, names) : null;
}

/**
 * After each match update: a finished match makes the Final card due FINAL_DELAY_MS later; a new
 * match (the Rematch, a reset) takes it off, and the MATCH Banner opens it.
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
  openPendingControls();
}

/** Once per frame: show the due Final card once the director is back to live; it replaces the Set Banner. */
function tickFinal(now: number): void {
  if (!finalDue(finalDueAt, now, replay.live)) return;
  finalDueAt = null;
  const model = currentFinal();
  if (!model) return;
  finalCard.show(model);
  finalCardShowing = true;
  deferControls();
  bannerQueue.clear();
  document.body.classList.add("final-up");
  renderVote();
}

// ── Join screen: the nickname form, the loading state and the reload state, over the arena ──

/** The court moves left by this much of the width, clear of the panel (as in the comp). */
const JOIN_FRAME_SHIFT = 0.2;

/** What the join screen shows; it is hidden while playing. */
type JoinView = "form" | "loading" | "outdated";

function openJoin(view: JoinView): void {
  joinScreen.dataset.view = view;
  joinScreen.classList.add("show");
  document.body.classList.add("join-up");
  scene.setFrameShift(JOIN_FRAME_SHIFT);
}

function closeJoin(): void {
  joinScreen.classList.remove("show");
  document.body.classList.remove("join-up");
  scene.setFrameShift(0);
}

/** True while the join screen asks for something (a nickname or a reload), not while it is loading. */
function joinAsking(): boolean {
  return joinScreen.classList.contains("show") && joinScreen.dataset.view !== "loading";
}

/** Whether the room line shows a live roster (which outranks a /status reading). */
let roomFromRoster = false;

/** The room line under the legend; null before any roster (the socket only opens on PLAY). */
function renderRoom(roster: { players: readonly { isBot: boolean }[]; spectatorCount: number } | null): void {
  roomFromRoster = roster !== null;
  joinRoom.textContent = roomLine(roster);
}

/** Before connecting, show the room from GET /status unless a roster has come in; silent on failure. */
function showRoomCounts(counts: Promise<RoomCounts | null> = fetchRoomCounts(resolveServerUrl())): void {
  void counts.then((c) => {
    if (c && !roomFromRoster) joinRoom.textContent = countsLine(c);
  });
}

/** Holds the field to 16 code points (an emoji counts once), then updates the counter. */
function onNickInput(): void {
  const capped = capName(nickInput.value);
  if (capped !== nickInput.value) nickInput.value = capped;
  nickCount.textContent = nameCount(capped);
  nickCount.classList.toggle("full", Array.from(capped).length >= NAME_MAX_LENGTH);
}

function showLoading(status: ConnStatus): void {
  // Only relevant once the player has chosen to connect (the form is dismissed).
  if (joinAsking()) return;
  // Once in, a dropped socket stays on the live view: the #conn chip says "Reconnecting…".
  if (joined) return;
  loadingTitle.textContent =
    status === "reconnecting" ? "Reconnecting…" : "Waking up the server…";
  loadingHint.textContent =
    status === "open"
      ? "Connected — entering the court…"
      : status === "reconnecting"
        ? "The server went to sleep — waking it back up…"
        : "Connecting…";
  openJoin("loading");
}

function hideLoading(): void {
  if (joinScreen.dataset.view === "loading") closeJoin();
}

// ── Instant replay ───────────────────────────────────────────────────────────

/** True while the Final card is up: no replay starts over it. */
let finalCardShowing = false;
const replay = new ReplayController({
  setView: (on) => {
    scene.setReplay(on);
    document.body.classList.toggle("replaying", on);
  },
  finalCardShowing: () => finalCardShowing,
  forceNotable: () => import.meta.env.DEV && devForceReplay,
});

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
    if (s !== "open") document.body.classList.remove("in-rally");
    if (s === "closed") hideLoading();
    else showLoading(s);
  },
  onWelcome: (msg) => {
    predictor.reset();
    interp.reset();
    events.clear();
    // Forget the old match state too: the first update after a (re)connect never counts as a
    // point end, so a near-empty recording is never replayed.
    match = null;
    replay.reset(performance.now());
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
      resetbtn.classList.add("show");
    } else {
      input?.dispose();
      input = null;
      selfSlot = null;
      scene.setSpectatorCamera();
      scene.setSelfMarker(null);
      resetbtn.classList.remove("show");
    }
    renderVote();
    renderControls();
    if (import.meta.env.DEV && devFault) {
      startDevFault(devFault, { side: selfSide, team: () => selfTeam, play: (h, ms) => scene.devFault(h, ms) });
    }
    if (msg.role === "player" && devBots > 0) {
      for (let i = 0; i < devBots; i++) net.send({ t: "addbot" });
      devBots = 0;
    }
  },
  onRoster: (msg) => {
    renderRoom(msg);
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
    const prev = match;
    scoreBug.render(bugModel(msg, match));
    updateBanner(msg, match);
    replay.onMatch(msg, match, performance.now());
    match = msg;
    updateFinal();
    renderVote();
    nameTags.setRally(msg.phase === "rally");
    trackControlsPhase(msg.phase);
    renderServePrompt();
    renderBoards();
    onMatchEvent(msg);
    if (import.meta.env.DEV && devAutoServe) autoServe?.onMatch(match);
    const hk = msg.highlight ? JSON.stringify(msg.highlight) : null;
    // Not on the first update after a (re)connect: that point ended before we were watching.
    // A dev fault (?fault=) keeps the screen to itself.
    const devFaultOn = import.meta.env.DEV && devFault !== null;
    if (hk && hk !== lastHighlightKey && prev && !devFaultOn) scene.showFault(msg.highlight!);
    lastHighlightKey = hk;
  },
  onVote,
  onKicked: (reason) => {
    showNickname(reason);
  },
  onOutdated: showOutdated,
  onReplaySkip: () => replay.skip(performance.now()),
  onReaction: (msg) => {
    reactions.show(msg.slot, msg.id);
    showBoardReaction(msg.id);
  },
  onSnapshot: (msg) => {
    interp.add(msg);
    replay.onSnapshot(msg);
    if (import.meta.env.DEV) autoServe?.onSnapshot(msg.serverTime);
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
  // Kicked: the next PLAY is a fresh join, with the loading state.
  joined = false;
  renderTakeSeat(lastSeatOpen);
  nickMsg.textContent = message;
  // The socket is closed: the last roster is stale.
  renderRoom(null);
  showRoomCounts();
  openJoin("form");
  resetbtn.classList.remove("show");
  controlsCard.hide();
  controlsPending = false;
  controlsLegend.setExpanded(false);
  ctlLegend.classList.remove("show");
  document.body.classList.remove("in-rally");
  vote = null;
  renderVote();
  nickInput.focus();
}

/** A newer client is live: the join screen offers a reload instead of the form. */
function showOutdated(): void {
  outdated = true;
  hideLoading();
  nickGo.textContent = "Reload";
  nickMsg.textContent = "A new version of Meuss Padel Club is out.";
  openJoin("outdated");
  nickGo.focus();
}

function play(): void {
  if (outdated) {
    location.reload();
    return;
  }
  const name = sanitizeName(nickInput.value, "Player");
  // Straight to the loading state: the wordmark stays put while the form makes way.
  openJoin("loading");
  net.connect(name);
}

fillJoinLegend(document.getElementById("join-controls")!);
renderRoom(null);
showRoomCounts(roomCountsAtLoad);
// A form, so Enter in the field and the PLAY button both submit.
joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  play();
});
nickInput.addEventListener("input", onNickInput);
resetbtn.addEventListener("click", acceptVote);
blurAfterClick(resetbtn);

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
mutebtn.addEventListener("click", toggleMute);
blurAfterClick(mutebtn);
showNickname();

// Dev-only: ?join=<name>&bots=<n> skips the nickname card (used by `pnpm shoot`).
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  // ?quality=high|low pins the renderer quality (the shoot tool measures each level).
  const quality = q.get("quality");
  if (quality === "high" || quality === "low") scene.forceQuality(quality);
  devForceReplay = q.get("forceReplay") === "1";
  devFinal = q.get("finalCard") === "1";
  devControls = q.get("controls") === "1";
  // A fresh headless profile has never closed the card: keep it off other screenshots.
  if (q.get("join") !== null && !devControls) controlsSeen = true;
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
  if (q.get("tray") === "1") tray.set(true);
  const fault = q.get("fault");
  const highlight = fault === null ? null : devFaultHighlight(fault);
  if (highlight) {
    const at = q.get("faultAt");
    devFault = { highlight, freezeMs: at === null ? null : Number(at) };
  }
  // ?joinView=loading|outdated holds that join state; ?roomStatus=3,1 fakes the room line.
  const joinView = q.get("joinView");
  if (joinView === "loading") {
    openJoin("loading");
    showLoading("connecting");
  } else if (joinView === "outdated") showOutdated();
  const room = q.get("roomStatus")?.split(",").map(Number);
  if (room?.length === 2) {
    renderRoom({ players: Array.from({ length: room[0]! }, () => ({ isBot: false })), spectatorCount: room[1]! });
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

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const typing = e.target instanceof HTMLInputElement;
  if (e.key === "?" && !typing && ctlLegend.classList.contains("show")) {
    toggleControls();
    return;
  }
  if (e.key === "Escape") {
    const closes = escapeCloses({ controlsCard: controlsCard.showing, tray: tray.open });
    if (closes === "controls") closeControls();
    else if (closes === "tray") tray.set(false);
    if (closes) return;
  }
  if (e.code === "KeyB" && role === "player") net.send({ t: "addbot" });
  else if (e.code === "KeyN" && role === "player") net.send({ t: "clearbots" });
  else if (e.code === "KeyM" && !(e.ctrlKey || e.metaKey || e.altKey) && !(e.target instanceof HTMLInputElement)) {
    toggleMute();
  }
  else if (e.code === "KeyE" && role === "player" && !joinScreen.classList.contains("show")) {
    tray.set(!tray.open);
  }
  // Enter skips the replay for everyone (Space stays the serve toss). A focused button keeps its Enter.
  else if (
    (e.code === "Enter" || e.code === "NumpadEnter") &&
    role === "player" &&
    replay.showing &&
    !(e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement)
  ) {
    net.send({ t: "skipreplay" });
    replay.skip(performance.now());
  }
});

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

/** Send one input (the idle defaults under `extra`) and predict it locally. */
function sendInput(move: Vec2, aim: Vec2, extra: Partial<InputMsg>): InputMsg {
  const msg: InputMsg = {
    t: "input",
    seq: inputSeq++,
    ts: performance.now(),
    move,
    aim,
    shot: null,
    view: interp.renderTime,
    serve: false,
    ...extra,
  };
  net.send(msg);
  predictor.applyInput({ seq: msg.seq, move: msg.move }, selfSide(), selfLocked());
  return msg;
}

/** Dev only (?autoserve=1): serves by itself so `pnpm shoot` can show rallies. */
const autoServe = import.meta.env.DEV
  ? new AutoServe({
      locked: selfLocked,
      side: selfSide,
      renderTime: () => interp.renderTime,
      send: (extra) => {
        // We are locked at the serve spot: no movement.
        if (ownPos === null) return;
        const msg = sendInput({ x: 0, z: 0 }, autoServe!.aimAtBoxCentre(ownPos), extra);
        if (msg.shot && selfSlot && !replay.showing) scene.triggerSwing(selfSlot);
      },
    })
  : null;

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
        ? autoServe!.aimAtBoxCentre(ownPos)
        : ownPos !== null
        ? scene.aimFromPointer(i.pointer.x, i.pointer.y, ownPos.x, ownPos.z)
        : { x: 0, z: selfTeam === "A" ? 1 : -1 };
    if (aim.x !== 0 || aim.z !== 0) selfYaw = Math.atan2(aim.x, aim.z);
    const { steps, accumulator } = fixedSteps(stepAccum, dt);
    stepAccum = accumulator;
    for (let k = 0; k < steps; k++) {
      sendInput(i.move, aim, { shot: carryShot, serve: carryServe });
      carryShot = null;
      carryServe = false;
    }
    // During a replay our avatar shows recorded play: no live swing on it.
    if (i.shot && selfSlot && !replay.showing) scene.triggerSwing(selfSlot);
  }

  interp.update(dt * 1000);
  const now = performance.now();
  replay.tick(now);
  events.drain(interp.renderTime, replay.showing ? dropEvents : playEvents, EVENT_STALE_MS);
  const s = interp.sample();
  framePos.clear();
  if (replay.showing) {
    // Recorded play through the Broadcast cam; our predicted position keeps tracking live input.
    const predicted = predictor.renderPosition(dt);
    if (predicted) ownPos = setOwnPos(predicted.x, predicted.z);
    const pose = replay.pose(now, playReplayEvents);
    if (pose) {
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
      nameTags.update(p.slot, x, z);
      if (p.slot === selfSlot) {
        ownPos = setOwnPos(x, z);
        scene.focusCamera(x, p.pos.y, z);
      }
    }
    for (const slot of seenSlots) {
      if (!present.has(slot)) {
        scene.removePlayer(slot as Slot);
        nameTags.remove(slot as Slot);
        seenSlots.delete(slot);
      }
    }
  }
  reactions.update(framePos);
  tickFinal(now);
  tickBanner();
});
