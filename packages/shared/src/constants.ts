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

export const PROTOCOL_VERSION = 2;

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
  /** Reach within which a swing can connect with the ball (from body centre). */
  reach: 2.8,
} as const;

export const SWING = {
  /** Horizontal speed imparted to the ball on a successful hit (m/s). */
  power: 8.5,
  /** Upward speed added to a hit so the ball arcs (m/s). */
  lift: 6,
  /** Cooldown between swings (ms). */
  cooldownMs: 300,
} as const;

/** Distance from the net to each service line (regulation padel). */
export const SERVICE_LINE_DIST = 6.95;

export const SERVE = {
  height: 0.95, // launch height — below the waist
  flightTime: 1.1, // seconds to reach the target bounce point (higher, clearing arc)
} as const;

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
