/**
 * Snapshot events (shots, ball contacts) arrive about INTERP_DELAY_MS before the
 * interpolated ball reaches them. This queue holds them, keyed by their snapshot's
 * server time, and releases them when the render time catches up, so hit feedback,
 * swings and sounds line up with the ball on screen.
 */
import type { ContactEvent, ShotEvent } from "@padel/shared";

/** Receives one snapshot's events; `lateMs` is how far the render time is past `serverTime`. */
export type EventHandler = (
  serverTime: number,
  shots: readonly ShotEvent[],
  contacts: readonly ContactEvent[],
  lateMs: number,
) => void;

/**
 * The drain limit for visual feedback: after a hidden tab the frame loop jumps ahead, and
 * replaying seconds of effects in one frame would be a burst of noise. Generous, because
 * headless rendering (the shoot tool) runs at a few frames per second.
 */
export const EVENT_STALE_MS = 1000;

/** True when an event at `serverTime` fires more than `maxLateMs` after it, at `renderTime`. */
export function isStale(serverTime: number, renderTime: number, maxLateMs: number): boolean {
  return renderTime - serverTime > maxLateMs;
}
/** Never hold more than this many snapshots' worth (a hidden tab keeps receiving them). */
const MAX_PENDING = 256;

interface Pending {
  serverTime: number;
  shots: readonly ShotEvent[];
  contacts: readonly ContactEvent[];
}

export class EventQueue {
  /** Sorted by serverTime, oldest first. */
  private pending: Pending[] = [];

  get size(): number {
    return this.pending.length;
  }

  /** Queue a snapshot's events (snapshots without any are skipped). */
  schedule(serverTime: number, shots: readonly ShotEvent[], contacts: readonly ContactEvent[]): void {
    if (shots.length === 0 && contacts.length === 0) return;
    const p: Pending = { serverTime, shots, contacts };
    // Snapshots almost always arrive in order: insert from the back.
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1]!.serverTime > serverTime) i--;
    this.pending.splice(i, 0, p);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  /**
   * Hand every event due at `renderTime` to `handler`, oldest first, and forget it.
   * Events more than `maxLateMs` late are forgotten without being handled.
   */
  drain(renderTime: number, handler: EventHandler, maxLateMs = Infinity): void {
    let n = 0;
    while (n < this.pending.length && this.pending[n]!.serverTime <= renderTime) {
      const p = this.pending[n]!;
      if (!isStale(p.serverTime, renderTime, maxLateMs)) {
        handler(p.serverTime, p.shots, p.contacts, renderTime - p.serverTime);
      }
      n++;
    }
    if (n > 0) this.pending.splice(0, n);
  }

  /** Drop everything pending (on a new welcome: a restarted server's clock starts elsewhere). */
  clear(): void {
    this.pending.length = 0;
  }
}
