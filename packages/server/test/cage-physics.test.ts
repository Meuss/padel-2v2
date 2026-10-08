import { describe, expect, it } from "vitest";
import { BALL, COURT, TICK_MS, TOSS, netHeightAt, type Vec3 } from "@padel/shared";
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

const isWallKind = (c: Contact) => c.kind === "glass" || c.kind === "mesh";

/** Step `ticks` times, collecting every contact and the ball's state after each step. */
function track(world: PhysicsWorld, ticks: number) {
  const steps: { contacts: Contact[]; pos: Vec3; vel: Vec3 }[] = [];
  for (let i = 0; i < ticks; i++) {
    const contacts = world.step();
    steps.push({ contacts, ...world.ballState() });
  }
  return steps;
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

  it("the walls' faces are on the court's edge: a ball rolling into the side glass turns at 5 m minus its radius", async () => {
    const world = await PhysicsWorld.create();
    world.placeBall({ x: 3.5, y: BALL.radius, z: 9 }, { x: 4, y: 0, z: 0 });
    const steps = track(world, 90);
    // Rapier's soft contacts let the ball sink up to ~3 cm into a face before it turns.
    const SINK = 0.035;
    const maxX = Math.max(...steps.map((s) => s.pos.x));
    expect(maxX).toBeGreaterThan(COURT.width / 2 - BALL.radius - 0.02);
    expect(maxX).toBeLessThan(COURT.width / 2 - BALL.radius + SINK);
    expect(steps.at(-1)!.vel.x).toBeLessThan(0);
    expect(steps.flatMap((s) => s.contacts).find(isWallKind)?.kind).toBe("glass");

    // The same at the back glass: the ball turns at 10 m minus its radius.
    world.placeBall({ x: 0, y: BALL.radius, z: 8.5 }, { x: 0, y: 0, z: 4 });
    const back = track(world, 90);
    const maxZ = Math.max(...back.map((s) => s.pos.z));
    expect(maxZ).toBeGreaterThan(COURT.length / 2 - BALL.radius - 0.02);
    expect(maxZ).toBeLessThan(COURT.length / 2 - BALL.radius + SINK);
  }, PHYSICS_TEST_MS);

  it("the net sags: a ball skimming 0.90 m clears it in the middle but hits it by the posts", async () => {
    // The ball's underside passes the net plane at 0.90 m: above the 0.88 m centre, below
    // the net's 0.918 m at x = ±4.9.
    const throwAt = async (x: number) => {
      const world = await PhysicsWorld.create();
      const vz = 10;
      const t = (0.3 - BALL.radius) / vz; // until the ball's front reaches the net plane
      world.placeBall({ x, y: 0.9 + BALL.radius + 0.5 * 9.81 * t * t, z: -0.3 }, { x: 0, y: 0, z: vz });
      const steps = track(world, 20);
      return { net: steps.some((s) => s.contacts.some((c) => c.kind === "net")), z: steps.at(-1)!.pos.z };
    };
    expect(netHeightAt(4.9)).toBeGreaterThan(0.91);
    const middle = await throwAt(0);
    expect(middle.net).toBe(false);
    expect(middle.z).toBeGreaterThan(1);
    for (const x of [-4.9, 4.9]) {
      const edge = await throwAt(x);
      expect(edge.net).toBe(true);
      expect(edge.z).toBeLessThan(0.5);
    }
  }, PHYSICS_TEST_MS);

  it("seams: a ball grazing along the side wall across z = 6 and z = 8 slides on, one wall contact a tick", async () => {
    const world = await PhysicsWorld.create();
    for (const z0 of [5, 7]) {
      // Pressed lightly against the right wall at 1.5 m (glass/mesh seam at z = 6, glass/glass at 8).
      world.placeBall({ x: COURT.width / 2 - BALL.radius - 0.005, y: 1.5, z: z0 }, { x: 0.3, y: 2.5, z: 6 });
      const steps = track(world, 20); // 2 m along the wall
      for (const s of steps) expect(s.contacts.filter(isWallKind).length).toBeLessThanOrEqual(1);
      const crossed = steps.filter((s) => s.pos.z > z0 + 1.2);
      expect(crossed.length).toBeGreaterThan(0);
      for (const s of crossed) {
        expect(s.vel.z).toBeGreaterThan(5); // no ghost bump off the seam's edge
        expect(s.pos.x).toBeLessThan(COURT.width / 2);
      }
    }
  }, PHYSICS_TEST_MS);

  it("seams: a ball into the back wall at the 3 m glass/mesh seam reports one contact and rebounds", async () => {
    const world = await PhysicsWorld.create();
    const vz = 12;
    const face = COURT.length / 2 - BALL.radius;
    const t = (face - 8) / vz;
    world.placeBall({ x: 0, y: 3, z: 8 }, { x: 0, y: 0.5 * 9.81 * t, z: vz });
    const steps = track(world, 30);
    const walls = steps.flatMap((s) => s.contacts.filter(isWallKind));
    expect(walls).toHaveLength(1);
    expect(Math.abs(walls[0]!.pos.y - 3)).toBeLessThan(0.05);
    expect(steps.at(-1)!.vel.z).toBeLessThan(0);
  }, PHYSICS_TEST_MS);
});
