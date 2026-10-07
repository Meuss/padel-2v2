import { describe, expect, it } from "vitest";
import {
  COURT,
  LAG,
  PLAYER,
  TICK_MS,
  shotVelocity,
  type ContactEvent,
  type ShotEvent,
  type SnapshotMsg,
  type Vec2,
  type Vec3,
} from "@padel/shared";
import { Room } from "../src/room.js";
import { fakeClient, sendInput, stepUntil } from "./fakes.js";

type Fake = ReturnType<typeof fakeClient>;

/** A1 (at its home spot, -2.5, -5) alone in warm-up: no opponents, so no legality checks. */
async function warmupRoom() {
  const room = await Room.create();
  const p = fakeClient("p1");
  room.addClient(p.client);
  room.claimSlot("p1", "Ana");
  stepUntil(room, () => p.last("snapshot") !== null, 3);
  return { room, p };
}

const A1_RACKET: Vec3 = { x: -2.5, y: PLAYER.racketHeight, z: -5 };
const AIM: Vec2 = { x: 0, z: 1 };

function snapshots(p: Fake): SnapshotMsg[] {
  return p.messages().filter((m): m is SnapshotMsg => m.t === "snapshot");
}
const allShots = (p: Fake): ShotEvent[] => snapshots(p).flatMap((s) => s.shots ?? []);
const allContacts = (p: Fake): ContactEvent[] => snapshots(p).flatMap((s) => s.contacts ?? []);

/** Step until a snapshot was just sent, then two more: the next step sends a snapshot. */
function alignToSnapshot(room: Room, p: Fake): void {
  const tick = p.last("snapshot")!.tick;
  stepUntil(room, () => p.last("snapshot")!.tick !== tick, 3);
  room.step();
  room.step();
}

/** One swing on the next tick; returns the snapshot that tick sends (call alignToSnapshot first). */
function swing(room: Room, p: Fake, id: string, shot: "drive" | "lob", view: number): SnapshotMsg {
  sendInput(room, id, { shot, aim: AIM, view });
  room.step();
  return p.last("snapshot")!;
}

const near = (a: Vec3, b: Vec3, tol: number) =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol;

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("lag-compensated shots with Timing", () => {
  it("a swing at the closest approach is a perfect Drive with the Drive velocity", async () => {
    const { room, p } = await warmupRoom();
    alignToSnapshot(room, p);
    // 1 m to the side of the racket point, moving at 12 m/s past it: closest right now.
    room.debugPlaceBall({ x: A1_RACKET.x + 1, y: A1_RACKET.y, z: A1_RACKET.z }, { x: 0, y: 0, z: -12 });
    const s = swing(room, p, "p1", "drive", room.serverTime);
    expect(s.shots).toEqual([
      { slot: "A1", kind: "drive", timing: "perfect", pos: expect.any(Object) },
    ]);
    // One physics step (gravity, damping) has run since the hit.
    expect(near(s.ball.vel, shotVelocity("drive", "perfect", AIM), 0.3)).toBe(true);
    expect(p.last("match")!.phase).toBe("warmup"); // warm-up swings never end a point
    room.stop();
  });

  it("a Lob request lifts the ball at the Lob speed", async () => {
    const { room, p } = await warmupRoom();
    alignToSnapshot(room, p);
    room.debugPlaceBall({ x: A1_RACKET.x + 1, y: A1_RACKET.y, z: A1_RACKET.z }, { x: 0, y: 0, z: -12 });
    const s = swing(room, p, "p1", "lob", room.serverTime);
    expect(s.shots?.[0]?.kind).toBe("lob");
    expect(s.ball.vel.y).toBeCloseTo(9.5, 0);
    room.stop();
  });

  it("a ball at 2.4 m becomes a Smash even when a Lob was requested", async () => {
    const { room, p } = await warmupRoom();
    alignToSnapshot(room, p);
    room.debugPlaceBall({ x: A1_RACKET.x + 0.5, y: 2.4, z: A1_RACKET.z }, { x: 0, y: 0, z: -12 });
    const s = swing(room, p, "p1", "lob", room.serverTime);
    expect(s.shots?.[0]?.kind).toBe("smash");
    expect(s.ball.vel.y).toBeLessThan(0);
    room.stop();
  });

  /** Ball moving +x at `speed` through A1's racket point; returns the time it was there. */
  function throughRacket(room: Room, speed: number): number {
    room.debugPlaceBall({ ...A1_RACKET }, { x: speed, y: 0, z: 0 });
    room.step(); // history now holds the placed ball
    return room.serverTime;
  }

  it("rewinds to the client's view: a ball in reach 150 ms ago but now 4 m away connects", async () => {
    for (const rewind of [true, false]) {
      const { room, p } = await warmupRoom();
      const seen = throughRacket(room, 30);
      while (room.serverTime < seen + 150 - 1) room.step();
      sendInput(room, "p1", { shot: "drive", aim: AIM, view: rewind ? seen : room.serverTime });
      room.step();
      for (let i = 0; i < 3; i++) room.step();
      // Without the rewind, the same swing misses: the ball has flown on, over 4 m away.
      expect(allShots(p)).toHaveLength(rewind ? 1 : 0);
      if (!rewind) expect(dist(p.last("snapshot")!.ball.pos, A1_RACKET)).toBeGreaterThan(4);
      room.stop();
    }
  });

  it(`clamps a garbage view to ${LAG.maxRewindMs} ms, and a future view to no rewind`, async () => {
    // At 20 m/s the ball is in reach for ~290 ms around `seen`: a tick past 250 ms later it is
    // only reachable with a rewind of over 100 ms, and history goes back 600 ms.
    {
      const { room, p } = await warmupRoom();
      const seen = throughRacket(room, 20);
      while (room.serverTime < seen + LAG.maxRewindMs + TICK_MS / 2) room.step();
      sendInput(room, "p1", { shot: "drive", aim: AIM, view: 0 });
      for (let i = 0; i < 4; i++) room.step();
      expect(allShots(p)).toHaveLength(1);
      expect(Number.isFinite(p.last("snapshot")!.ball.vel.x)).toBe(true);
      room.stop();
    }
    {
      const { room, p } = await warmupRoom();
      alignToSnapshot(room, p);
      room.debugPlaceBall({ x: A1_RACKET.x + 1, y: A1_RACKET.y, z: A1_RACKET.z }, { x: 0, y: 0, z: -12 });
      const s = swing(room, p, "p1", "drive", room.serverTime + 10_000);
      // No rewind: judged on the present ball, which is at its closest.
      expect(s.shots?.[0]?.timing).toBe("perfect");
      room.stop();
    }
  });

  it("rejects a swing whose view predates another player's hit", async () => {
    // A1 and A2 alone (B1 left), so warm-up: A1 at (-2.5, -5), A2 at (2.5, -5).
    async function setup() {
      const room = await Room.create();
      const clients = ["p1", "p2", "p3"].map(fakeClient);
      for (const c of clients) {
        room.addClient(c.client);
        room.claimSlot(c.client.id, c.client.id);
      }
      room.removeClient("p2");
      const p = clients[0]!;
      stepUntil(room, () => p.last("snapshot") !== null, 3);
      // Between the two players, in reach of both, drifting slowly.
      room.debugPlaceBall({ x: 0, y: 1.2, z: -5 }, { x: 0, y: 0, z: 0.5 });
      room.step();
      return { room, p, seen: room.serverTime };
    }

    // Control: with nobody else hitting, A1's rewound swing connects.
    {
      const { room, p, seen } = await setup();
      room.step();
      room.step();
      sendInput(room, "p1", { shot: "drive", aim: AIM, view: seen });
      stepUntil(room, () => allShots(p).length > 0, 6);
      expect(allShots(p).map((s) => s.slot)).toEqual(["A1"]);
      room.stop();
    }
    {
      const { room, p, seen } = await setup();
      expect(p.last("match")!.phase).toBe("warmup");
      sendInput(room, "p3", { shot: "drive", aim: AIM, view: room.serverTime });
      room.step(); // A2 hits
      sendInput(room, "p1", { shot: "drive", aim: AIM, view: seen });
      room.step(); // A1 swings at the ball as it was before A2's hit
      for (let i = 0; i < 6; i++) room.step();
      expect(allShots(p).map((s) => s.slot)).toEqual(["A2"]);
      // The ball still carries A2's Drive (+z), untouched by A1.
      expect(p.last("snapshot")!.ball.vel.z).toBeGreaterThan(8);
      room.stop();
    }
  });

  it("snapshots carry floor, glass and fence contacts", async () => {
    const { room, p } = await warmupRoom();
    // Low into the back glass, then down onto the floor.
    room.debugPlaceBall({ x: 0, y: 1, z: -8 }, { x: 0, y: 0, z: -15 });
    for (let i = 0; i < 90; i++) room.step();
    let contacts = allContacts(p);
    const glass = contacts.find((c) => c.surface === "glass");
    expect(glass).toBeDefined();
    expect(glass!.pos.y).toBeLessThanOrEqual(COURT.glassHeight);
    expect(glass!.speed).toBeGreaterThan(10);
    // The floor bounce after the glass (not the warm-up ball's first drop).
    expect(contacts.findIndex((c) => c.surface === "floor")).toBeGreaterThan(contacts.indexOf(glass!));

    // High into the mesh fence above the glass.
    room.debugPlaceBall({ x: 0, y: 3.5, z: -8 }, { x: 0, y: 1, z: -15 });
    for (let i = 0; i < 15; i++) room.step();
    contacts = allContacts(p);
    const fence = contacts.find((c) => c.surface === "fence");
    expect(fence).toBeDefined();
    expect(fence!.pos.y).toBeGreaterThan(COURT.glassHeight);
    room.stop();
  });

  it("a swing rewound to before a hold teleport cannot reach the old ball", async () => {
    // A1 serves against an idle human B1; the ball is then dropped beside A1, the serve
    // faults on A1's side, and the ball is held at the net. B1 leaves (warm-up), and A1
    // swings with a view from when the ball was beside them.
    const room = await Room.create();
    const p = fakeClient("p1");
    const q = fakeClient("p2");
    for (const c of [p, q]) {
      room.addClient(c.client);
      room.claimSlot(c.client.id, c.client.id);
    }
    stepUntil(room, () => p.last("snapshot") !== null, 3);
    sendInput(room, "p1", { serve: true });
    room.step();
    for (let i = 0; i < 18; i++) room.step(); // strike near the top of the toss
    sendInput(room, "p1", { shot: "drive" });
    room.step();
    expect(p.last("match")!.phase).toBe("rally");
    const a1 = p.last("snapshot")!.players.find((s) => s.slot === "A1")!.pos;

    room.debugPlaceBall({ x: a1.x + 0.5, y: 0.4, z: a1.z }, { x: 0, y: -2, z: 0 });
    room.step();
    const seen = room.serverTime; // the ball beside A1
    expect(stepUntil(room, () => p.last("match")!.phase === "between", 15)).not.toBeNull();
    room.removeClient("p2");
    room.step();
    expect(p.last("match")!.phase).toBe("warmup");
    expect(room.serverTime - seen).toBeLessThan(LAG.maxRewindMs);

    const from = p.messages().length;
    sendInput(room, "p1", { shot: "drive", aim: AIM, view: seen });
    for (let i = 0; i < 4; i++) room.step();
    const shots = p
      .messages()
      .slice(from)
      .flatMap((m) => (m.t === "snapshot" ? (m.shots ?? []) : []));
    expect(shots).toEqual([]);
    room.stop();
  });
});
