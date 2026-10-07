/**
 * Plays the recording back: the pose (ball and players) at a clip time, interpolated between
 * the recorded frames that bracket it, and each recorded frame's shots and contacts once the
 * clip reaches them. Called every frame while a replay is on screen, so it allocates nothing:
 * the pose is one reused object.
 */
import type { ContactEvent, ShotEvent, Slot, Vec3 } from "@padel/shared";
import type { RecordedFrame, ReplayRecorder } from "./recorder.js";

export interface ReplayPose {
  ball: Vec3;
  /** The first `count` entries are valid. */
  players: { slot: Slot; pos: Vec3; yaw: number }[];
  count: number;
}

export type ReplayEventHandler = (serverTime: number, shots: readonly ShotEvent[], contacts: readonly ContactEvent[]) => void;

const MAX_PLAYERS = 4;

export class ReplayPlayer {
  readonly pose: ReplayPose = {
    ball: { x: 0, y: 0, z: 0 },
    players: Array.from({ length: MAX_PLAYERS }, () => ({ slot: "A1" as Slot, pos: { x: 0, y: 0, z: 0 }, yaw: 0 })),
    count: 0,
  };
  /** Events at or before this server time were already handed over. */
  private doneMs = -Infinity;

  constructor(private readonly recorder: ReplayRecorder) {}

  /** Start a clip at `fromMs`: events from there on play. */
  start(fromMs: number): void {
    this.doneMs = fromMs - 1e-6;
  }

  /**
   * Pose the clip at server time `clipMs` and hand `onEvents` every recorded event since the
   * last call. False when nothing is recorded there (the pose is then left as it was).
   */
  advance(clipMs: number, onEvents: ReplayEventHandler): boolean {
    const frames = this.recorder.frames;
    if (frames.length === 0) return false;
    for (let i = firstAfter(frames, this.doneMs); i < frames.length; i++) {
      const f = frames[i]!;
      if (f.serverTime > clipMs) break;
      if (f.shots.length > 0 || f.contacts.length > 0) onEvents(f.serverTime, f.shots, f.contacts);
    }
    if (clipMs > this.doneMs) this.doneMs = clipMs;

    const hi = Math.min(firstAfter(frames, clipMs), frames.length - 1);
    const lo = Math.max(0, hi - 1);
    const a = frames[lo]!;
    const b = frames[hi]!;
    const span = b.serverTime - a.serverTime;
    const t = span > 0 ? Math.min(1, Math.max(0, (clipMs - a.serverTime) / span)) : 1;
    lerpInto(this.pose.ball, a.ball, b.ball, t);
    let n = 0;
    for (const pb of b.players) {
      if (n >= MAX_PLAYERS) break;
      const out = this.pose.players[n++]!;
      out.slot = pb.slot;
      let pa = pb;
      for (const p of a.players) if (p.slot === pb.slot) pa = p;
      lerpInto(out.pos, pa.pos, pb.pos, t);
      out.yaw = lerpAngle(pa.yaw, pb.yaw, t);
    }
    this.pose.count = n;
    return true;
  }
}

/** Index of the first frame later than `ms` (frames.length if none). */
function firstAfter(frames: readonly RecordedFrame[], ms: number): number {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.serverTime <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function lerpInto(out: Vec3, a: Vec3, b: Vec3, t: number): void {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
}

/** Shortest-path angular interpolation (radians). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
