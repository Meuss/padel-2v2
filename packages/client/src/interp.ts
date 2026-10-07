/**
 * Snapshot interpolation buffer. The server sends discrete snapshots at
 * SNAPSHOT_RATE; rendering directly off the latest one looks jerky. Instead we
 * keep a short history and render INTERP_DELAY_MS in the past, linearly
 * interpolating between the two snapshots that bracket the render time. This
 * trades a little latency for smooth motion.
 *
 * Time is tracked in the server's clock domain: we advance a local `renderTime`
 * each frame and gently resync it toward (latestServerTime - INTERP_DELAY) so it
 * neither drifts ahead of received data nor lags arbitrarily far behind.
 */
import {
  INTERP_DELAY_MS,
  type SnapshotMsg,
  type Vec3,
} from "@padel/shared";

export interface InterpState {
  ball: Vec3;
  players: { slot: SnapshotMsg["players"][number]["slot"]; pos: Vec3; yaw: number }[];
}

const HISTORY_MS = 1500;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

export class InterpBuffer {
  private buf: SnapshotMsg[] = [];
  private time = 0;
  private initialized = false;

  /** Server time (ms) of the state currently being rendered. */
  get renderTime(): number {
    return this.time;
  }

  add(s: SnapshotMsg): void {
    this.buf.push(s);
    this.buf.sort((a, b) => a.serverTime - b.serverTime);
    const newest = this.buf[this.buf.length - 1]!.serverTime;
    while (this.buf.length > 2 && this.buf[0]!.serverTime < newest - HISTORY_MS) {
      this.buf.shift();
    }
    if (!this.initialized) {
      this.time = s.serverTime - INTERP_DELAY_MS;
      this.initialized = true;
    }
  }

  update(dtMs: number): void {
    if (!this.initialized || this.buf.length === 0) return;
    this.time += dtMs;
    const target = this.buf[this.buf.length - 1]!.serverTime - INTERP_DELAY_MS;
    // Soft resync: nudge toward the target so we track the server without jumps.
    this.time += (target - this.time) * 0.1;
  }

  /** Interpolated world state at the current render time, or null if unready. */
  sample(): InterpState | null {
    if (this.buf.length === 0) return null;
    if (this.buf.length === 1) return toState(this.buf[0]!);

    // Find the pair [a, b] bracketing renderTime.
    let a = this.buf[0]!;
    let b = this.buf[this.buf.length - 1]!;
    for (let i = 0; i < this.buf.length - 1; i++) {
      const lo = this.buf[i]!;
      const hi = this.buf[i + 1]!;
      if (this.time >= lo.serverTime && this.time <= hi.serverTime) {
        a = lo;
        b = hi;
        break;
      }
    }
    const span = b.serverTime - a.serverTime;
    const t = span > 0 ? clamp01((this.time - a.serverTime) / span) : 0;

    const ball = lerpVec(a.ball.pos, b.ball.pos, t);
    // Interpolate players present in both snapshots; otherwise snap to latest.
    const players: InterpState["players"] = [];
    for (const pb of b.players) {
      const pa = a.players.find((p) => p.slot === pb.slot);
      if (pa) {
        players.push({
          slot: pb.slot,
          pos: lerpVec(pa.pos, pb.pos, t),
          yaw: lerpAngle(pa.yaw, pb.yaw, t),
        });
      } else {
        players.push({ slot: pb.slot, pos: pb.pos, yaw: pb.yaw });
      }
    }
    return { ball, players };
  }
}

function toState(s: SnapshotMsg): InterpState {
  return {
    ball: s.ball.pos,
    players: s.players.map((p) => ({ slot: p.slot, pos: p.pos, yaw: p.yaw })),
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Shortest-path angular interpolation (radians). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
