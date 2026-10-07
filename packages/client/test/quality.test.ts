import { describe, expect, it } from "vitest";
import { QualityMonitor, type Quality } from "../src/world/quality.js";

/** Feed constant `frameMs` frames from `fromMs` until `toMs`; returns the last answer and the end time. */
function run(m: QualityMonitor, frameMs: number, fromMs: number, toMs: number): { q: Quality; t: number } {
  let t = fromMs;
  let q = m.sample(frameMs, t);
  while (t < toMs) {
    t += frameMs;
    q = m.sample(frameMs, t);
  }
  return { q, t };
}

describe("QualityMonitor", () => {
  it("ignores the 1500 ms warm-up", () => {
    const m = new QualityMonitor("high", 0);
    // Terrible frames, but all inside the warm-up: nothing to judge yet.
    expect(run(m, 100, 0, 1499).q).toBe("high");
  });

  it("drops to low after one window of 25 ms frames", () => {
    const m = new QualityMonitor("high", 0);
    expect(run(m, 25, 0, 4400).q).toBe("high"); // warm-up + not yet a full window
    expect(run(m, 25, 4400, 4600).q).toBe("low");
  });

  it("returns to high only after two windows of 17 ms (60 Hz vsync) frames", () => {
    const m = new QualityMonitor("low", 0);
    expect(run(m, 17, 0, 4600).q).toBe("low"); // one good window
    expect(run(m, 17, 4600, 7400).q).toBe("low");
    expect(run(m, 17, 7400, 7700).q).toBe("high"); // the second good window
  });

  it("stays low on 20 ms frames (not under the 18 ms recovery threshold)", () => {
    const m = new QualityMonitor("low", 0);
    expect(run(m, 20, 0, 20000).q).toBe("low");
  });

  it("does not drop when a hidden tab returns (3 frames plus one 3000 ms frame)", () => {
    const m = new QualityMonitor("high", 0);
    let t = 2000;
    // Frames are often slow just before the tab hides; old median of these 4 is 32 ms.
    for (const ms of [16, 24, 40]) m.sample(ms, (t += ms));
    t += 3000;
    expect(m.sample(3000, t)).toBe("high"); // closes an under-filled window: skipped
    expect(run(m, 16, t, t + 10000).q).toBe("high");
  });

  it("ignores a 3000 ms frame among normal 10 ms frames", () => {
    const m = new QualityMonitor("low", 0);
    let t = run(m, 10, 0, 3000).t;
    t += 3000;
    m.sample(3000, t); // a stall: not counted
    // The windows around the stall stay good, so two of them still bring "high" back.
    expect(run(m, 10, t, t + 6100).q).toBe("high");
  });

  it("returns to high only after two windows of 10 ms frames", () => {
    const m = new QualityMonitor("low", 0);
    expect(run(m, 10, 0, 4600).q).toBe("low"); // one good window
    expect(run(m, 10, 4600, 7400).q).toBe("low");
    expect(run(m, 10, 7400, 7600).q).toBe("high"); // the second good window
  });

  it("ends pinned at low after the second drop", () => {
    const m = new QualityMonitor("high", 0);
    let t = 0;
    const step = (frameMs: number, ms: number) => {
      const r = run(m, frameMs, t, t + ms);
      t = r.t;
      return r.q;
    };
    expect(step(25, 4600)).toBe("low"); // drop 1
    expect(step(10, 6000)).toBe("high"); // two good windows
    expect(step(25, 3000)).toBe("low"); // drop 2
    expect(step(5, 30000)).toBe("low"); // never climbs back
  });

  it("does not drop for a single 200 ms spike inside good frames", () => {
    const m = new QualityMonitor("high", 0);
    let q = run(m, 16, 0, 3000).q;
    q = m.sample(200, 3200);
    q = run(m, 16, 3200, 10000).q;
    expect(q).toBe("high");
  });

  it("switches at most once per window", () => {
    const m = new QualityMonitor("high", 0);
    const changes: number[] = [];
    let prev: Quality = "high";
    let t = 0;
    // Alternate wildly every frame: whatever happens, never two switches in one window.
    for (let i = 0; t < 20000; i++) {
      const ms = i % 2 ? 40 : 5;
      t += ms;
      const q = m.sample(ms, t);
      if (q !== prev) changes.push(t);
      prev = q;
    }
    for (let i = 1; i < changes.length; i++) expect(changes[i]! - changes[i - 1]!).toBeGreaterThanOrEqual(3000);
  });
});
