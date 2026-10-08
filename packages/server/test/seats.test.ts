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
