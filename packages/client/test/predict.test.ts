import { describe, expect, it } from "vitest";
import { PLAYER, TICK_DT } from "@padel/shared";
import { MAX_STEPS_PER_FRAME, Predictor, fixedSteps } from "../src/predict.js";

const D = PLAYER.speed * TICK_DT; // distance of one forward tick
const FWD = { x: 0, z: 1 };

describe("fixedSteps", () => {
  it("emits whole 60 Hz ticks and keeps the remainder", () => {
    const a = fixedSteps(0, TICK_DT * 2.5);
    expect(a.steps).toBe(2);
    expect(a.accumulator).toBeCloseTo(TICK_DT * 0.5, 10);
    const b = fixedSteps(a.accumulator, TICK_DT * 0.5);
    expect(b.steps).toBe(1);
  });

  it("caps a long frame (hidden tab) and drops the backlog", () => {
    const r = fixedSteps(0, 10);
    expect(r.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(r.accumulator).toBe(0);
  });
});

describe("Predictor", () => {
  it("does nothing before the first server position", () => {
    const p = new Predictor();
    p.applyInput({ seq: 1, move: FWD }, -1, false);
    expect(p.renderPosition(0)).toBeNull();
  });

  it("moves immediately on local input", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, undefined, -1, false);
    p.applyInput({ seq: 1, move: FWD }, -1, false);
    p.applyInput({ seq: 2, move: FWD }, -1, false);
    expect(p.renderPosition(0)!.z).toBeCloseTo(-5 + 2 * D, 10);
  });

  it("replays unacked inputs on reconcile with no visible correction", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, undefined, -1, false);
    p.applyInput({ seq: 1, move: FWD }, -1, false);
    p.applyInput({ seq: 2, move: FWD }, -1, false);
    // Server has applied seq 1 only.
    p.reconcile({ x: 0, z: -5 + D }, 1, -1, false);
    const r = p.renderPosition(0)!;
    expect(r.z).toBeCloseTo(-5 + 2 * D, 10);
    expect(r.x).toBeCloseTo(0, 10);
  });

  it("smooths a small misprediction instead of snapping", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, 0, -1, false);
    p.reconcile({ x: 0.3, z: -5 }, 0, -1, false);
    expect(p.renderPosition(0)!.x).toBeCloseTo(0, 10); // still drawn where it was
    expect(p.renderPosition(1)!.x).toBeCloseTo(0.3, 3); // converged after 1 s
  });

  it("snaps on a large jump such as the serve teleport", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, 0, -1, false);
    p.reconcile({ x: 3, z: -9 }, 0, -1, false);
    expect(p.renderPosition(0)).toEqual({ x: 3, z: -9 });
  });

  it("does not move while locked (waiting to serve)", () => {
    const p = new Predictor();
    p.reconcile({ x: 1, z: -9 }, 0, -1, true);
    p.applyInput({ seq: 1, move: FWD }, -1, true);
    expect(p.renderPosition(0)).toEqual({ x: 1, z: -9 });
  });

  it("replays pending inputs with the side given at reconcile (ends swap)", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, 0, -1, false);
    p.applyInput({ seq: 1, move: FWD }, -1, false);
    // Ends swapped: the server now has us at z = +5, seq 1 not yet applied.
    p.reconcile({ x: 0, z: 5 }, 0, 1, false);
    expect(p.renderPosition(0)!.z).toBeCloseTo(5 - D, 10); // forward is -z now
  });

  it("forgets everything on reset (reconnect)", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, 0, -1, false);
    p.applyInput({ seq: 1, move: FWD }, -1, false);
    p.reset();
    expect(p.renderPosition(0)).toBeNull();
    p.reconcile({ x: 2, z: -3 }, 7, -1, false);
    expect(p.renderPosition(0)).toEqual({ x: 2, z: -3 });
  });
});
