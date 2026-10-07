import { describe, expect, it } from "vitest";
import {
  TOSS,
  judgeTiming,
  resolveKind,
  serveTarget,
  serveTiming,
  clearanceLift,
  shotVelocity,
  timeToClosest,
  tossApex,
  tossOffset,
} from "../src/index.js";
import { COURT, GRAVITY, SHOT } from "../src/constants.js";

const box = { xMin: 0.4, xMax: 4.6, zNear: 0.5, zFar: 6.95, side: 1 as const };

describe("timeToClosest", () => {
  it("is positive while approaching", () => {
    expect(timeToClosest({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -10 })).toBeCloseTo(0.2);
  });
  it("is negative once past", () => {
    expect(timeToClosest({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -10 })).toBeCloseTo(-0.1);
  });
  it("is 0 for a stationary ball", () => {
    expect(timeToClosest({ x: 1, y: 1, z: 1 }, { x: 0, y: 0, z: 0 })).toBe(0);
  });
});

describe("judgeTiming", () => {
  it("classifies", () => {
    expect(judgeTiming(0.05)).toBe("perfect");
    expect(judgeTiming(0.2)).toBe("early");
    expect(judgeTiming(-0.2)).toBe("late");
  });
  it("treats +-0.08 as perfect", () => {
    expect(judgeTiming(0.08)).toBe("perfect");
    expect(judgeTiming(-0.08)).toBe("perfect");
  });
});

describe("resolveKind", () => {
  it("smashes high balls only", () => {
    expect(resolveKind("lob", 2.3)).toBe("smash");
    expect(resolveKind("drive", 1.0)).toBe("drive");
  });
});

describe("shotVelocity", () => {
  const aim = { x: 0, z: 1 };
  it("perfect drive is unrotated", () => {
    const v = shotVelocity("drive", "perfect", aim);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(3.6);
    expect(v.z).toBeCloseTo(12.5);
  });
  it("early is slower and rotated to x < 0", () => {
    const v = shotVelocity("drive", "early", aim);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(12.5 * 0.82);
    expect(v.x).toBeLessThan(0);
    expect((Math.atan2(v.x, v.z) * 180) / Math.PI).toBeCloseTo(-9);
    expect(v.y).toBeCloseTo(3.6 * 0.9);
  });
  it("late rotates to x > 0", () => {
    expect(shotVelocity("drive", "late", aim).x).toBeGreaterThan(0);
  });
  it("smash goes down", () => {
    expect(shotVelocity("smash", "perfect", aim).y).toBeLessThan(0);
  });
  it("a perfect lob from 1 m lands 12-16 m away", () => {
    const v = shotVelocity("lob", "perfect", aim);
    const t = (v.y + Math.sqrt(v.y * v.y + 2 * 9.81 * 1.0)) / 9.81;
    const dist = v.z * t;
    expect(dist).toBeGreaterThan(12);
    expect(dist).toBeLessThan(16);
  });
});

describe("toss", () => {
  it("has the expected kinematics", () => {
    expect(tossOffset(0)).toBe(0);
    expect(tossApex()).toBeCloseTo(0.326, 3);
    expect(tossOffset(tossApex())).toBeCloseTo(0.522, 3);
  });
  it("judges serve timing around the apex", () => {
    expect(serveTiming(tossApex())).toBe("perfect");
    expect(serveTiming(tossApex() + 0.2)).toBe("late");
    expect(serveTiming(tossApex() - 0.2)).toBe("early");
  });
});

describe("serveTarget", () => {
  const aim = { x: 10, z: 10 };
  it("clamps a perfect serve 0.4 m inside the box", () => {
    const p = serveTarget(aim, box, tossApex());
    expect(p.x).toBeCloseTo(4.2);
    expect(p.z).toBeCloseTo(6.55);
  });
  it("late serves go long", () => {
    // 0.25 s late is 0.15 s past the window: the deepest aim (6.55) plus 0.15 s of drift.
    expect(serveTarget(aim, box, tossApex() + 0.25).z).toBeCloseTo(6.55 + 0.15 * TOSS.depthPerSecond);
  });
  it("early serves land short", () => {
    const short = 6.55 - 0.15 * TOSS.depthPerSecond;
    expect(serveTarget(aim, box, tossApex() - 0.25).z).toBeCloseTo(short);
    expect(serveTarget(aim, box, tossApex() - 0.32).z).toBeLessThan(short);
  });
  it("carries the side sign", () => {
    expect(serveTarget(aim, { ...box, side: -1 }, tossApex()).z).toBeCloseTo(-6.55);
  });
});

describe("net clearance", () => {
  const aim = { x: 0, z: 1 };
  /** Height (no drag) of a ball launched from y with velocity v when it has travelled dist along z. */
  const heightAt = (y: number, v: { y: number; z: number }, dist: number) => {
    const t = dist / v.z;
    return y + v.y * t - 0.5 * GRAVITY * t * t;
  };

  it("clearanceLift passes the net plane at netHeight + netClearance", () => {
    const vy = clearanceLift("drive", 0.4, 9, 12.5);
    expect(heightAt(0.4, { y: vy, z: 12.5 }, 9)).toBeCloseTo(COURT.netHeight + SHOT.netClearance);
  });

  it("a perfect Drive from 0.4 m, 9 m back, clears the net", () => {
    const v = shotVelocity("drive", "perfect", aim, { y: 0.4, distToNet: 9 });
    expect(v.y).toBeGreaterThan(SHOT.drive.lift);
    expect(heightAt(0.4, v, 9)).toBeGreaterThan(COURT.netHeight + SHOT.netClearance - 1e-6);
  });

  it("an early Drive from the same spot gets 0.9x that lift", () => {
    const perfect = shotVelocity("drive", "perfect", aim, { y: 0.4, distToNet: 9 });
    const early = shotVelocity("drive", "early", aim, { y: 0.4, distToNet: 9 });
    expect(early.y).toBeCloseTo(perfect.y * SHOT.offTiming.lift);
  });

  it("from 1.2 m, 3 m back, the table lift is already enough", () => {
    expect(shotVelocity("drive", "perfect", aim, { y: 1.2, distToNet: 3 }).y).toBeCloseTo(SHOT.drive.lift);
    expect(shotVelocity("lob", "perfect", aim, { y: 1.2, distToNet: 3 }).y).toBeCloseTo(SHOT.lob.lift);
  });

  it("a Smash ignores the contact", () => {
    expect(shotVelocity("smash", "perfect", aim, { y: 0.4, distToNet: 9 }).y).toBeCloseTo(SHOT.smash.lift);
  });
});
