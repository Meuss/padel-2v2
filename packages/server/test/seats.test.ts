import { describe, expect, it } from "vitest";
import { Room } from "../src/room.js";
import { fakeClient } from "./fakes.js";

const SEED = 11;

describe("one seat per connection", () => {
  it("a take seat before join, then the join, gives one seat; leaving leaves no ghost", async () => {
    const room = await Room.create({ seed: SEED });
    const h = fakeClient("h");
    room.addClient(h.client);
    room.claimSlot("h", "h");
    const u = fakeClient("u");
    room.addClient(u.client);

    room.takeSeat("u"); // a socket that has not joined yet (index.ts now ignores this)
    const seat = room.claimSlot("u", "u");
    const mine = () => h.last("roster")!.players.filter((p) => p.id === "u");
    expect(mine()).toHaveLength(1);
    expect(seat?.slot).toBe(mine()[0]!.slot);

    room.removeClient("u");
    expect(mine()).toHaveLength(0);
    expect(h.last("roster")!.players).toHaveLength(1);
    room.stop();
  });

  it("a second claim from a seated connection returns the seat it holds", async () => {
    const room = await Room.create({ seed: SEED });
    const p = fakeClient("p");
    room.addClient(p.client);
    const first = room.claimSlot("p", "p");
    const again = room.claimSlot("p", "p");
    expect(again?.slot).toBe(first?.slot);
    expect(p.last("roster")!.players).toHaveLength(1);
    room.stop();
  });
});

/** Four humans in A1, B1, A2, B2. */
async function fourHumans() {
  const room = await Room.create({ seed: SEED });
  const clients = ["p1", "p2", "p3", "p4"].map((id) => {
    const c = fakeClient(id);
    room.addClient(c.client);
    room.claimSlot(id, id);
    return c;
  });
  room.step();
  const idAt = (slot: string) => clients[["A1", "B1", "A2", "B2"].indexOf(slot)]!.client.id;
  return { room, clients, idAt };
}

describe("the server leaving between points", () => {
  it("after the match ends keeps the phase over, with the rematch vote intact", async () => {
    const { room, clients, idAt } = await fourHumans();
    room.debugEndMatch("A");
    room.step();
    const watcher = clients[0]!;
    const server = watcher.last("match")!.serverSlot!;
    const leaver = idAt(server);
    const stayer = clients.find((c) => c.client.id !== leaver)!;
    room.removeClient(leaver);
    for (let i = 0; i < 10; i++) room.step();
    expect(stayer.last("match")).toMatchObject({ phase: "over", winner: "A" });
    expect(stayer.last("vote")).toMatchObject({ active: true, kind: "rematch", needed: 3 });
    room.stop();
  });

  it("during the pause between points keeps the pause, and sets up the serve when it ends", async () => {
    const { room, clients, idAt } = await fourHumans();
    const p1 = clients[0]!;
    const server = p1.last("match")!.serverSlot!;
    // A toss left to expire is a fault: the pause before the second serve follows.
    room.handleInput(idAt(server), {
      t: "input", seq: 1, ts: 0, move: { x: 0, z: 0 }, aim: { x: 0, z: 1 }, shot: null, view: room.serverTime, serve: true,
    });
    let steps = 0;
    while (p1.last("match")!.phase !== "between" && steps++ < 600) room.step();
    expect(p1.last("match")!.phase).toBe("between");
    const leaver = idAt(p1.last("match")!.serverSlot!);
    const stayer = clients.find((c) => c.client.id !== leaver)!;
    room.removeClient(leaver);
    room.step();
    expect(stayer.last("match")!.phase).toBe("between");
    let waited = 0;
    while (stayer.last("match")!.phase === "between" && waited++ < 600) room.step();
    expect(waited).toBeGreaterThan(30); // the pause ran on, it was not cut short
    expect(stayer.last("match")!.phase).toBe("serve");
    expect(stayer.last("match")!.serverSlot).not.toBeNull();
    room.stop();
  });
});

describe("take seat", () => {
  it("sends the new player the match and the vote after its Welcome, as a join does", async () => {
    const room = await Room.create({ seed: SEED });
    room.debugAddBots(4);
    room.step();
    const s = fakeClient("s");
    room.addClient(s.client);
    room.claimSlot("s", "s");
    const from = s.messages().length;
    expect(room.takeSeat("s")).toBe(true);
    const types = s.messages().slice(from).map((m) => m.t).filter((t) => t !== "roster" && t !== "snapshot");
    expect(types.slice(0, 3)).toEqual(["welcome", "match", "vote"]);
    room.stop();
  });
});

describe("take seat during the toss", () => {
  it("waits like a rally: queued, then seated at the next tick with no toss and no rally", async () => {
    // A bot in A1 serves first; three idle humans hold the other seats.
    const room = await Room.create({ seed: SEED });
    room.debugAddBots(1);
    const humans = ["p1", "p2", "p3"].map((id) => {
      const c = fakeClient(id);
      room.addClient(c.client);
      room.claimSlot(id, id);
      return c;
    });
    const p1 = humans[0]!;
    const s = fakeClient("s");
    room.addClient(s.client);
    const match = () => p1.last("match")!;
    let steps = 0;
    while (!p1.last("match")?.tossing && steps++ < 600) room.step();
    expect(match().tossing).toBe(true);

    expect(room.takeSeat("s")).toBe(true);
    expect(s.last("welcome")).toBeNull();
    let seatedBusy = false;
    steps = 0;
    while (!s.last("welcome") && steps++ < 60 * 30) {
      room.step();
      const m = match();
      if (s.last("welcome") && (m.tossing || m.phase === "rally")) seatedBusy = true;
    }
    expect(s.last("welcome")).toMatchObject({ role: "player", slot: "A1" });
    expect(seatedBusy).toBe(false);
    room.stop();
  }, 30_000);
});
