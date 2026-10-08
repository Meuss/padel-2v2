import { describe, expect, it } from "vitest";
import { TICK_MS, TOSS, type Vec3 } from "@padel/shared";
import { MatchEngine } from "../src/match.js";
import { PhysicsWorld, type Contact } from "../src/world.js";

/** A few seconds of physics per test. */
const PHYSICS_TEST_MS = 15_000;

/** Throw the ball and step until its first wall contact; return it and the velocity just after. */
function firstWallHit(world: PhysicsWorld, pos: Vec3, vel: Vec3) {
  world.placeBall(pos, vel);
  for (let i = 0; i < 120; i++) {
    const wall = world.step().find((c: Contact) => c.kind === "glass" || c.kind === "mesh");
    if (wall) {
      for (let j = 0; j < 3; j++) world.step(); // let the rebound resolve
      return { contact: wall, after: world.ballState().vel };
    }
  }
  throw new Error("the ball never reached a wall");
}

/** A rally after B1 returns A1's serve: B (side +1) is the hitter, aiming at A's half (z < 0). */
function rallyAfterReturn() {
  const engine = new MatchEngine();
  engine.setRoster(
    [
      { slot: "A1", team: "A" },
      { slot: "B1", team: "B" },
    ],
    0,
  );
  expect(engine.startToss("A1", 0)).toBe(true);
  const apexMs = (TOSS.vy / 9.81) * 1000;
  expect(engine.strikeServe("A1", apexMs, { x: 2, z: 3 })).not.toBeNull();
  expect(engine.hit("B1", "B", apexMs + 500)).toBe(true);
  return { engine, now: apexMs + 500 };
}

/** Run physics and the engine together until the point ends (or `ticks` run out). */
function playOut(world: PhysicsWorld, engine: MatchEngine, start: number, ticks: number) {
  let now = start;
  const contacts: Contact[] = [];
  for (let i = 0; i < ticks && engine.phase === "rally"; i++) {
    now += TICK_MS;
    const cs = world.step();
    contacts.push(...cs);
    engine.tick(now, world.ballPosition(), world.ballSpeed(), cs.map((c) => c.kind));
  }
  return { msg: engine.toMessage(), contacts };
}

describe("the regulation cage in the physics world", () => {
  it("a ball into the central side mesh at 2.5 m rebounds slower than off the back glass", async () => {
    const world = await PhysicsWorld.create();
    const mesh = firstWallHit(world, { x: 2, y: 2.5, z: 0 }, { x: 12, y: 0, z: 0 });
    const glass = firstWallHit(world, { x: 0, y: 2.5, z: 7 }, { x: 0, y: 0, z: 12 });
    expect(mesh.contact.kind).toBe("mesh");
    expect(glass.contact.kind).toBe("glass");
    // Rebounding back into the court, the mesh slower than the glass.
    expect(mesh.after.x).toBeLessThan(0);
    expect(glass.after.z).toBeLessThan(0);
    expect(Math.abs(mesh.after.x)).toBeLessThan(Math.abs(glass.after.z) * 0.85);

    // Deterministic: the same throw in a fresh world rebounds exactly the same way.
    const again = firstWallHit(await PhysicsWorld.create(), { x: 2, y: 2.5, z: 0 }, { x: 12, y: 0, z: 0 });
    expect(again.after).toEqual(mesh.after);
  }, PHYSICS_TEST_MS);

  it("the stepped side glass is glass to 2 m and mesh above, at 2-4 m from the back wall", async () => {
    const world = await PhysicsWorld.create();
    expect(firstWallHit(world, { x: 2, y: 1.5, z: 7 }, { x: 12, y: 0, z: 0 }).contact.kind).toBe("glass");
    expect(firstWallHit(world, { x: 2, y: 2.5, z: 7 }, { x: 12, y: 0, z: 0 }).contact.kind).toBe("mesh");
    expect(firstWallHit(world, { x: 2, y: 3.5, z: 8 }, { x: 0, y: 0, z: 12 }).contact.kind).toBe("mesh"); // above the back glass
  }, PHYSICS_TEST_MS);

  it("a ball over the 3 m side mesh in the middle leaves the cage: OUT — OVER THE CAGE", async () => {
    const world = await PhysicsWorld.create();
    const { engine, now } = rallyAfterReturn();
    world.placeBall({ x: 3, y: 3.3, z: -2 }, { x: 8, y: 1.2, z: -0.5 });
    const { msg, contacts } = playOut(world, engine, now, 120);
    expect(contacts.filter((c) => c.kind === "glass" || c.kind === "mesh")).toEqual([]);
    expect(msg.phase).toBe("between");
    expect(msg.reason).toBe("OUT — OVER THE CAGE");
    expect(msg.pointA).toBe("15"); // the hitter (B) loses the point
  }, PHYSICS_TEST_MS);

  it("the same ball by the back wall rebounds off the 4 m corner mesh instead", async () => {
    const world = await PhysicsWorld.create();
    const { engine, now } = rallyAfterReturn();
    world.placeBall({ x: 3, y: 3.3, z: -9 }, { x: 8, y: 1.2, z: -0.2 });
    const { msg, contacts } = playOut(world, engine, now, 20);
    expect(contacts.map((c) => c.kind)).toContain("mesh");
    expect(msg.reason).toBe("HIT THE FENCE ON THE FULL");
    for (let i = 0; i < 3; i++) world.step(); // let the rebound resolve
    expect(world.ballState().vel.x).toBeLessThan(0);
    expect(Math.abs(world.ballPosition().x)).toBeLessThan(5);
  }, PHYSICS_TEST_MS);

  it("on the full: the reason names the glass or the fence by the material it hit", async () => {
    {
      const world = await PhysicsWorld.create();
      const { engine, now } = rallyAfterReturn();
      world.placeBall({ x: 0, y: 1.5, z: -7 }, { x: 0, y: 1, z: -14 });
      expect(playOut(world, engine, now, 60).msg.reason).toBe("HIT THE GLASS ON THE FULL");
    }
    {
      const world = await PhysicsWorld.create();
      const { engine, now } = rallyAfterReturn();
      world.placeBall({ x: 2, y: 1.5, z: -3 }, { x: 12, y: 1, z: 0 });
      expect(playOut(world, engine, now, 60).msg.reason).toBe("HIT THE FENCE ON THE FULL");
    }
  }, PHYSICS_TEST_MS);
});
