import { describe, expect, it } from "vitest";
import { PLAYER, TICK_DT, type InputMsg, type Vec2 } from "@padel/shared";
import { INPUT_SURPLUS_KEEP, Room } from "../src/room.js";
import { fakeClient } from "./fakes.js";

function input(seq: number, move: Vec2): InputMsg {
  return { t: "input", seq, ts: 0, move, aim: { x: 0, z: 1 }, shot: null, view: 0, serve: false };
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

  it("drains a backed-up queue and applies every input exactly once", async () => {
    const { room, me } = await seatedRoom();
    for (let seq = 1; seq <= 6; seq++) room.handleInput("p1", input(seq, { x: 0, z: 1 }));
    for (let i = 0; i < 6; i++) room.step(); // two inputs per tick while the queue is > 2
    expect(me().ack).toBe(6);
    expect(me().pos.z).toBeCloseTo(-5 + 6 * PLAYER.speed * TICK_DT, 6);
    room.stop();
  });

  it("cannot exceed one step per tick on average by flooding inputs", async () => {
    const { room, me } = await seatedRoom();
    let seq = 0;
    for (let i = 0; i < 60; i++) {
      for (let k = 0; k < 4; k++) room.handleInput("p1", input(++seq, { x: 0, z: 1 }));
      room.step();
    }
    const moved = me().pos.z - -5; // 60 steps: a snapshot went out on the last tick
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual((60 + 3) * PLAYER.speed * TICK_DT + 1e-6);
    room.stop();
  });

  it("keeps the queue bounded when the client sends one input per tick", async () => {
    const { room, me } = await seatedRoom();
    let seq = 0;
    for (let i = 1; i <= 300; i++) {
      room.handleInput("p1", input(++seq, { x: 1, z: 0 }));
      room.step();
      if (i % 3 === 0) expect(seq - me().ack!).toBeLessThanOrEqual(3);
    }
    room.stop();
  });

  it("drops the stale input surplus after a stall, keeping the newest inputs", async () => {
    const { room } = await seatedRoom();
    const a1 = (room as unknown as { slots: Map<string, { inputQueue: InputMsg[]; ack: number | undefined }> }).slots.get(
      "A1",
    )!;
    for (let i = 0; i < 10; i++) room.step(); // stall: nothing arrives for 10 ticks
    for (let seq = 1; seq <= 9; seq++) room.handleInput("p1", input(seq, { x: 0, z: 1 }));
    room.step();
    expect(a1.inputQueue.length).toBeLessThanOrEqual(INPUT_SURPLUS_KEEP + 1);
    // The newest inputs survive: ack is the last one applied, the rest are still queued in order.
    expect(a1.ack).toBe(9 - a1.inputQueue.length);
    expect(a1.inputQueue.map((m) => m.seq)).toEqual(
      Array.from({ length: a1.inputQueue.length }, (_, i) => a1.ack! + 1 + i),
    );
    room.stop();
  });

  it("drops inputs whose move, aim or view is not a finite number", async () => {
    const { room, p, me } = await seatedRoom();
    const bad: InputMsg[] = [
      { ...input(1, { x: Number.NaN, z: 1 }) },
      { ...input(2, { x: 0, z: Number.POSITIVE_INFINITY }) },
      { ...input(3, { x: 0, z: 1 }), aim: { x: Number.NaN, z: 1 } },
      { ...input(4, { x: 0, z: 1 }), view: Number.NaN, shot: "drive" },
      // A hostile client can send anything that parses as JSON.
      { ...input(5, { x: 0, z: 1 }), aim: null as unknown as Vec2 },
      { ...input(6, { x: 0, z: 1 }), view: "soon" as unknown as number },
    ];
    for (const b of bad) room.handleInput("p1", b);
    room.step();
    room.step();
    room.step();
    expect(me().ack).toBeUndefined();
    expect(me().pos).toEqual({ x: -2.5, y: 0, z: -5 });
    expect(p.last("snapshot")!.shots).toBeUndefined();

    room.handleInput("p1", input(7, { x: 0, z: 1 }));
    room.step();
    room.step();
    room.step();
    expect(me().ack).toBe(7);
    room.stop();
  });
});

