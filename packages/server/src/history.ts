/**
 * Ring of recent ball states, one per tick, so a swing can be judged against the
 * ball the player was actually looking at (lag compensation). Times are in the
 * room's simulation clock, the same units as snapshot `serverTime`.
 */
import { LAG, type Vec3 } from "@padel/shared";

export interface BallSample {
  time: number;
  pos: Vec3;
  vel: Vec3;
  /** Bumped whenever the ball's flight is changed by fiat (a hit, a serve, a placement). */
  hitSeq: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});

export class BallHistory {
  private samples: BallSample[] = [];

  /** Record one sample (once per tick, in time order); drops those older than LAG.historyMs. */
  push(s: BallSample): void {
    this.samples.push(s);
    const oldest = s.time - LAG.historyMs;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop]!.time < oldest) drop++;
    if (drop > 0) this.samples.splice(0, drop);
  }

  /**
   * The ball at `time`, interpolated between the samples around it; null outside the
   * recorded range. Between two samples it keeps the earlier one's hitSeq, so a time
   * just before a hit still counts as before it.
   */
  at(time: number): BallSample | null {
    const n = this.samples.length;
    if (n === 0 || time < this.samples[0]!.time || time > this.samples[n - 1]!.time) return null;
    for (let i = n - 1; i >= 0; i--) {
      const a = this.samples[i]!;
      if (a.time > time) continue;
      if (a.time === time || i === n - 1) return { ...a, time };
      const b = this.samples[i + 1]!;
      const t = (time - a.time) / (b.time - a.time);
      return { time, pos: lerp3(a.pos, b.pos, t), vel: lerp3(a.vel, b.vel, t), hitSeq: a.hitSeq };
    }
    return null;
  }
}
