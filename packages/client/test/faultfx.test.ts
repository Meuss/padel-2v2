import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ServiceBox, Vec3 } from "@padel/shared";
import {
  FaultFxPlayer,
  faultAlpha,
  faultChip,
  faultDuration,
  faultTimeline,
  type FaultFx,
} from "../src/world/faultfx.js";

const p = (x: number, z: number, y = 0.07): Vec3 => ({ x, y, z });
const BOX: ServiceBox = { xMin: -5, xMax: 0, zNear: 0, zFar: 6.95, side: 1 };

const DOUBLE: FaultFx = { kind: "ground", surface: "floor", points: [p(1.6, 5.2), p(2.4, 7.6)] };
const NET: FaultFx = { kind: "net", surface: "net", points: [p(-1.2, 0.1, 0.8)] };
const OUT: FaultFx = { kind: "out", points: [p(1.5, 10.1, 4.1), p(1, 6.5)] };
const GLASS: FaultFx = { kind: "wall", surface: "glass", points: [p(-1.5, 9.9, 1.6)] };
const MESH: FaultFx = { kind: "wall", surface: "mesh", points: [p(4.9, 3, 1.6)] };
const DOUBLE_HIT: FaultFx = { kind: "player", points: [p(-2.5, 5, 0)] };

const at = (fx: FaultFx, action: string, index = 0) =>
  faultTimeline(fx).find((c) => c.action === action && c.index === index)?.at;
const actions = (fx: FaultFx) => faultTimeline(fx).map((c) => `${c.action}${c.index}`);

describe("faultTimeline", () => {
  it("is ordered by time for every kind", () => {
    for (const fx of [DOUBLE, NET, OUT, GLASS, MESH, DOUBLE_HIT, { ...OUT, box: BOX }]) {
      const times = faultTimeline(fx).map((c) => c.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times[0]).toBe(0);
    }
  });

  it("double bounce: bounce 1 ring and label, the arc, bounce 2 250 ms later, then its red pulse", () => {
    expect(actions(DOUBLE)).toEqual(["ring0", "label0", "arc0", "ring1", "label1", "pulse1"]);
    expect(at(DOUBLE, "ring", 1)! - at(DOUBLE, "ring", 0)!).toBe(250);
    expect(at(DOUBLE, "label", 1)! - at(DOUBLE, "label", 0)!).toBe(250);
    expect(at(DOUBLE, "arc")!).toBeGreaterThan(at(DOUBLE, "ring", 0)!);
    expect(at(DOUBLE, "arc")!).toBeLessThan(at(DOUBLE, "ring", 1)!);
    expect(at(DOUBLE, "pulse", 1)!).toBeGreaterThan(at(DOUBLE, "ring", 1)!);
  });

  it("double bounce with only the second bounce known: one ring and its pulse, no numbers", () => {
    const fx: FaultFx = { kind: "ground", points: [p(1, 6)] };
    expect(actions(fx)).toEqual(["ring0", "pulse0"]);
  });

  it("net: the ghost and the tape sweep start together, then the ripple and its pulse", () => {
    expect(actions(NET)).toEqual(["ghost0", "sweep0", "ring0", "pulse0"]);
    expect(at(NET, "ghost")).toBe(0);
    expect(at(NET, "sweep")).toBe(0);
  });

  it("out: the exit ring, the OUT chip, then the line back to the last bounce and its mark", () => {
    expect(actions(OUT)).toEqual(["ring0", "chip0", "line0", "ring1"]);
    expect(actions({ kind: "out", points: [p(1.5, 10.1, 4.1)] })).toEqual(["ring0", "chip0"]);
  });

  it("on the full: the ghost ball and the impact on the glass or the mesh", () => {
    expect(actions(GLASS)).toEqual(["ghost0", "impact0"]);
    expect(actions(MESH)).toEqual(["ghost0", "impact0"]);
  });

  it("double hit: a ring around the player, the 2× chip, then a pulse", () => {
    expect(actions(DOUBLE_HIT)).toEqual(["ring0", "chip0", "pulse0"]);
  });

  it("a serve fault flashes the target box from the start, on top of its own animation", () => {
    expect(actions({ ...OUT, box: BOX })).toEqual(["box0", "ring0", "chip0", "line0", "ring1"]);
    expect(actions({ ...NET, box: BOX })[0]).toBe("box0");
    // A missed toss: the ring on the server and the box, no 2× chip.
    expect(actions({ ...DOUBLE_HIT, box: BOX })).toEqual(["box0", "ring0", "pulse0"]);
  });

  it("nothing to mark without points (except a player, placed by the scene)", () => {
    expect(faultTimeline({ kind: "net", points: [] })).toEqual([]);
    expect(faultTimeline({ kind: "ground", points: [] })).toEqual([]);
  });
});

describe("faultDuration", () => {
  it("lasts 1.8 to 2.2 s, every cue well inside it", () => {
    for (const fx of [DOUBLE, NET, OUT, GLASS, MESH, DOUBLE_HIT, { ...NET, box: BOX }]) {
      const d = faultDuration(fx);
      expect(d).toBeGreaterThanOrEqual(1800);
      expect(d).toBeLessThanOrEqual(2200);
      for (const c of faultTimeline(fx)) expect(c.at).toBeLessThan(d - 1000);
    }
  });
});

describe("faultChip", () => {
  it("reads OUT for an out and 2× for a double hit", () => {
    expect(faultChip(OUT)).toBe("OUT");
    expect(faultChip(DOUBLE_HIT)).toBe("2×");
    expect(faultChip({ ...DOUBLE_HIT, box: BOX })).toBeNull();
    expect(faultChip(DOUBLE)).toBeNull();
  });
});

describe("faultAlpha", () => {
  it("eases in from 0 at the cue, holds, and eases out to 0 at the end", () => {
    expect(faultAlpha(-10, 1000, 2000)).toBe(0);
    expect(faultAlpha(0, 0, 2000)).toBe(0);
    expect(faultAlpha(60, 60, 2000)).toBeGreaterThan(0);
    expect(faultAlpha(60, 60, 2000)).toBeLessThan(1);
    expect(faultAlpha(800, 800, 2000)).toBeCloseTo(1);
    expect(faultAlpha(1999, 1999, 2000)).toBeLessThan(0.05);
    expect(faultAlpha(2000, 2000, 2000)).toBe(0);
    // Monotonic fade over the tail.
    expect(faultAlpha(1700, 1700, 2000)).toBeLessThan(faultAlpha(1500, 1500, 2000));
  });
});

describe("FaultFxPlayer", () => {
  /** Meshes on screen: visible themselves and every parent up to the root. */
  const visible = (root: THREE.Object3D) => {
    let n = 0;
    root.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh) n++;
    });
    return n;
  };

  it("draws nothing before its delay, shows the cues, and hides everything once over", () => {
    const scene = new THREE.Scene();
    const fx = new FaultFxPlayer(scene);
    fx.play(DOUBLE, 100);
    fx.update(0.05);
    expect(visible(fx.root)).toBe(0);
    fx.update(0.4);
    expect(visible(fx.root)).toBeGreaterThan(2);
    fx.update(3);
    expect(visible(fx.root)).toBe(0);
  });

  it("stop() fades the current fault out quickly (a replay is starting)", () => {
    const scene = new THREE.Scene();
    const fx = new FaultFxPlayer(scene);
    fx.play(NET, 0);
    fx.update(0.5);
    expect(visible(fx.root)).toBeGreaterThan(0);
    fx.stop();
    fx.update(0.3);
    expect(visible(fx.root)).toBe(0);
    // A fault still waiting for its delay never shows.
    fx.play(OUT, 500);
    fx.stop();
    fx.update(1);
    expect(visible(fx.root)).toBe(0);
  });

  it("a new fault replaces the last one", () => {
    const scene = new THREE.Scene();
    const fx = new FaultFxPlayer(scene);
    fx.play(DOUBLE, 0);
    fx.update(0.6);
    fx.play(GLASS, 0);
    fx.update(0.3);
    expect(fx.root.getObjectByName("fault-arc")!.visible).toBe(false);
    expect(fx.root.getObjectByName("fault-impact")!.visible).toBe(true);
  });
});
