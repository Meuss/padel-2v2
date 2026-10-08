import { describe, expect, it } from "vitest";
import {
  TOSS,
  dragKeep,
  judgeTiming,
  lobPower,
  resolveKind,
  serveTarget,
  serveTiming,
  clearanceLift,
  shotVelocity,
  timeToClosest,
  tossApex,
  tossOffset,
} from "../src/index.js";
import { BALL, COURT, GRAVITY, SHOT } from "../src/constants.js";

const box = { xMin: 0.4, xMax: 4.6, zNear: 0.5, zFar: 6.95, side: 1 as const };

/** Seconds for a ball launched at `speed` to cover `dist` horizontally under the drag allowance (bisection). */
function timeToTravel(speed: number, dist: number): number {
  let lo = 0;
  let hi = 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (speed * mid * dragKeep(mid) < dist) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Height of a ball launched from y with v once it has travelled dist along z, drag allowance on the horizontal. */
function heightWithDrag(y: number, v: { y: number; z: number }, dist: number): number {
  const t = timeToTravel(v.z, dist);
  return y + v.y * t - 0.5 * GRAVITY * t * t;
}

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
  it("smashes high balls near the net only", () => {
    expect(resolveKind("lob", 2.3, 3)).toBe("smash");
    expect(resolveKind("drive", 1.0, 3)).toBe("drive");
    expect(resolveKind("drive", 2.3, 8)).toBe("drive");
  });
  it("is not a smash exactly at smashHeight (the comparison is strict)", () => {
    expect(resolveKind("drive", SHOT.smashHeight, 1)).toBe("drive");
    expect(resolveKind("drive", SHOT.smashHeight + 1e-6, 1)).toBe("smash");
  });
  it("smashes up to and including smashMaxDistM from the net", () => {
    expect(resolveKind("lob", 2.5, SHOT.smashMaxDistM)).toBe("smash");
    expect(resolveKind("lob", 2.5, SHOT.smashMaxDistM + 1e-6)).toBe("lob");
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
  it("without a contact, a perfect lob from 1 m uses the table power and lands 12-16 m away", () => {
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
  it("treats the edges of the 0.1 s window as perfect, just beyond as early or late", () => {
    const w = TOSS.perfectWindowS;
    expect(w).toBe(0.1);
    // A hair inside the window on each side (floating-point safe), then a hair outside.
    expect(serveTiming(tossApex() + w - 1e-9)).toBe("perfect");
    expect(serveTiming(tossApex() - w + 1e-9)).toBe("perfect");
    expect(serveTiming(tossApex() + w + 1e-6)).toBe("late");
    expect(serveTiming(tossApex() - w - 1e-6)).toBe("early");
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

  /** Height when it has travelled dist along z, under exact linear drag (dv/dt = -c·v - g·ŷ) on both axes. */
  const heightExact = (y: number, v: { y: number; z: number }, dist: number) => {
    const c = SHOT.dragAllowance;
    const t = -Math.log(1 - (c * dist) / v.z) / c;
    const e = (1 - Math.exp(-c * t)) / c;
    return y + (v.y + GRAVITY / c) * e - (GRAVITY * t) / c;
  };

  it("clearanceLift passes the net plane at netHeight + netClearance under exact linear drag", () => {
    for (const [y, dist, speed] of [
      [0.4, 9, 12.5],
      [0.2, 9.5, 8.5],
      [1.1, 4, 10],
    ] as const) {
      const vy = clearanceLift(y, dist, speed);
      expect(heightExact(y, { y: vy, z: speed }, dist)).toBeCloseTo(COURT.netHeight + SHOT.netClearance, 6);
    }
    // Drag slows the ball, so it needs more lift than drag-free ballistics say.
    const vy = clearanceLift(0.4, 9, 12.5);
    expect(heightAt(0.4, { y: vy, z: 12.5 }, 9)).toBeGreaterThan(COURT.netHeight + SHOT.netClearance);
  });

  it("clearanceLift stays finite when the ball could never reach the net (capped flight time)", () => {
    const vy = clearanceLift(0.4, 9, 1);
    expect(Number.isFinite(vy)).toBe(true);
    expect(vy).toBeGreaterThan(0);
  });

  it("clearanceLift takes an optional clearance", () => {
    expect(clearanceLift(0.4, 9, 12.5, 0)).toBeLessThan(clearanceLift(0.4, 9, 12.5));
  });

  it("a cross-court Drive uses its speed toward the net, keeping its margin", () => {
    const cross = { x: Math.sin(Math.PI / 4), z: Math.cos(Math.PI / 4) };
    const v = shotVelocity("drive", "perfect", cross, { y: 0.4, distToNet: 9 });
    expect(v.y).toBeCloseTo(clearanceLift(0.4, 9, cross.z * SHOT.drive.power));
    expect(v.y).toBeGreaterThan(shotVelocity("drive", "perfect", aim, { y: 0.4, distToNet: 9 }).y);
    expect(heightAt(0.4, v, 9)).toBeGreaterThan(COURT.netHeight + SHOT.netClearance);
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

  it("a Smash keeps its table lift when that already clears the net", () => {
    expect(shotVelocity("smash", "perfect", aim, { y: 2.6, distToNet: 2 }).y).toBeCloseTo(SHOT.smash.lift);
  });

  it("a Smash from smashMaxDistM at just above smashHeight is lifted to clear the net plus its margin", () => {
    for (const timing of ["perfect", "early", "late"] as const) {
      const contact = { y: SHOT.smashHeight + 0.01, distToNet: SHOT.smashMaxDistM };
      const v = shotVelocity("smash", timing, aim, contact);
      expect(v.y).toBeGreaterThan(SHOT.smash.lift * (timing === "perfect" ? 1 : SHOT.offTiming.lift));
      expect(heightAt(contact.y, v, contact.distToNet)).toBeGreaterThan(COURT.netHeight + SHOT.smashNetMargin);
    }
  });
});

describe("off-timing", () => {
  const aim = { x: 0, z: 1 };
  it("an early or late Smash is slower and rotated, and still goes down near the net", () => {
    const perfect = shotVelocity("smash", "perfect", aim);
    for (const timing of ["early", "late"] as const) {
      const v = shotVelocity("smash", timing, aim, { y: 2.6, distToNet: 2 });
      expect(Math.hypot(v.x, v.z)).toBeCloseTo(Math.hypot(perfect.x, perfect.z) * SHOT.offTiming.power);
      expect(Math.sign(v.x)).toBe(timing === "early" ? -1 : 1);
      expect(v.y).toBeCloseTo(SHOT.smash.lift * SHOT.offTiming.lift);
    }
  });
  it("an early or late Lob keeps the Lob lift and is rotated", () => {
    for (const timing of ["early", "late"] as const) {
      const v = shotVelocity("lob", timing, aim, { y: 0.5, distToNet: 9.5 });
      expect(v.y).toBeCloseTo(SHOT.lob.lift);
      expect(Math.sign(v.x)).toBe(timing === "early" ? -1 : 1);
    }
  });
});

describe("distance-aware Lob", () => {
  const aim = { x: 0, z: 1 };
  /** Where a ball launched from y with v lands, along z, by drag-free vertical flight plus the drag allowance. */
  const landingZ = (y: number, v: { y: number; z: number }) => {
    const t = (v.y + Math.sqrt(v.y * v.y + 2 * GRAVITY * (y - BALL.radius))) / GRAVITY;
    return v.z * t * dragKeep(t);
  };

  it("a perfect Lob from 9.5 m back at y 0.5 lands 6.5-8.5 m past the net", () => {
    const v = shotVelocity("lob", "perfect", aim, { y: 0.5, distToNet: 9.5 });
    const past = landingZ(0.5, v) - 9.5;
    expect(past).toBeGreaterThan(6.5);
    expect(past).toBeLessThan(8.5);
    expect(past).toBeCloseTo(SHOT.lobDepthPastNet);
  });

  it("a Lob from near the net is softer than one from the back", () => {
    const near = shotVelocity("lob", "perfect", aim, { y: 1, distToNet: 2 });
    const deep = shotVelocity("lob", "perfect", aim, { y: 1, distToNet: 9 });
    expect(near.z).toBeLessThan(deep.z);
    expect(landingZ(1, near) - 2).toBeCloseTo(SHOT.lobDepthPastNet);
  });

  it("early lands short and late lands long, but both clear the net into the opponents' half", () => {
    const contact = { y: 0.5, distToNet: 9.5 };
    const half = COURT.length / 2;
    const err = SHOT.offTiming.lobDepthErrorM;
    const at = (timing: "early" | "late") => {
      const v = shotVelocity("lob", timing, aim, contact);
      expect(heightWithDrag(contact.y, v, contact.distToNet)).toBeGreaterThan(COURT.netHeight + SHOT.netClearance);
      return landingZ(contact.y, v) - contact.distToNet;
    };
    const early = at("early");
    const late = at("late");
    expect(early).toBeCloseTo(SHOT.lobDepthPastNet - err);
    expect(late).toBeCloseTo(SHOT.lobDepthPastNet + err);
    for (const past of [early, late]) {
      expect(past).toBeGreaterThan(0);
      expect(past).toBeLessThan(half);
    }
  });

  it("lobPower clamps to [minPower, maxPower]", () => {
    expect(lobPower(3, 0.1, aim, 0)).toBe(SHOT.lob.minPower);
    expect(lobPower(0.1, 10, { x: 1, z: 0 }, 10)).toBe(SHOT.lob.maxPower);
  });
});
