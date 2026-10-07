import { describe, expect, it } from "vitest";
import { PLAYER, TICK_DT, type InputMsg, type Vec2 } from "@padel/shared";
import { Room } from "../src/room.js";
import { fakeClient } from "./fakes.js";

function input(seq: number, move: Vec2): InputMsg {
  return { t: "input", seq, ts: 0, move, aim: { x: 0, z: 1 }, swing: false, serve: false };
}

async function seatedRoom() {
  const room = await Room.create();
  const p = fakeClient("p1");
  room.addClient(p.client);
  room.claimSlot("p1", "Ana"); // seat A1: defends z<0, starts at (-2.5, -5)
  const me = () => p.last("snapshot")!.players.find((s) => s.slot === "A1")!;
  return { room, p, me };
}

describe("server input queue", () => {
  it("applies one queued input per tick and acks its seq", async () => {
    const { room, me } = await seatedRoom();
    for (let seq = 1; seq <= 3; seq++) room.handleInput("p1", input(seq, { x: 0, z: 1 }));
    room.step();
    room.step();
    room.step(); // a snapshot goes out every 3rd tick
    expect(me().ack).toBe(3);
    expect(me().pos.z).toBeCloseTo(-5 + 3 * PLAYER.speed * TICK_DT, 6);
    room.stop();
  });

  it("does not move when no input is queued", async () => {
    const { room, me } = await seatedRoom();
    room.handleInput("p1", input(1, { x: 0, z: 1 }));
    for (let i = 0; i < 6; i++) room.step();
    expect(me().ack).toBe(1);
    expect(me().pos.z).toBeCloseTo(-5 + PLAYER.speed * TICK_DT, 6);
    room.stop();
  });

  it("caps the queue so a flood cannot build up lag", async () => {
    const { room, me } = await seatedRoom();
    for (let seq = 1; seq <= 20; seq++) room.handleInput("p1", input(seq, { x: 0, z: 1 }));
    for (let i = 0; i < 21; i++) room.step();
    expect(me().ack).toBe(20);
    expect(me().pos.z).toBeCloseTo(-5 + 8 * PLAYER.speed * TICK_DT, 6);
    room.stop();
  });

  it("ignores input from a connection without a seat", async () => {
    const { room, p, me } = await seatedRoom();
    const w = fakeClient("w1");
    room.addClient(w.client);
    room.handleInput("w1", input(1, { x: 1, z: 1 }));
    room.step();
    room.step();
    room.step();
    expect(me().ack).toBeUndefined();
    expect(p.last("snapshot")!.players).toHaveLength(1);
    room.stop();
  });
});
