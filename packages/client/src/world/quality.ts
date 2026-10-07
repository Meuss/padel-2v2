export type Quality = "high" | "low";

const WARMUP_MS = 1500;
const WINDOW_MS = 3000;
/** Median frame time above which "high" drops to "low" (below ~45 fps). */
const DROP_MS = 22;
/** Median frame time under which "low" may climb back to "high" (60 Hz vsync is ~16.7 ms)… */
const RISE_MS = 18;
/** …for this many consecutive windows. */
const RISE_WINDOWS = 2;
/** After this many drops, "low" sticks for the session. */
const MAX_DROPS = 2;
/**
 * Longer frames are stalls (hidden tab, GC, loading), not render cost: ignored entirely.
 * High enough that a machine rendering at 2–4 fps still gets judged.
 */
const STALL_MS = 1000;
/**
 * A window is judged only when its kept frames cover at least this share of its length,
 * so a window mostly spent in a stall is skipped rather than judged on a few frames.
 */
const MIN_COVERAGE = 0.5;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Decide quality from recent frame times (ms). Pure, with hysteresis. */
export class QualityMonitor {
  private q: Quality;
  private windowStart: number;
  private frames: number[] = [];
  /** Sum of `frames`, i.e. the window time they cover. */
  private covered = 0;
  private goodWindows = 0;
  private drops = 0;

  /** `startMs` is the construction time on the same clock as `sample`'s `nowMs`. */
  constructor(initial: Quality, startMs: number = performance.now()) {
    this.q = initial;
    this.windowStart = startMs + WARMUP_MS;
  }

  /** Feed one frame time; returns the quality to use now (may change at most once per 3 s window). */
  sample(frameMs: number, nowMs: number): Quality {
    if (nowMs < this.windowStart) return this.q; // warm-up
    if (frameMs <= STALL_MS) {
      this.frames.push(frameMs);
      this.covered += frameMs;
    }
    const elapsed = nowMs - this.windowStart;
    if (elapsed < WINDOW_MS) return this.q;

    // The window is complete: judge it once (if its frames cover enough of it), then start the next one.
    const frames = this.frames;
    const covered = this.covered;
    this.resetWindow(nowMs);
    if (frames.length === 0 || covered < elapsed * MIN_COVERAGE) return this.q;
    const m = median(frames);
    if (this.q === "high") {
      if (m > DROP_MS) {
        this.q = "low";
        this.drops++;
        this.goodWindows = 0;
      }
    } else if (this.drops < MAX_DROPS) {
      this.goodWindows = m < RISE_MS ? this.goodWindows + 1 : 0;
      if (this.goodWindows >= RISE_WINDOWS) {
        this.q = "high";
        this.goodWindows = 0;
      }
    }
    return this.q;
  }

  /** Discard the partial window and start a fresh one at `nowMs` (e.g. when a hidden tab becomes visible). */
  resetWindow(nowMs: number): void {
    this.frames = [];
    this.covered = 0;
    // Never cut the initial warm-up short.
    this.windowStart = Math.max(this.windowStart, nowMs);
  }
}
