import { describe, expect, it } from "vitest";
import {
  BALL,
  CAGE,
  CAGE_GATES,
  COURT,
  cageTopAt,
  leftCage,
  netHeightAt,
  surfaceAt,
  type CageSegment,
} from "@padel/shared";

const HALF_W = COURT.width / 2;
const HALF_L = COURT.length / 2;

/** Every wall of the perimeter, with the span of its own coordinate (x for back walls, z for sides). */
const WALLS = [
  { key: "back-1", lo: -HALF_W, hi: HALF_W, match: (s: CageSegment) => s.side === "back" && s.end === -1 },
  { key: "back+1", lo: -HALF_W, hi: HALF_W, match: (s: CageSegment) => s.side === "back" && s.end === 1 },
  { key: "left", lo: -HALF_L, hi: HALF_L, match: (s: CageSegment) => s.side === "left" },
  { key: "right", lo: -HALF_L, hi: HALF_L, match: (s: CageSegment) => s.side === "right" },
];
const span = (s: CageSegment): [number, number] => (s.side === "back" ? [s.x0, s.x1] : [s.z0, s.z1]);

describe("CAGE", () => {
  it("covers every perimeter metre exactly once in each height band, from the floor to the top", () => {
    for (const wall of WALLS) {
      const segs = CAGE.filter(wall.match);
      // Sample the middle of every 10 cm along the wall and every 10 cm of height up to 4 m.
      for (let a = wall.lo + 0.05; a < wall.hi; a += 0.1) {
        const column = segs.filter((s) => {
          const [lo, hi] = span(s);
          return a > lo && a < hi;
        });
        const top = Math.max(...column.map((s) => s.y1));
        for (let y = 0.05; y < 4; y += 0.1) {
          const covering = column.filter((s) => y > s.y0 && y < s.y1);
          expect(covering.length, `${wall.key} at ${a.toFixed(2)}, y ${y.toFixed(2)}`).toBe(y < top ? 1 : 0);
        }
      }
    }
  });

  it("matches the regulation heights: back and corner glass 3 m, stepped glass 2 m, central mesh 3 m", () => {
    for (const s of CAGE) {
      expect(s.y1).toBeGreaterThan(s.y0);
      if (s.side === "back") expect([s.x0, s.x1]).toEqual([-HALF_W, HALF_W]);
    }
    const tops = (side: CageSegment["side"], z: number) =>
      CAGE.filter((s) => s.side === side && s.side !== "back" && z > s.z0 && z < s.z1).map(
        (s) => `${s.material} ${s.y0}-${s.y1}`,
      );
    expect(tops("left", 9)).toEqual(["glass 0-3", "mesh 3-4"]);
    expect(tops("right", -7)).toEqual(["glass 0-2", "mesh 2-3"]);
    expect(tops("right", 0)).toEqual(["mesh 0-3"]);
  });

  it("has two 0.82 × 2.0 m gates a side, centred 0.6 m either side of the net", () => {
    expect(CAGE_GATES).toHaveLength(4);
    for (const side of ["left", "right"] as const) {
      expect(CAGE_GATES.filter((g) => g.side === side).map((g) => g.z).sort()).toEqual([-0.6, 0.6]);
    }
    for (const g of CAGE_GATES) expect([g.width, g.height]).toEqual([0.82, 2.0]);
  });
});

describe("surfaceAt", () => {
  it("reads the material of the nearest wall at a height, or null where the cage is open", () => {
    expect(surfaceAt(5, 2.5, 0)).toBe("mesh");
    expect(surfaceAt(5, 2.5, 9)).toBe("glass");
    expect(surfaceAt(5, 3.5, 0)).toBeNull();
    expect(surfaceAt(0, 3.5, 10)).toBe("mesh");
    expect(surfaceAt(0, 2.9, -10)).toBe("glass");
    expect(surfaceAt(-5, 2.5, -7)).toBe("mesh"); // above the stepped glass
    expect(surfaceAt(-5, 1.5, -7)).toBe("glass");
    // A ball's centre touching the side wall, whose face is on the court's edge.
    expect(surfaceAt(-(HALF_W - BALL.radius), 1.0, 3)).toBe("mesh");
    expect(surfaceAt(0, 2.0, HALF_L - BALL.radius)).toBe("glass");
    expect(surfaceAt(0, 4.2, 10)).toBeNull();
  });
});

describe("cageTopAt", () => {
  it("is 4 m at the back and its corners, 3 m along the step and the middle of the sides", () => {
    expect(cageTopAt(0, 10)).toBe(4);
    expect(cageTopAt(5, -9)).toBe(4);
    expect(cageTopAt(5, 7)).toBe(3);
    expect(cageTopAt(-5, 0)).toBe(3);
    expect(cageTopAt(-5.2, 0)).toBe(3); // just outside the side wall
  });
});

describe("leftCage", () => {
  it("is out past a wall above the cage, never below it", () => {
    expect(leftCage({ x: 5.1, y: 3.2, z: 0 })).toBe(true);
    expect(leftCage({ x: 5.1, y: 3.2, z: 9 })).toBe(false); // the tall corner reaches 4 m
    expect(leftCage({ x: 0, y: 4.1, z: 10.05 })).toBe(true);
    expect(leftCage({ x: 4.9, y: 3.5, z: 0 })).toBe(false); // still inside
    expect(leftCage({ x: 6, y: 1, z: 0 })).toBe(true); // well outside, whatever the height
  });
});

describe("netHeightAt", () => {
  it("is 0.88 m at the centre, 0.92 m at the posts, sagging along a parabola between", () => {
    expect(netHeightAt(0)).toBeCloseTo(0.88, 10);
    expect(netHeightAt(5)).toBeCloseTo(0.92, 10);
    expect(netHeightAt(-5)).toBeCloseTo(0.92, 10);
    expect(netHeightAt(2.5)).toBeCloseTo(0.89, 10); // a quarter of the rise halfway out
    expect(netHeightAt(-4.9)).toBeCloseTo(0.88 + 0.04 * 0.98 * 0.98, 10);
    expect(netHeightAt(7)).toBeCloseTo(0.92, 10); // never above the posts
  });
});
