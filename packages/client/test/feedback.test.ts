import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ContactEvent, ShotEvent } from "@padel/shared";
import { EventQueue } from "../src/events.js";
import { Feedback, timingArcColor, trailOpacity } from "../src/world/feedback.js";
import { PALETTE } from "../src/world/palette.js";

const shot = (kind: ShotEvent["kind"], timing: ShotEvent["timing"] = "perfect"): ShotEvent => ({
  slot: "A1",
  kind,
  timing,
  pos: { x: 0, y: 1, z: -5 },
});

describe("timingArcColor", () => {
  it("is green for perfect and amber for early and late", () => {
    expect(timingArcColor("perfect")).toBe(PALETTE.timingPerfect);
    expect(timingArcColor("early")).toBe(PALETTE.timingEarly);
    expect(timingArcColor("late")).toBe(PALETTE.timingLate);
    expect(PALETTE.timingEarly).toBe(PALETTE.timingLate);
    expect(PALETTE.timingPerfect).not.toBe(PALETTE.timingEarly);
  });
});

describe("trailOpacity", () => {
  it("fades from 1 to 0 over 0.35 s", () => {
    expect(trailOpacity(0, "drive")).toBe(1);
    expect(trailOpacity(0.175, "drive")).toBeCloseTo(0.5);
    expect(trailOpacity(0.35, "drive")).toBe(0);
    expect(trailOpacity(1, "lob")).toBe(0);
  });

  it("lasts 0.5 s after a smash", () => {
    expect(trailOpacity(0.35, "smash")).toBeGreaterThan(0);
    expect(trailOpacity(0.25, "smash")).toBeCloseTo(0.5);
    expect(trailOpacity(0.5, "smash")).toBe(0);
  });

  it("clamps negative ages to full opacity", () => {
    expect(trailOpacity(-0.1, "drive")).toBe(1);
  });
});

describe("Feedback", () => {
  it("constructs without a DOM and has no shake at rest", () => {
    const f = new Feedback(new THREE.Scene(), "high");
    expect(f.update(1 / 60).shake).toBe(0);
  });

  it("shakes 0.06 m on a smash, decaying to zero over 0.25 s", () => {
    const f = new Feedback(new THREE.Scene(), "high");
    f.shot(shot("smash"), { x: 0, z: -5 });
    const first = f.update(0).shake;
    expect(first).toBeCloseTo(0.06);
    const mid = f.update(0.1).shake;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(first);
    expect(f.update(0.1).shake).toBeLessThan(mid);
    expect(f.update(0.06).shake).toBe(0);
    expect(f.update(1).shake).toBe(0);
  });

  it("does not shake for a drive, lob or serve", () => {
    const f = new Feedback(new THREE.Scene(), "low");
    f.shot(shot("drive", "early"), { x: 0, z: -5 });
    f.shot(shot("lob", "late"), { x: 0, z: -5 });
    f.shot(shot("serve"), { x: 0, z: -5 });
    expect(f.update(0).shake).toBe(0);
  });

  it("adds a bounded number of objects to the scene however many events arrive", () => {
    const scene = new THREE.Scene();
    const f = new Feedback(scene, "high");
    const count = () => {
      let n = 0;
      scene.traverse(() => n++);
      return n;
    };
    const before = count();
    const floor: ContactEvent = { surface: "floor", pos: { x: 1, y: 0, z: 2 }, speed: 10 };
    const glass: ContactEvent = { surface: "glass", pos: { x: 1, y: 1.5, z: 10 }, speed: 10 };
    for (let i = 0; i < 50; i++) {
      f.shot(shot("smash"), { x: 0, z: -5 });
      f.contact(floor);
      f.contact(glass);
      f.setBall(i * 0.1, 1, 0);
      f.update(1 / 60);
    }
    expect(count()).toBe(before);
  });
});

describe("EventQueue", () => {
  const contact: ContactEvent = { surface: "floor", pos: { x: 0, y: 0, z: 0 }, speed: 5 };

  it("fires events once the render time reaches their server time, in order", () => {
    const q = new EventQueue();
    const fired: number[] = [];
    const handler = (serverTime: number) => fired.push(serverTime);
    q.schedule(1100, [shot("drive")], []);
    q.schedule(1000, [], [contact]);
    q.drain(999, handler);
    expect(fired).toEqual([]);
    q.drain(1000, handler);
    expect(fired).toEqual([1000]);
    q.drain(2000, handler);
    expect(fired).toEqual([1000, 1100]);
    q.drain(3000, handler);
    expect(fired).toEqual([1000, 1100]);
  });

  it("passes the events and how late they fire", () => {
    const q = new EventQueue();
    const s = shot("lob");
    q.schedule(500, [s], [contact]);
    let got: { shots: readonly ShotEvent[]; contacts: readonly ContactEvent[]; lateMs: number } | null = null;
    q.drain(530, (_t, shots, contacts, lateMs) => (got = { shots, contacts, lateMs }));
    expect(got).toEqual({ shots: [s], contacts: [contact], lateMs: 30 });
  });

  it("discards events later than maxLateMs without handling them", () => {
    const q = new EventQueue();
    q.schedule(1000, [shot("drive")], []);
    q.schedule(1800, [], [contact]);
    q.schedule(1950, [shot("lob")], []);
    const fired: number[] = [];
    q.drain(2000, (t) => fired.push(t), 200);
    expect(fired).toEqual([1800, 1950]); // 1000 was 1000 ms late: dropped
    expect(q.size).toBe(0);
    q.schedule(3000, [shot("smash")], []);
    q.drain(3200, (t) => fired.push(t), 200); // exactly at the limit still fires
    expect(fired).toEqual([1800, 1950, 3000]);
  });

  it("has no lateness limit unless one is given", () => {
    const q = new EventQueue();
    q.schedule(0, [shot("drive")], []);
    let n = 0;
    q.drain(1e9, () => n++);
    expect(n).toBe(1);
  });

  it("ignores snapshots without events, and clear() drops everything pending", () => {
    const q = new EventQueue();
    q.schedule(100, [], []);
    expect(q.size).toBe(0);
    q.schedule(200, [shot("drive")], []);
    expect(q.size).toBe(1);
    q.clear();
    let n = 0;
    q.drain(10_000, () => n++);
    expect(n).toBe(0);
  });
});
