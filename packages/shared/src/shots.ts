import { COURT, GRAVITY, SHOT, TOSS } from "./constants.js";
import type { Vec2, Vec3 } from "./messages.js";

export type ShotKind = "drive" | "lob" | "smash" | "serve";
export type Timing = "early" | "perfect" | "late";

export interface ServiceBox {
  xMin: number;
  xMax: number;
  /** |z| of the near edge, measured from the net. */
  zNear: number;
  /** |z| of the far edge (the service line). */
  zFar: number;
  /** Sign of z on the half this box is on. */
  side: -1 | 1;
}

/** Signed time (s) until the ball is closest to the racket point; >0 = still approaching. rel = ball - racketPoint. */
export function timeToClosest(rel: Vec3, vel: Vec3): number {
  const vv = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
  if (vv < 1e-9) return 0;
  return -(rel.x * vel.x + rel.y * vel.y + rel.z * vel.z) / vv;
}

/** Timing from time-to-closest: still approaching beyond the window is early, already past is late. */
export function judgeTiming(tClosest: number): Timing {
  if (Math.abs(tClosest) <= SHOT.perfectWindowS) return "perfect";
  return tClosest > 0 ? "early" : "late";
}

/** Which shot a swing becomes: smash if the ball is high enough, else the requested kind. */
export function resolveKind(requested: "drive" | "lob", ballHeight: number): "drive" | "lob" | "smash" {
  return ballHeight > SHOT.smashHeight ? "smash" : requested;
}

/** Where a shot is struck: ball height and distance (m) to the net plane on the hitter's side. */
export interface ShotContact {
  y: number;
  distToNet: number;
}

/**
 * Vertical launch speed for a ball struck at contactY, distToNet from the net, moving at
 * horizontalSpeed, to pass the net plane at COURT.netHeight + SHOT.netClearance (no drag).
 */
export function clearanceLift(
  _kind: "drive" | "lob",
  contactY: number,
  distToNet: number,
  horizontalSpeed: number,
): number {
  const t = distToNet / horizontalSpeed;
  return (COURT.netHeight + SHOT.netClearance - contactY + 0.5 * GRAVITY * t * t) / t;
}

/**
 * Ball velocity for a shot. `aim` is a unit world-space XZ direction. Off-timing scales power and
 * lift and rotates the aim around +Y by aimErrorDeg. Sign convention: with x' = x·cos a - z·sin a,
 * early uses a = +aimErrorDeg (aim +z drifts to x < 0) and late uses a = -aimErrorDeg (x > 0).
 * With a `contact`, a Drive or Lob gets at least the lift to clear the net at the table power
 * (before off-timing scales it, so a mistimed shot can still find the net). Smash ignores it.
 */
export function shotVelocity(
  kind: "drive" | "lob" | "smash",
  timing: Timing,
  aim: Vec2,
  contact?: ShotContact,
): Vec3 {
  const base = SHOT[kind];
  const off = timing !== "perfect";
  let lift: number = base.lift;
  if (contact && kind !== "smash" && contact.distToNet > 0) {
    lift = Math.max(lift, clearanceLift(kind, contact.y, contact.distToNet, base.power));
  }
  const power = off ? base.power * SHOT.offTiming.power : base.power;
  if (off) lift *= SHOT.offTiming.lift;
  const deg = timing === "early" ? SHOT.offTiming.aimErrorDeg : timing === "late" ? -SHOT.offTiming.aimErrorDeg : 0;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    x: (aim.x * cos - aim.z * sin) * power,
    y: lift,
    z: (aim.x * sin + aim.z * cos) * power,
  };
}

/** Toss height above SERVE.height at t seconds after the toss starts (kinematic). */
export function tossOffset(t: number): number {
  return TOSS.vy * t - 0.5 * GRAVITY * t * t;
}

/** Seconds from toss start to apex. */
export function tossApex(): number {
  return TOSS.vy / GRAVITY;
}

/** Serve Timing from strike time t (s after toss start). */
export function serveTiming(t: number): Timing {
  const d = t - tossApex();
  if (Math.abs(d) <= TOSS.perfectWindowS) return "perfect";
  return d > 0 ? "late" : "early";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Where a struck serve should land. The aim point is clamped TOSS.boxMargin inside the box; beyond the
 * perfect window the depth |z| shifts by depthPerSecond × (|t - apex| - window), longer if late,
 * shorter if early. x keeps the clamped aim. The result is not clamped back into the box.
 */
export function serveTarget(aimPoint: Vec2, box: ServiceBox, t: number): Vec2 {
  const margin = TOSS.boxMargin;
  const x = clamp(aimPoint.x, box.xMin + margin, box.xMax - margin);
  let depth = clamp(Math.abs(aimPoint.z), box.zNear + margin, box.zFar - margin);
  const d = t - tossApex();
  const excess = Math.abs(d) - TOSS.perfectWindowS;
  if (excess > 0) depth += (d > 0 ? 1 : -1) * TOSS.depthPerSecond * excess;
  return { x, z: box.side * depth };
}
