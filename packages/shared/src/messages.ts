/**
 * Wire protocol shared by client and server. All messages are JSON objects with
 * a `t` discriminator. Both sides import these types so the format cannot drift.
 */

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
  swing: boolean; // true on the tick a swing is requested
  serve: boolean; // true on the tick the serve is requested
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

/** Start or accept the current "reset the set" vote. */
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

export type ClientMessage =
  | JoinMsg
  | InputMsg
  | AddBotMsg
  | ClearBotsMsg
  | ActivityMsg
  | VoteResetMsg
  | VoteDeclineMsg
  | ReactMsg;

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
}

/** Roster changes (someone joined/left, role changed). */
export interface RosterMsg {
  t: "roster";
  players: PlayerInfo[];
  spectatorCount: number;
}

/** Per-player dynamic state in a snapshot. */
export interface PlayerState {
  slot: Slot;
  pos: Vec3;
  /** Facing/aim yaw in radians, for orienting the avatar + racket. */
  yaw: number;
  /** True if this player swung since the previous snapshot (drives animation). */
  swing?: boolean;
  /** Seq of the last input the server applied for this player (humans only). */
  ack?: number;
}

/** Authoritative world state at a given tick. */
export interface SnapshotMsg {
  t: "snapshot";
  tick: number;
  serverTime: number; // server clock (ms)
  ball: { pos: Vec3; vel: Vec3 };
  players: PlayerState[];
}

export type MatchPhase = "warmup" | "serve" | "rally" | "between" | "over";

/** What to highlight when a point is lost, so the client can show why. */
export type FaultKind = "ground" | "wall" | "net" | "player" | "out";

export interface FaultHighlight {
  kind: FaultKind;
  pos?: Vec3; // world position of the offending bounce/contact
  slot?: Slot; // offending player (double hit)
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
  /** Transient flash text ("Let", "Fault", "Point — Blue", "Game", "Set"…). */
  event: string | null;
  /** Explanation of why the last point ended (shown under the flash). */
  reason: string | null;
  /** What to highlight in the scene for the last point. */
  highlight: FaultHighlight | null;
  winner: Team | null;
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

/** State of the current "reset the set" vote (players only). */
export interface VoteMsg {
  t: "vote";
  active: boolean;
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

export type ServerMessage =
  | WelcomeMsg
  | RosterMsg
  | SnapshotMsg
  | MatchMsg
  | OutdatedMsg
  | KickedMsg
  | VoteMsg
  | ReactionMsg;

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
