import { describe, expect, it } from "vitest";
import { COURT, TICK_MS, TOSS, type Vec3 } from "@padel/shared";
import { MatchEngine } from "../src/match.js";
import { PhysicsWorld, type Contact } from "../src/world.js";

/** A few seconds of physics per test. */
const PHYSICS_TEST_MS = 15_000;
const APEX_MS = (TOSS.vy / 9.81) * 1000;

function engineAfterServe(aim: { x: number; z: number } = { x: 2, z: 3 }) {
  const engine = new MatchEngine();
  engine.setRoster(
    [
      { slot: "A1", team: "A" },
      { slot: "B1", team: "B" },
    ],
    0,
  );
  expect(engine.startToss("A1", 0)).toBe(true);
  expect(engine.strikeServe("A1", APEX_MS, aim)).not.toBeNull();
  return engine;
}

/** A rally after B1 returns A1's serve: B (side +1) is the hitter, aiming at A's half (z < 0). */
function rallyAfterReturn() {
  const engine = engineAfterServe();
  expect(engine.hit("B1", "B", APEX_MS + 500)).toBe(true);
  return { engine, now: APEX_MS + 500 };
}

/** Run physics and the engine together until the point ends (or `ticks` run out). */
function playOut(world: PhysicsWorld, engine: MatchEngine, start: number, ticks: number) {
  let now = start;
  const contacts: Contact[] = [];
  for (let i = 0; i < ticks && engine.phase === "rally"; i++) {
    now += TICK_MS;
    const cs = world.step();
    contacts.push(...cs);
    engine.tick(now, world.ballPosition(), world.ballSpeed(), cs);
  }
  return { msg: engine.toMessage(), contacts };
}

const floors = (cs: Contact[]): Vec3[] => cs.filter((c) => c.kind === "floor").map((c) => c.pos);

describe("fault highlight points", () => {
  it("a double bounce after a back-glass rebound marks both true bounce points", async () => {
    const world = await PhysicsWorld.create();
    const { engine, now } = rallyAfterReturn();
    // Low and fast into A's half: it bounces, rebounds off the back glass and bounces again.
    world.placeBall({ x: 1, y: 1.2, z: -4 }, { x: 0.5, y: 0, z: -9 });
    const { msg, contacts } = playOut(world, engine, now, 400);
    expect(msg.reason).toBe("DOUBLE BOUNCE");
    const bounces = floors(contacts);
    expect(bounces.length).toBeGreaterThanOrEqual(2);
    const firstWall = contacts.findIndex((c) => c.kind === "glass");
    const firstFloor = contacts.findIndex((c) => c.kind === "floor");
    expect(firstWall).toBeGreaterThan(firstFloor); // the glass rebound sits between the bounces
    const h = msg.highlight!;
    expect(h.kind).toBe("ground");
    expect(h.surface).toBe("floor");
    expect(h.points).toHaveLength(2);
    expect(h.points![0]).toEqual(bounces[0]);
    expect(h.points![1]).toEqual(bounces[1]);
    expect(h.points![0]!.z).toBeLessThan(0);
    expect(h.points![1]!.z).toBeLessThan(0);
  }, PHYSICS_TEST_MS);

  it("a double bounce right after a net cord marks both true bounce points on the far side", async () => {
    const world = await PhysicsWorld.create();
    const { engine, now } = rallyAfterReturn();
    // Clips the top of the net from B's side and dribbles over into A's half.
    world.placeBall({ x: 0.5, y: 0.92, z: 0.5 }, { x: 0, y: 0.5, z: -4 });
    const { msg, contacts } = playOut(world, engine, now, 400);
    expect(contacts[0]?.kind).toBe("net");
    expect(msg.reason).toBe("DOUBLE BOUNCE");
    const bounces = floors(contacts);
    const h = msg.highlight!;
    expect(h.points).toHaveLength(2);
    expect(h.points![0]).toEqual(bounces[0]);
    expect(h.points![1]).toEqual(bounces[1]);
    expect(h.points![0]!.z).toBeLessThan(0);
  }, PHYSICS_TEST_MS);

  it("into the net marks the net contact", async () => {
    const world = await PhysicsWorld.create();
    const { engine, now } = rallyAfterReturn();
    world.placeBall({ x: -1, y: 0.5, z: 2 }, { x: 0, y: 0, z: -10 });
    const { msg, contacts } = playOut(world, engine, now, 400);
    expect(msg.reason).toBe("INTO THE NET");
    const net = contacts.find((c) => c.kind === "net")!;
    expect(msg.highlight).toMatchObject({ kind: "net", surface: "net", points: [net.pos] });
  }, PHYSICS_TEST_MS);

  it("on the full marks the wall contact and its material", async () => {
    const world = await PhysicsWorld.create();
    const { engine, now } = rallyAfterReturn();
    world.placeBall({ x: 0, y: 1.5, z: -7 }, { x: 0, y: 1, z: -14 });
    const { msg, contacts } = playOut(world, engine, now, 60);
    const wall = contacts.find((c) => c.kind === "glass")!;
    expect(msg.highlight).toMatchObject({ kind: "wall", surface: "glass", points: [wall.pos] });
  }, PHYSICS_TEST_MS);

  it("out off the bounce marks the exit point, then the last bounce", async () => {
    const world = await PhysicsWorld.create();
    const { engine, now } = rallyAfterReturn();
    // A high kicker: it bounces in A's half and climbs over the back cage.
    world.placeBall({ x: 0, y: 2, z: -6 }, { x: 0, y: -12, z: -6 });
    const { msg, contacts } = playOut(world, engine, now, 400);
    expect(msg.reason).toBe("OUT OFF THE BOUNCE");
    const bounces = floors(contacts);
    const h = msg.highlight!;
    expect(h.kind).toBe("out");
    expect(h.points).toHaveLength(2);
    expect(Math.abs(h.points![0]!.z)).toBeGreaterThan(COURT.length / 2);
    expect(h.points![1]).toEqual(bounces.at(-1));
  }, PHYSICS_TEST_MS);

  it("a serve fault carries the target service box", async () => {
    const world = await PhysicsWorld.create();
    const engine = engineAfterServe();
    // Straight into the wrong (A's own) half: a floor contact outside the box.
    world.placeBall({ x: 2, y: 1, z: -3 }, { x: 0, y: -2, z: 0 });
    const { msg, contacts } = playOut(world, engine, APEX_MS, 60);
    expect(msg.reason).toBe("SERVE OUT — WRONG BOX");
    const landing = contacts.find((c) => c.kind === "floor")!;
    expect(msg.highlight).toMatchObject({
      kind: "out",
      surface: "floor",
      points: [landing.pos],
      box: { side: 1, zNear: 0 },
    });
  }, PHYSICS_TEST_MS);
});

describe("serve reclassifications", () => {
  /** Feed the engine one contact per tick, the ball sitting at each contact. */
  function feed(engine: MatchEngine, contacts: { kind: Contact["kind"]; pos: Vec3 }[]) {
    let now = APEX_MS;
    for (const c of contacts) {
      now += TICK_MS;
      engine.tick(now, c.pos, 5, [c]);
    }
    return engine.toMessage();
  }

  it("a serve off the wall first is a wall fault naming the panel", () => {
    // A1 serves from z < 0 into B's half (z > 0).
    const glass = feed(engineAfterServe(), [{ kind: "glass", pos: { x: 5, y: 1, z: 4 } }]);
    expect(glass.reason).toBe("SERVE HIT THE GLASS FIRST");
    expect(glass.highlight).toMatchObject({ kind: "wall", surface: "glass", points: [{ x: 5, y: 1, z: 4 }] });
    const mesh = feed(engineAfterServe(), [{ kind: "mesh", pos: { x: 5, y: 2.5, z: 8 } }]);
    expect(mesh.reason).toBe("SERVE HIT THE FENCE FIRST");
    expect(mesh.highlight).toMatchObject({ kind: "wall", surface: "mesh" });
  });

  it("a net cord that falls back on the server's side is SERVE INTO THE NET, marked at the net", () => {
    const net = { x: 1, y: 0.9, z: 0 };
    const msg = feed(engineAfterServe(), [
      { kind: "net", pos: net },
      { kind: "floor", pos: { x: 1, y: 0.07, z: -0.6 } },
    ]);
    expect(msg.reason).toBe("SERVE INTO THE NET");
    expect(msg.highlight).toMatchObject({ kind: "net", surface: "net", points: [net] });
  });

  it("a serve landing outside the box on the far side stays SERVE OUT — WRONG BOX", () => {
    const msg = feed(engineAfterServe(), [{ kind: "floor", pos: { x: -2, y: 0.07, z: 3 } }]);
    expect(msg.reason).toBe("SERVE OUT — WRONG BOX");
    expect(msg.highlight).toMatchObject({ kind: "out", surface: "floor" });
  });
});
