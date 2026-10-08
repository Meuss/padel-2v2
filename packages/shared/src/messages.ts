/**
 * Wire protocol shared by client and server. All messages are JSON objects with
 * a `t` discriminator. Both sides import these types so the format cannot drift.
 */

import type { ServiceBox, ShotKind, Timing } from "./shots.js";

export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export type Team = "A" | "B";
export type Role = "player" | "spectator";

/** A player's fixed position on the court (two per team). */
export type Slot = "A1" | "A2" | "B1" | "B2";

// ── Client → Server ────────────────────────────────────────────────────────

/** First message after the socket opens. */
export interface JoinMsg {
  t: "join";
  version: number;
  name?: string;
}

/**
 * Sent as exactly one per 60 Hz simulation tick while playing. Spectators do not send these.
 *
 * `move` is in the player's own frame, not world space: x = strafe (+ = the
 * player's right), z = forward (+ = toward the net). The server maps it to world
 * axes using which half the player currently defends (so it stays correct after
 * an ends-swap).
 */
export interface InputMsg {
  t: "input";
  seq: number; // monotonic per client; one input per 60 Hz tick, echoed back as PlayerState.ack
  ts: number; // client clock (ms) for diagnostics
  move: Vec2; // x = strafe, z = forward (player frame), components in [-1, 1]
  aim: Vec2; // normalized aim direction on the ground plane (world space)
  shot: "drive" | "lob" | null; // the shot requested on this tick (left click = Drive, right click = Lob)
  view: number; // server time (ms) of the snapshot state the client is rendering
  serve: boolean; // true on the tick Space is pressed: starts the serve toss
}

/** Spawn an AI bot into a free slot (for testing / filling a match). */
export interface AddBotMsg {
  t: "addbot";
}

/** Remove all AI bots. */
export interface ClearBotsMsg {
  t: "clearbots";
}

/** Sent on real user interaction (throttled) so the server can detect idleness. */
export interface ActivityMsg {
  t: "activity";
}

/** Start a "reset the set" vote, or accept the current vote (reset or rematch). */
export interface VoteResetMsg {
  t: "votereset";
}

/** Decline the current vote. */
export interface VoteDeclineMsg {
  t: "votedecline";
}

/** Send an emote reaction (pops over the player's head for everyone). */
export interface ReactMsg {
  t: "react";
  id: string; // reaction id (image name without extension)
}

/** A Spectator asks for a Seat: a free one, or one a Bot holds. Applied at the next point break. */
export interface TakeSeatMsg {
  t: "takeseat";
}

/** A Player asks every client to cut the replay short and return to live. */
export interface SkipReplayMsg {
  t: "skipreplay";
}

export type ClientMessage =
  | JoinMsg
  | InputMsg
  | AddBotMsg
  | ClearBotsMsg
  | ActivityMsg
  | VoteResetMsg
  | VoteDeclineMsg
  | ReactMsg
  | TakeSeatMsg
  | SkipReplayMsg;

/** Reaction ids that match the images shipped in the client's public/reactions. */
export const REACTIONS = ["gg", "wp", "goat", "wow", "haha", "noob", "mb", "ffs"] as const;
export type ReactionId = (typeof REACTIONS)[number];

// ── Server → Client ──────────────────────────────────────────────────────────

/** Static-ish description of the court so the client can build the scene. */
export interface CourtConfig {
  length: number;
  width: number;
  wallHeight: number;
  netHeight: number;
  glassHeight: number;
}

/** Sent once, right after join, telling the client who it is. */
export interface WelcomeMsg {
  t: "welcome";
  selfId: string;
  role: Role;
  slot: Slot | null; // null for spectators
  team: Team | null;
  court: CourtConfig;
  tickRate: number;
  snapshotRate: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  slot: Slot;
  team: Team;
  isBot: boolean;
}

/** Roster changes (someone joined/left, role changed). */
export interface RosterMsg {
  t: "roster";
  players: PlayerInfo[];
  spectatorCount: number;
  /** True when a Spectator could Take seat: a Seat is free or held by a Bot. */
  seatOpen: boolean;
}

/** Per-player dynamic state in a snapshot. */
export interface PlayerState {
  slot: Slot;
  pos: Vec3;
  /** Facing/aim yaw in radians, for orienting the avatar + racket. */
  yaw: number;
  /** Seq of the last input the server applied for this player (humans only). */
  ack?: number;
}

/** A swing that hit the ball (or a serve strike) since the previous snapshot. */
export interface ShotEvent {
  slot: Slot;
  kind: ShotKind;
  timing: Timing;
  pos: Vec3; // ball position at the hit
}

export type ContactSurface = "floor" | "glass" | "fence" | "net";

/** The ball touching a surface since the previous snapshot. */
export interface ContactEvent {
  surface: ContactSurface;
  pos: Vec3;
  speed: number; // ball speed (m/s) just before the contact
}

/** Authoritative world state at a given tick. */
export interface SnapshotMsg {
  t: "snapshot";
  tick: number;
  /** Server simulation clock (ms): advances TICK_MS per tick. InputMsg.view is in these units. */
  serverTime: number;
  ball: { pos: Vec3; vel: Vec3 };
  players: PlayerState[];
  /** Present only when something happened since the previous snapshot. */
  shots?: ShotEvent[];
  contacts?: ContactEvent[];
}

export type MatchPhase = "warmup" | "serve" | "rally" | "between" | "over";

/** What to highlight when a point is lost, so the client can show why. */
export type FaultKind = "ground" | "wall" | "net" | "player" | "out";

/** What the ball touched at the fault: the floor, the net, or a cage panel by its material. */
export type FaultSurface = "glass" | "mesh" | "net" | "floor";

export interface FaultHighlight {
  kind: FaultKind;
  /**
   * The true positions the fault animation marks (ball centre at the contact), in order:
   * "ground" (double bounce): the first bounce on the target side, then the second (only the
   * second when there was no first); "net": the net contact; "wall": the wall contact; "out":
   * the exit point (over the cage, or the landing outside the box), then the last bounce if
   * any; "player": where the toss was, for a missed toss.
   */
  points?: Vec3[];
  surface?: FaultSurface;
  slot?: Slot; // offending player (double hit, missed toss)
  /** A serve fault: the service box the serve had to land in. */
  box?: ServiceBox;
}

/**
 * What a match event is, so clients react without reading its text. A double fault is a
 * "fault" whose `eventTeam` is the team that won the point.
 */
export type MatchEventKind = "point" | "game" | "set" | "fault" | "let" | "start" | "reset";

export interface TeamStats {
  /** Shots struck, serves included. */
  shots: number;
  /** Shots with perfect Timing. */
  perfect: number;
  smashes: number;
  /** Points won. */
  points: number;
}

export interface MatchStats {
  A: TeamStats;
  B: TeamStats;
  /** Most Shots in one Rally, the serve included. */
  longestRally: number;
  /** Match length in seconds, from the first serve setup to the last point. */
  durationS: number;
}

/** Scoreboard + serve state, sent whenever it changes (not every tick). */
export interface MatchMsg {
  t: "match";
  phase: MatchPhase;
  /** Point labels: "0" | "15" | "30" | "40" | "Ad", or the integer in a tiebreak. */
  pointA: string;
  pointB: string;
  gamesA: number;
  gamesB: number;
  tiebreak: boolean;
  /** Which z-side each team currently defends (-1 = z<0 end, +1 = z>0 end). */
  sideA: -1 | 1;
  serverSlot: Slot | null;
  serveBox: "deuce" | "ad" | null;
  /** True while waiting for the server to trigger the serve. */
  awaitingServe: boolean;
  /** True while the server's toss is in the air (Space pressed, not yet struck). */
  tossing: boolean;
  /** Transient broadcast text ("POINT — AZUL", "FAULT", "LET"…), for display only: read `eventKind`. */
  event: string | null;
  /** What `event` is; null when there is none. */
  eventKind: MatchEventKind | null;
  /** The team a point, game or set (or a double fault's point) went to; null otherwise. */
  eventTeam: Team | null;
  /** Explanation of why the last point ended (shown under the flash). */
  reason: string | null;
  /** What to highlight in the scene for the last point. */
  highlight: FaultHighlight | null;
  winner: Team | null;
  /** Match statistics, set when phase is "over"; null otherwise. */
  stats: MatchStats | null;
}

/** Sent instead of a Welcome when the client speaks another protocol version; the server then closes. */
export interface OutdatedMsg {
  t: "outdated";
  serverVersion: number;
}

/** Sent right before the server closes an idle connection. */
export interface KickedMsg {
  t: "kicked";
  reason: string;
}

/**
 * State of the current vote (players only): a "reset" a player started, or the "rematch" vote
 * opened when a match ends. Either one, when every seated human accepts, restarts the set.
 */
export interface VoteMsg {
  t: "vote";
  active: boolean;
  kind: "reset" | "rematch";
  initiator: string; // name of who started it
  accepted: number;
  needed: number;
}

/** Broadcast when a player reacts, so all clients show it over that avatar. */
export interface ReactionMsg {
  t: "reaction";
  slot: Slot;
  id: string;
}

/** Broadcast when a Player skips the replay: every client cuts back to live. */
export interface ReplaySkipMsg {
  t: "replayskip";
}

export type ServerMessage =
  | WelcomeMsg
  | RosterMsg
  | SnapshotMsg
  | MatchMsg
  | OutdatedMsg
  | KickedMsg
  | VoteMsg
  | ReactionMsg
  | ReplaySkipMsg;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(data: string): ClientMessage {
  return JSON.parse(data) as ClientMessage;
}

export function decodeServer(data: string): ServerMessage {
  return JSON.parse(data) as ServerMessage;
}
