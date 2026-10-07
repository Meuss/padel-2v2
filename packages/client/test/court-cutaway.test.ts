import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { EndWalls } from "../src/world/court.js";

function mats() {
  return {
    steel: new THREE.MeshStandardMaterial(),
    fence: new THREE.MeshStandardMaterial(),
    glass: new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.12 }),
  };
}

describe("EndWalls", () => {
  it("fades only the cut end, over about 0.3 s, and restores on a swap", () => {
    const neg = mats();
    const pos = mats();
    const w = new EndWalls();
    w.add(-1, neg);
    w.add(1, pos);
    for (let i = 0; i < 20; i++) w.update(-1, 1 / 60);
    expect(neg.fence.opacity).toBeCloseTo(0.12);
    expect(neg.steel.opacity).toBeCloseTo(0.15);
    expect(pos.fence.opacity).toBe(1);
    expect(pos.steel.opacity).toBe(1);
    for (let i = 0; i < 20; i++) w.update(1, 1 / 60);
    expect(neg.fence.opacity).toBe(1);
    expect(pos.fence.opacity).toBeCloseTo(0.12);
  });
});
