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
  /** Ball height (m) at contact above which (strictly) a swing becomes a Smash. */
  smashHeight: 2.1,
  /** A high ball becomes a Smash only when struck at most this far (m) from the net. */
  smashMaxDistM: 5.5,
  /** |time to closest approach| (s) within which Timing is "perfect". */
  perfectWindowS: 0.08,
  /** Drives and Lobs get at least the lift (m) to pass this far above the net tape. */
  netClearance: 0.45,
  /** A Smash is lifted, if needed, to pass at least this far (m) above the net tape. */
  smashNetMargin: 0.15,
  /** A perfect Lob lands this far (m) past the net, whatever the hitter's depth. */
  lobDepthPastNet: 7.5,
  /**
   * Air drag (1/s) the shot maths allow for: the ball's own linear damping, so a ball
   * keeps (1 - e^{-ct}) / (ct) of its launch speed on average over t seconds.
   */
  dragAllowance: BALL.linearDamping,
  /** The share of the aim pointing at the net never counts as less than this (near-sideways aims). */
  minAimTowardNet: 0.3,
  drive: { power: 12.5, lift: 3.6 },
  /** `power` is the Lob's speed when there is no contact to aim from; otherwise it is solved within [minPower, maxPower]. */
  lob: { power: 7.0, lift: 9.5, minPower: 4.0, maxPower: 13.0 },
  smash: { power: 16.0, lift: -1.5 },
  /**
   * Early/late Timing: Drive and Smash scale power and lift; every shot's aim rotates by
   * aimErrorDeg. A Lob instead lands lobDepthErrorM (m) short (early) or long (late).
   */
  offTiming: { power: 0.82, lift: 0.9, aimErrorDeg: 9, lobDepthErrorM: 2.0 },
} as const;

/** Bot decision-making: their fixed "decent" skill and shot choice. */
export const BOT = {
  /** Chance a swing is timed one perfect-window early or late instead of perfect. */
  offTimingChance: 0.25,
  /** Chance of a Lob when the opponents are not both at the net. */
  lobChance: 0.15,
  /** Opponents closer than this |z| (m) to the net count as "at the net" (both there → Lob). */
  netZoneM: 4,
  /** Furthest |x| (m) a bot aims at. */
  aimMaxX: 3.5,
  /** Furthest |x| (m) a bot aims a Smash at: down the middle. */
  smashMaxX: 1.5,
  /** Bots aim this fraction of the court length deep: the middle of the opposite half. */
  aimDepthFrac: 0.25,
  /** An off-timed swing is this many perfect windows (SHOT.perfectWindowS) early or late. */
  offTimingWindows: 2,
  /** Of the off-timed swings, the share that are early (the rest are late). */
  earlyShare: 0.5,
} as const;

export const TOSS = {
  vy: 3.2, // m/s upward from SERVE.height
  expireS: 0.75, // toss falls back below the hand → "Missed the toss"
  perfectWindowS: 0.1, // |t - apex| for a clean serve
  depthPerSecond: 18, // metres of depth error per second beyond the window (late → long, early → short)
  boxMargin: 0.4, // the aim point is clamped this far (m) inside the service box
  aimBeyondM: 6, // the serve aim point lies |server z| + this (m) along the aim: ~this far past the net
} as const;

/**
 * Lag compensation: how far back a swing may be judged, how much ball history the server
 * keeps, and how far (m) a held ball must jump to count as a teleport (a new flight).
 */
export const LAG = { maxRewindMs: 250, historyMs: 600, teleportM: 0.5 } as const;

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
