import { describe, expect, it } from "vitest";
import { LAG, TICK_MS } from "@padel/shared";
import { BallHistory, type BallSample } from "../src/history.js";

const sample = (time: number, x: number, hitSeq = 0): BallSample => ({
  time,
  pos: { x, y: 1, z: 0 },
  vel: { x: 10, y: 0, z: 0 },
  hitSeq,
});

describe("BallHistory", () => {
  it("interpolates linearly between the bracketing samples", () => {
    const h = new BallHistory();
    h.push(sample(100, 0));
    h.push(sample(120, 2));
    const s = h.at(105)!;
    expect(s.time).toBe(105);
    expect(s.pos.x).toBeCloseTo(0.5);
    expect(s.pos.y).toBeCloseTo(1);
    expect(s.vel.x).toBeCloseTo(10);
    expect(h.at(120)!.pos.x).toBeCloseTo(2);
    expect(h.at(100)!.pos.x).toBeCloseTo(0);
  });

  it("returns null outside the recorded range, or when empty", () => {
    const h = new BallHistory();
    expect(h.at(0)).toBeNull();
    h.push(sample(100, 0));
    h.push(sample(120, 2));
    expect(h.at(99)).toBeNull();
    expect(h.at(121)).toBeNull();
  });

  it("between a hit and the sample before it, keeps the earlier sample's hitSeq", () => {
    const h = new BallHistory();
    h.push(sample(100, 0, 3));
    h.push(sample(120, 2, 4));
    expect(h.at(110)!.hitSeq).toBe(3);
    expect(h.at(120)!.hitSeq).toBe(4);
  });

  it(`drops samples older than ${LAG.historyMs} ms behind the newest`, () => {
    const h = new BallHistory();
    for (let i = 0; i <= 120; i++) h.push(sample(i * TICK_MS, i));
    const newest = 120 * TICK_MS;
    expect(h.at(newest - LAG.historyMs - TICK_MS)).toBeNull();
    expect(h.at(newest - LAG.historyMs + TICK_MS)).not.toBeNull();
    expect(h.at(newest)!.pos.x).toBeCloseTo(120);
  });
});
