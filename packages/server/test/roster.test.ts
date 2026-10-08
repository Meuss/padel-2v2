import { describe, expect, it } from "vitest";
import { decodeServer, type RosterMsg } from "@padel/shared";
import { Room, type Client } from "../src/room.js";

/** Minimal fake socket that records the last roster broadcast it received. */
function fakeClient(id: string): Client & { lastRoster: () => RosterMsg | null } {
  const sent: string[] = [];
  const ws = { readyState: 1, OPEN: 1, send: (d: string) => sent.push(d) };
  return {
    id,
    ws: ws as unknown as Client["ws"],
    name: "Guest",
    lastActivity: 0,
    lastRoster: () => {
      for (let i = sent.length - 1; i >= 0; i--) {
        const msg = decodeServer(sent[i]!);
        if (msg.t === "roster") return msg;
      }
      return null;
    },
  };
}

describe("roster spectator count", () => {
  it("updates when a spectator joins and leaves", async () => {
    const room = await Room.create();

    // Fill all four player slots.
    const players = ["p1", "p2", "p3", "p4"].map(fakeClient);
    for (const p of players) {
      room.addClient(p);
      room.claimSlot(p.id, p.name);
    }

    // A fifth connection arrives — no slot free, so they are a spectator.
    const spec = fakeClient("spec");
    room.addClient(spec);
    room.claimSlot(spec.id, spec.name); // returns null; they become a spectator

    expect(players[0]!.lastRoster()?.spectatorCount).toBe(1);

    // Spectator disconnects — count must drop back to zero.
    room.removeClient(spec.id);
    expect(players[0]!.lastRoster()?.spectatorCount).toBe(0);

    room.stop();
  });
});

describe("roster seatOpen", () => {
  it("is true for a spectator when bots hold seats, once its roster is rebroadcast", async () => {
    const room = await Room.create();
    room.debugAddBots(4);
    const spec = fakeClient("spec");
    room.addClient(spec);
    room.claimSlot(spec.id, spec.name);
    room.broadcastRoster(); // what index.ts does after the Welcome
    expect(spec.lastRoster()?.seatOpen).toBe(true);
    room.stop();
  });
});

describe("status", () => {
  it("counts the humans seated as playing and every other connection as watching", async () => {
    const room = await Room.create();
    expect(room.status()).toEqual({ playing: 0, watching: 0 });
    const p = fakeClient("p");
    room.addClient(p);
    room.claimSlot(p.id, p.name);
    room.debugAddBots(2);
    const s = fakeClient("s");
    room.addClient(s);
    expect(room.status()).toEqual({ playing: 1, watching: 1 });
    room.stop();
  });
});
