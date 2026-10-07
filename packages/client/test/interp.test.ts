import { describe, expect, it } from "vitest";
import { INTERP_DELAY_MS, SNAPSHOT_MS, type SnapshotMsg } from "@padel/shared";
import { InterpBuffer } from "../src/interp.js";

const snap = (serverTime: number, ballX: number): SnapshotMsg => ({
  t: "snapshot",
  tick: 0,
  serverTime,
  ball: { pos: { x: ballX, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
  players: [],
});

describe("InterpBuffer.reset", () => {
  it("after a reset, snapshots from a restarted (earlier) server clock are sampled, not dropped", () => {
    const buf = new InterpBuffer();
    for (let i = 0; i < 10; i++) buf.add(snap(5_000_000 + i * SNAPSHOT_MS, 1));
    buf.update(16);
    expect(buf.sample()!.ball.x).toBe(1);

    buf.reset();
    expect(buf.sample()).toBeNull();
    for (let i = 0; i < 4; i++) buf.add(snap(1000 + i * SNAPSHOT_MS, 5 + i));
    buf.update(16);
    expect(buf.renderTime).toBeLessThan(1000 + 4 * SNAPSHOT_MS);
    expect(buf.renderTime).toBeGreaterThan(1000 - INTERP_DELAY_MS);
    const x = buf.sample()!.ball.x;
    expect(x).toBeGreaterThanOrEqual(5);
    expect(x).toBeLessThanOrEqual(8);
  });
});
