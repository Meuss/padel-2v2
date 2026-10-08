import { BALL, COURT, GRAVITY, SHOT, TOSS } from "./constants.js";
import type { Vec2, Vec3 } from "./messages.js";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

/**
 * How badly a swing is mistimed, from its time to closest: 0 inside the perfect window, rising
 * linearly to 1 two windows beyond it (|tClosest| = 3·SHOT.perfectWindowS). Pure.
 */
export function offTimingSeverity(tClosest: number): number {
  const w = SHOT.perfectWindowS;
  return clamp((Math.abs(tClosest) - w) / (2 * w), 0, 1);
}

/** Timing from time-to-closest: still approaching beyond the window is early, already past is late. */
export function judgeTiming(tClosest: number): Timing {
  if (Math.abs(tClosest) <= SHOT.perfectWindowS) return "perfect";
  return tClosest > 0 ? "early" : "late";
}

/**
 * Which shot a swing becomes: a Smash if the ball is above SHOT.smashHeight (strictly) and
 * struck within SHOT.smashMaxDistM of the net, else the requested kind.
 */
export function resolveKind(
  requested: "drive" | "lob",
  ballHeight: number,
  distToNet: number,
): "drive" | "lob" | "smash" {
  return ballHeight > SHOT.smashHeight && distToNet <= SHOT.smashMaxDistM ? "smash" : requested;
}

/** Where a shot is struck: ball height and distance (m) to the net plane on the hitter's side. */
export interface ShotContact {
  y: number;
  distToNet: number;
}

/**
 * The share of its launch speed a ball keeps on average over t seconds of flight, allowing
 * for SHOT.dragAllowance (exponential decay): (1 - e^{-ct}) / (ct), 1 with no drag.
 */
export function dragKeep(t: number): number {
  const ct = SHOT.dragAllowance * t;
  return ct > 1e-9 ? (1 - Math.exp(-ct)) / ct : 1;
}

/**
 * Vertical launch speed for a ball struck at contactY, distToNet from the net, approaching it
 * at speedTowardNet (the horizontal speed component toward the net), to pass the net plane
 * `clearance` above the tape. Solved under exact linear drag (dv/dt = -c·v, plus gravity on y),
 * the ball's own damping in the physics: the time to the net is -ln(1 - c·d/v)/c, and the
 * vertical rise over it is damped too. A ball too slow to ever reach the net (c·d/v >= 0.95)
 * is solved for a 3 s flight instead, so the lift stays finite.
 *
 * The tape is taken at its centre height (COURT.netHeight), not at netHeightAt(crossing x):
 * the crossing point is not known here (off-timing turns the aim afterwards), and the net
 * rises only 4 cm to the posts, well inside both margins (0.45 m for Drives and Lobs, 0.15 m
 * for Smashes), so a shot aimed down the line still clears it.
 */
export function clearanceLift(
  contactY: number,
  distToNet: number,
  speedTowardNet: number,
  clearance: number = SHOT.netClearance,
): number {
  const c = SHOT.dragAllowance;
  const k = (c * distToNet) / speedTowardNet;
  const t = k < 0.95 ? -Math.log(1 - k) / c : 3;
  const e = (1 - Math.exp(-c * t)) / c;
  return (COURT.netHeight + clearance - contactY + (GRAVITY * t) / c) / e - GRAVITY / c;
}

/** |aim.z|, floored at SHOT.minAimTowardNet so a near-sideways aim can't ask for an unbounded shot. */
const towardNet = (aim: Vec2) => Math.max(Math.abs(aim.z), SHOT.minAimTowardNet);

/**
 * Horizontal launch speed for a Lob struck at contactY, distToNet from the net, along `aim`,
 * to land depthPastNet (m, along z) beyond the net: drag-free flight time with SHOT.lob.lift
 * under GRAVITY down to the ball's radius, horizontal distance allowing for drag. Clamped to
 * [SHOT.lob.minPower, SHOT.lob.maxPower].
 */
export function lobPower(contactY: number, distToNet: number, aim: Vec2, depthPastNet: number): number {
  const vy = SHOT.lob.lift;
  const drop = Math.max(0, contactY - BALL.radius);
  const t = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * drop)) / GRAVITY;
  const range = (distToNet + depthPastNet) / towardNet(aim);
  return clamp(range / (t * dragKeep(t)), SHOT.lob.minPower, SHOT.lob.maxPower);
}

/**
 * Ball velocity for a shot. `aim` is a unit world-space XZ direction. Off-timing rotates the aim
 * around +Y by aimErrorDeg. Sign convention: with x' = x·cos a - z·sin a, early uses
 * a = +aimErrorDeg (aim +z drifts to x < 0) and late uses a = -aimErrorDeg (x > 0).
 * An off-timed Drive or Smash scales its power and lift by 1 - (1 - factor)·severity
 * (`severity` from offTimingSeverity, 1 by default: the full SHOT.offTiming factors).
 * With a `contact` on the hitter's side:
 * - a Drive gets at least the lift to clear the net at its (off-timed) power, by a margin of
 *   SHOT.netClearance - 0.6·severity: a slightly mistimed Drive still clears, a badly mistimed
 *   one can find the net;
 * - a Lob's power is solved to land SHOT.lobDepthPastNet past the net, minus (early) or plus
 *   (late) SHOT.offTiming.lobDepthErrorM, with the table lift (raised to clear the net if needed);
 * - a Smash's lift is raised, if needed, to pass SHOT.smashNetMargin above the tape.
 * Without a contact, every shot uses its table power and lift, scaled when off-timed.
 */
export function shotVelocity(
  kind: "drive" | "lob" | "smash",
  timing: Timing,
  aim: Vec2,
  contact?: ShotContact,
  severity = 1,
): Vec3 {
  const base = SHOT[kind];
  const off = timing !== "perfect";
  const deg = timing === "early" ? SHOT.offTiming.aimErrorDeg : timing === "late" ? -SHOT.offTiming.aimErrorDeg : 0;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dir: Vec2 = { x: aim.x * cos - aim.z * sin, z: aim.x * sin + aim.z * cos };
  const hasContact = contact !== undefined && contact.distToNet > 0;

  let power: number = base.power;
  let lift: number = base.lift;
  if (kind === "lob" && hasContact) {
    const err = SHOT.offTiming.lobDepthErrorM;
    const depth = SHOT.lobDepthPastNet + (timing === "early" ? -err : timing === "late" ? err : 0);
    power = lobPower(contact.y, contact.distToNet, dir, depth);
    lift = Math.max(lift, clearanceLift(contact.y, contact.distToNet, towardNet(dir) * power));
  } else {
    const sev = off ? severity : 0;
    power *= 1 - (1 - SHOT.offTiming.power) * sev;
    lift *= 1 - (1 - SHOT.offTiming.lift) * sev;
    if (kind === "drive" && hasContact) {
      const margin = SHOT.netClearance - 0.6 * sev;
      lift = Math.max(lift, clearanceLift(contact.y, contact.distToNet, towardNet(dir) * power, margin));
    }
    if (kind === "smash" && hasContact) {
      const floor = clearanceLift(contact.y, contact.distToNet, towardNet(dir) * power, SHOT.smashNetMargin);
      lift = Math.max(lift, floor);
    }
  }
  return { x: dir.x * power, y: lift, z: dir.z * power };
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
