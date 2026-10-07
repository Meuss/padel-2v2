/**
 * Client-side prediction for the local player's movement. Inputs are produced
 * on the server's fixed 60 Hz tick and applied here immediately through the
 * shared `stepPlayer`, so the player moves with no network delay. Each snapshot
 * carries the seq of the last input the server applied (`ack`): we restart from
 * the server's position and replay the inputs it has not applied yet. Small
 * differences are hidden by an offset that decays to zero; large ones (serve
 * teleport, ends swap) snap. No DOM or Three.js here, so it is unit tested.
 */
import { TICK_DT, stepPlayer, type Vec2 } from "@padel/shared";

/** Most ticks run in one frame; a longer gap (hidden tab) drops the backlog. */
export const MAX_STEPS_PER_FRAME = 5;
/** Corrections larger than this (metres) snap instead of being smoothed. */
export const SNAP_DISTANCE = 1.5;
/** Exponential decay rate (1/s) of the smoothing offset. */
export const CORRECTION_RATE = 12;
/** Pending inputs kept for replay (~2 s); older ones can no longer matter. */
const MAX_PENDING = 120;

/** Split elapsed frame time (seconds) into whole simulation ticks. */
export function fixedSteps(
  accumulator: number,
  dt: number,
): { steps: number; accumulator: number } {
  let acc = accumulator + dt;
  let steps = Math.floor((acc + 1e-9) / TICK_DT);
  acc = Math.max(0, acc - steps * TICK_DT);
  if (steps > MAX_STEPS_PER_FRAME) {
    steps = MAX_STEPS_PER_FRAME;
    acc = 0;
  }
  return { steps, accumulator: acc };
}

export interface PredictedInput {
  seq: number;
  move: Vec2;
}

export class Predictor {
  private pos: Vec2 | null = null;
  private pending: PredictedInput[] = [];
  private offset: Vec2 = { x: 0, z: 0 };

  /** Apply one tick of local input now and keep it for replay. */
  applyInput(input: PredictedInput, side: -1 | 1, locked: boolean): void {
    if (!this.pos) return; // no authoritative start yet
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    if (!locked) this.pos = stepPlayer(this.pos, input.move, side, TICK_DT);
  }

  /** Restart from the server's position and replay the inputs it has not applied. */
  reconcile(serverPos: Vec2, ack: number | undefined, side: -1 | 1, locked: boolean): void {
    if (ack !== undefined) this.pending = this.pending.filter((p) => p.seq > ack);
    let next: Vec2 = { x: serverPos.x, z: serverPos.z };
    if (!locked) {
      for (const p of this.pending) next = stepPlayer(next, p.move, side, TICK_DT);
    }
    const before = this.pos;
    this.pos = next;
    if (!before) return;
    const dx = before.x - next.x;
    const dz = before.z - next.z;
    if (Math.hypot(dx + this.offset.x, dz + this.offset.z) > SNAP_DISTANCE) {
      this.offset = { x: 0, z: 0 };
    } else {
      this.offset = { x: this.offset.x + dx, z: this.offset.z + dz };
    }
  }

  /** Where to draw the player this frame; the correction offset decays. */
  renderPosition(dtSec: number): Vec2 | null {
    if (!this.pos) return null;
    const k = Math.exp(-dtSec * CORRECTION_RATE);
    this.offset = { x: this.offset.x * k, z: this.offset.z * k };
    return { x: this.pos.x + this.offset.x, z: this.pos.z + this.offset.z };
  }

  /** Forget everything (new connection or seat). */
  reset(): void {
    this.pos = null;
    this.pending = [];
    this.offset = { x: 0, z: 0 };
  }
}
