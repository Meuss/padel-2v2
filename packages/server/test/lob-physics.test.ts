import { describe, expect, it } from "vitest";
import { SHOT, TICK_RATE, shotVelocity, type Timing } from "@padel/shared";
import { PhysicsWorld } from "../src/world.js";

/** Launch a Lob from `distToNet` behind the net (z < 0) at height y; return how far past the net it first lands. */
async function lobLandsPastNet(distToNet: number, y: number, timing: Timing): Promise<number> {
  const world = await PhysicsWorld.create();
  const v = shotVelocity("lob", timing, { x: 0, z: 1 }, { y, distToNet });
  world.placeBall({ x: 0, y, z: -distToNet }, v);
  for (let i = 0; i < 5 * TICK_RATE; i++) {
    const contacts = world.step();
    const floor = contacts.find((c) => c.kind === "floor");
    if (floor) return floor.pos.z;
    if (contacts.length > 0) throw new Error(`hit the ${contacts[0]!.kind} before the floor`);
  }
  throw new Error("never landed");
}

describe("distance-aware Lob through the physics world", () => {
  it("a perfect Lob from 9 m back lands 5-9.5 m past the net", async () => {
    const past = await lobLandsPastNet(9, 0.5, "perfect");
    expect(past).toBeGreaterThan(5);
    expect(past).toBeLessThan(9.5);
  });

  it("early and late Lobs from 9 m back clear the net and land in the opponents' half, short and long", async () => {
    const perfect = await lobLandsPastNet(9, 0.5, "perfect");
    const early = await lobLandsPastNet(9, 0.5, "early");
    const late = await lobLandsPastNet(9, 0.5, "late");
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(perfect);
    expect(late).toBeGreaterThan(perfect);
    expect(late).toBeLessThan(SHOT.lobDepthPastNet + SHOT.offTiming.lobDepthErrorM + 1);
  });
});
