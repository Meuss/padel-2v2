import { describe, expect, it } from "vitest";
import {
  PLAYER,
  PLAYER_BOUNDS,
  TICK_DT,
  confineToHalf,
  hitVelocity,
  normalizeMove,
  stepPlayer,
  swingConnects,
  type HalfBounds,
} from "@padel/shared";

const BOUNDS: HalfBounds = { halfW: 4.6, halfL: 9.45, netGap: 0.5 };

describe("normalizeMove", () => {
  it("leaves sub-unit vectors unchanged", () => {
    expect(normalizeMove(0, 0)).toEqual({ x: 0, z: 0 });
    expect(normalizeMove(0.5, 0)).toEqual({ x: 0.5, z: 0 });
  });

  it("caps diagonal length to 1 so diagonals aren't faster", () => {
    const m = normalizeMove(1, 1);
    expect(Math.hypot(m.x, m.z)).toBeCloseTo(1, 6);
  });
});

describe("confineToHalf", () => {
  it("keeps a side<0 player on the negative-z half, off the net", () => {
    expect(confineToHalf({ x: 0, z: 0.2 }, -1, BOUNDS).z).toBe(-BOUNDS.netGap);
    expect(confineToHalf({ x: 0, z: -100 }, -1, BOUNDS).z).toBe(-BOUNDS.halfL);
  });

  it("keeps a side>0 player on the positive-z half, off the net", () => {
    expect(confineToHalf({ x: 0, z: -0.2 }, 1, BOUNDS).z).toBe(BOUNDS.netGap);
    expect(confineToHalf({ x: 0, z: 100 }, 1, BOUNDS).z).toBe(BOUNDS.halfL);
  });

  it("clamps x within the side walls", () => {
    expect(confineToHalf({ x: 50, z: -3 }, -1, BOUNDS).x).toBe(BOUNDS.halfW);
    expect(confineToHalf({ x: -50, z: -3 }, -1, BOUNDS).x).toBe(-BOUNDS.halfW);
  });
});

describe("swingConnects", () => {
  const ball = { x: 1, y: 1, z: 1 };
  it("connects when the ball is within reach of the racket", () => {
    expect(swingConnects(1, 1, 1, ball, 0.5)).toBe(true); // ball at racket
    expect(swingConnects(1, 1, 0.2, ball, 1.0)).toBe(true); // 0.8 away
  });
  it("misses when the ball is out of reach", () => {
    expect(swingConnects(1, 1, -2, ball, 1.0)).toBe(false); // 3 away
    expect(swingConnects(5, 5, 5, ball, 1.0)).toBe(false);
  });
});

describe("hitVelocity", () => {
  it("scales horizontal aim by power and applies vertical lift", () => {
    expect(hitVelocity({ x: 0, z: -1 }, 9, 4.5)).toEqual({ x: 0, y: 4.5, z: -9 });
    const diag = hitVelocity({ x: 0.6, z: 0.8 }, 10, 3);
    expect(diag).toEqual({ x: 6, y: 3, z: 8 });
  });
});

describe("stepPlayer", () => {
  it("moves forward toward the net in the player's frame", () => {
    // Side -1 defends z<0, so "forward" is +z.
    const p = stepPlayer({ x: 0, z: -5 }, { x: 0, z: 1 }, -1, TICK_DT);
    expect(p.z).toBeCloseTo(-5 + PLAYER.speed * TICK_DT, 10);
    expect(p.x).toBe(0);
    // Side +1 defends z>0, so "forward" is -z and strafe-right is -x.
    const q = stepPlayer({ x: 0, z: 5 }, { x: 1, z: 1 }, 1, TICK_DT);
    expect(q.z).toBeLessThan(5);
    expect(q.x).toBeGreaterThan(0);
  });

  it("does not move faster on diagonals", () => {
    const d = stepPlayer({ x: 0, z: -5 }, { x: 1, z: 1 }, -1, 0.1);
    expect(Math.hypot(d.x, d.z + 5)).toBeCloseTo(PLAYER.speed * 0.1, 10);
  });

  it("keeps the player inside their half", () => {
    const p = stepPlayer({ x: 0, z: -0.6 }, { x: 0, z: 1 }, -1, 1);
    expect(p.z).toBe(-PLAYER_BOUNDS.netGap);
    const q = stepPlayer({ x: 0, z: -5 }, { x: 0, z: 0 }, 1, TICK_DT); // side just swapped
    expect(q.z).toBe(PLAYER_BOUNDS.netGap);
  });
});
