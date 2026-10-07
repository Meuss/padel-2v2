export type Quality = "high" | "low";

const WARMUP_MS = 1500;
const WINDOW_MS = 3000;
/** Median frame time above which "high" drops to "low" (below ~45 fps). */
const DROP_MS = 22;
/** Median frame time under which "low" may climb back to "high"… */
const RISE_MS = 12;
/** …for this many consecutive windows. */
const RISE_WINDOWS = 2;
/** After this many drops, "low" sticks for the session. */
const MAX_DROPS = 2;

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
    this.frames.push(frameMs);
    if (nowMs - this.windowStart < WINDOW_MS) return this.q;

    // The window is complete: judge it once, then start the next one.
    const m = median(this.frames);
    this.frames = [];
    this.windowStart = nowMs;
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
}
