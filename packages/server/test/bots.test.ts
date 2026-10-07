import { describe, expect, it } from "vitest";
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
