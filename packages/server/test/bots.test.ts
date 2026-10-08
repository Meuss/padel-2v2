import { describe, expect, it } from "vitest";
import { BOT, SHOT } from "@padel/shared";
import { rollSwingAt } from "../src/bots.js";
import { Room } from "../src/room.js";
import { fakeClient } from "./fakes.js";

describe("bot control", () => {
  it("only seated players can add or clear bots", async () => {
    const room = await Room.create();
    const player = fakeClient("p1");
    const watcher = fakeClient("w1");
    room.addClient(player.client);
    room.claimSlot("p1", "Ana");
    room.addClient(watcher.client); // connected, never seated

    expect(room.addBot("w1")).toBe(false);
    expect(player.last("roster")?.players).toHaveLength(1);

    expect(room.addBot("p1")).toBe(true);
    expect(player.last("roster")?.players).toHaveLength(2);

    expect(room.clearBots("w1")).toBe(false);
    expect(player.last("roster")?.players).toHaveLength(2);

    expect(room.clearBots("p1")).toBe(true);
    expect(player.last("roster")?.players).toHaveLength(1);
    room.stop();
  });

  it("refuses a bot when every seat is taken", async () => {
    const room = await Room.create();
    const p = fakeClient("p1");
    room.addClient(p.client);
    room.claimSlot("p1", "Ana");
    expect(room.addBot("p1")).toBe(true);
    expect(room.addBot("p1")).toBe(true);
    expect(room.addBot("p1")).toBe(true);
    expect(room.addBot("p1")).toBe(false);
    room.stop();
  });
});

describe("a bot's swing point", () => {
  const W = SHOT.perfectWindowS;
  /** An rng that returns the given values in turn. */
  const seq = (...v: number[]) => {
    let i = 0;
    return () => v[i++ % v.length]!;
  };

  it("is perfect unless the off-timing roll comes up", () => {
    expect(rollSwingAt(seq(BOT.offTimingChance))).toBe(0);
  });

  it("when off, lands anywhere from one to three windows early or late", () => {
    // Off-timed (roll below the chance), then the spread, then early (below earlyShare) or late.
    expect(rollSwingAt(seq(0, 0, 0))).toBeCloseTo(W);
    expect(rollSwingAt(seq(0, 0.5, 0))).toBeCloseTo(2 * W);
    expect(rollSwingAt(seq(0, 0.999999, 0))).toBeCloseTo(3 * W);
    expect(rollSwingAt(seq(0, 0.5, BOT.earlyShare))).toBeCloseTo(-2 * W);
  });
});
