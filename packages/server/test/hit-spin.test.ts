import { describe, expect, it } from "vitest";
import { TICK_RATE } from "@padel/shared";
import { PhysicsWorld } from "../src/world.js";

describe("a hit clears the ball's spin", () => {
  it("a spun ball given a new velocity bounces exactly like a fresh one", async () => {
    // Skid the ball along the floor so friction spins it up.
    const spun = await PhysicsWorld.create();
    spun.placeBall({ x: 0, y: 0.3, z: -4 }, { x: 6, y: -4, z: 2 });
    for (let i = 0; i < TICK_RATE / 2; i++) spun.step();
    const at = spun.ballPosition();
    const vel = { x: -1, y: -3, z: 5 }; // a hit that sends it into the floor again

    const fresh = await PhysicsWorld.create();
    fresh.placeBall(at, vel);
    spun.setBallVelocity(vel.x, vel.y, vel.z);
    for (let i = 0; i < TICK_RATE; i++) {
      spun.step();
      fresh.step();
    }
    const a = spun.ballPosition();
    const b = fresh.ballPosition();
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-4);
  });
});
