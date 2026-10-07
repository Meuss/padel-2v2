/**
 * Pure gameplay math shared by the server (authoritative) and used by the
 * client for prediction. No physics-engine or DOM dependencies, so these
 * are trivially unit-testable and identical on both sides.
 */
import type { Vec2, Vec3 } from "./messages.js";
import { COURT, PLAYER } from "./constants.js";

/** Cap a move vector to unit length so diagonals aren't faster than cardinals. */
export function normalizeMove(x: number, z: number): Vec2 {
  const len = Math.hypot(x, z);
  if (len > 1) return { x: x / len, z: z / len };
  return { x, z };
}

export interface HalfBounds {
  halfW: number; // max |x|
  halfL: number; // max |z| (back wall)
  netGap: number; // min |z| from the net
}

/**
 * Clamp a player's position to the half they currently defend. `side` is the
 * z-sign of that half (-1 = z<0 end, +1 = z>0 end) — passed rather than the team
 * so it stays correct after an ends-swap.
 */
export function confineToHalf(pos: Vec2, side: number, b: HalfBounds): Vec2 {
  const x = clamp(pos.x, -b.halfW, b.halfW);
  const z =
    side < 0
      ? clamp(pos.z, -b.halfL, -b.netGap)
      : clamp(pos.z, b.netGap, b.halfL);
  return { x, z };
}

const PLAYER_MARGIN = PLAYER.radius + 0.15;

/** How far players may move inside their half: walls minus body radius, net gap. */
export const PLAYER_BOUNDS: HalfBounds = {
  halfW: COURT.width / 2 - PLAYER_MARGIN,
  halfL: COURT.length / 2 - PLAYER_MARGIN,
  netGap: PLAYER.radius + 0.1,
};

/**
 * Advance a player by one movement step. This is the ONLY movement integrator:
 * the server runs it once per tick and the client replays it for prediction, so
 * both must call it with identical inputs to agree. `move` is in the player's
 * frame (x = strafe right, z = toward the net); `side` is the z-sign of the half
 * they defend.
 */
export function stepPlayer(pos: Vec2, move: Vec2, side: -1 | 1, dt: number): Vec2 {
  const m = normalizeMove(move.x, move.z);
  return confineToHalf(
    {
      x: pos.x + m.x * side * PLAYER.speed * dt,
      z: pos.z - m.z * side * PLAYER.speed * dt,
    },
    side,
    PLAYER_BOUNDS,
  );
}

/** Whether a swing at (px, racketY, pz) can reach the ball. */
export function swingConnects(
  px: number,
  racketY: number,
  pz: number,
  ball: Vec3,
  maxDist: number,
): boolean {
  const dx = ball.x - px;
  const dy = ball.y - racketY;
  const dz = ball.z - pz;
  return Math.hypot(dx, dy, dz) <= maxDist;
}

/** Velocity imparted to the ball by a swing: horizontal aim × power, plus lift. */
export function hitVelocity(aim: Vec2, power: number, lift: number): Vec3 {
  return { x: aim.x * power, y: lift, z: aim.z * power };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
