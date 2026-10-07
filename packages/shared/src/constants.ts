/**
 * Shared game constants. These define the single source of truth for the court
 * geometry and simulation timing, imported by both the authoritative server and
 * the rendering client so the two can never disagree about the world.
 *
 * Coordinate system (right-handed, metres):
 *   x  → court width   (left/right),   range [-WIDTH/2, +WIDTH/2]
 *   y  → up
 *   z  → court length  (towards/away from net), range [-LENGTH/2, +LENGTH/2]
 *   The net sits on the plane z = 0. Team A defends z < 0, Team B defends z > 0.
 */

export const PROTOCOL_VERSION = 3;

/** Gravity (m/s²), shared by the physics world and the kinematic toss/serve maths. */
export const GRAVITY = 9.81;

/** Real padel court is 20m × 10m. */
export const COURT = {
  length: 20, // along z
  width: 10, // along x
  wallHeight: 4, // glass + mesh fence
  netHeight: 0.88,
  glassHeight: 3, // solid glass portion of the back/side walls
} as const;

/** Simulation runs at a fixed timestep; snapshots are sent less often. */
export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
export const TICK_DT = 1 / TICK_RATE;

export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_MS = 1000 / SNAPSHOT_RATE;

/** How far behind real time the client renders, to smooth interpolation (ms). */
export const INTERP_DELAY_MS = 100;

export const MAX_PLAYERS = 4;

/** Longest nickname, in Unicode code points. Matches the client's input maxlength. */
export const NAME_MAX_LENGTH = 16;

export const BALL = {
  radius: 0.07,
  restitution: 0.92, // bouncy — high, lively rebounds
  linearDamping: 0.16, // light air resistance so the ball carries further
} as const;

export const PLAYER = {
  radius: 0.4,
  height: 1.8,
  speed: 6.5, // m/s
  /** Reach within which a swing can connect with the ball (from the racket point). */
  reach: 2.8,
  /** Height (m) of the racket point a swing reaches from, above the player's feet. */
  racketHeight: 1.0,
} as const;

export const SWING = {
  /** Cooldown between swings (ms). */
  cooldownMs: 300,
} as const;

/** Distance from the net to each service line (regulation padel). */
export const SERVICE_LINE_DIST = 6.95;

export const SERVE = {
  height: 0.95, // launch height — below the waist
  flightTime: 1.1, // seconds to reach the target bounce point (higher, clearing arc)
} as const;

export const SHOT = {
  /** Ball height (m) at contact above which a swing becomes a Smash. */
  smashHeight: 2.1,
  /** |time to closest approach| (s) within which Timing is "perfect". */
  perfectWindowS: 0.08,
  drive: { power: 12.5, lift: 3.6 },
  lob: { power: 7.0, lift: 9.5 },
  smash: { power: 16.0, lift: -1.5 },
  /** Multipliers applied for early/late Timing. */
  offTiming: { power: 0.82, lift: 0.9, aimErrorDeg: 9 },
} as const;

export const TOSS = {
  vy: 3.2, // m/s upward from SERVE.height
  expireS: 0.75, // toss falls back below the hand → "Missed the toss"
  perfectWindowS: 0.1, // |t - apex| for a clean serve
  depthPerSecond: 18, // metres of depth error per second beyond the window (late → long, early → short)
  boxMargin: 0.4, // the aim point is clamped this far (m) inside the service box
  aimBeyondM: 6, // the serve aim point lies |server z| + this (m) along the aim: ~this far past the net
} as const;

/** Lag compensation: how far back a swing may be judged, and how much ball history the server keeps. */
export const LAG = { maxRewindMs: 250, historyMs: 600 } as const;

export const MATCH = {
  gamesToWinSet: 6,
  setWinBy: 2,
  tiebreakAt: 6, // 6-6 → tiebreak
  tiebreakTo: 7,
  goldenPoint: true, // sudden-death point at deuce (modern padel)
  /** Pause (ms) between a point ending and the next serve being set up. */
  betweenPointMs: 2200,
} as const;

export const DEFAULT_SERVER_PORT = 8080;
