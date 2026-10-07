import { describe, expect, it } from "vitest";
import { TICK_RATE, type MatchMsg, type ShotEvent, type SnapshotMsg, type Team } from "@padel/shared";
import { Room } from "../src/room.js";
import { fakeClient } from "./fakes.js";

/** A seeded 4-bot match watched by a spectator, run for `seconds` of simulated time. */
async function botMatch(seed: number, seconds: number) {
  const room = await Room.create({ seed });
  const watcher = fakeClient("w1");
  room.addClient(watcher.client);
  room.debugAddBots(4);
  for (let i = 0; i < seconds * TICK_RATE; i++) room.step();
  room.stop();

  const messages = watcher.messages();
  const shots: ShotEvent[] = messages
    .filter((m): m is SnapshotMsg => m.t === "snapshot")
    .flatMap((s) => s.shots ?? []);
  // Each point ends on the first match message that enters "between" or "over".
  const points: { winner: Team; reason: string | null }[] = [];
  let phase = "";
  for (const m of messages.filter((m): m is MatchMsg => m.t === "match")) {
    const ended = (m.phase === "between" || m.phase === "over") && phase !== m.phase;
    if (ended && m.event) points.push({ winner: m.event.includes("Blue") ? "A" : "B", reason: m.reason });
    phase = m.phase;
  }
  return { shots, points };
}

describe("bots use every shot with imperfect timing", () => {
  it("a 2-minute bot match has Drives, Lobs, Smashes and every Timing, with rallies won by both teams", async () => {
    const { shots, points } = await botMatch(1, 120);
    const kinds = new Set(shots.map((s) => s.kind));
    const timings = new Set(shots.filter((s) => s.kind !== "serve").map((s) => s.timing));
    expect([...kinds].sort()).toEqual(["drive", "lob", "serve", "smash"]);
    expect([...timings].sort()).toEqual(["early", "late", "perfect"]);
    expect(points.some((p) => p.winner === "A")).toBe(true);
    expect(points.some((p) => p.winner === "B")).toBe(true);
    expect(points.filter((p) => p.reason?.startsWith("Double hit"))).toEqual([]);
  });

  it("the same seed plays the same match", async () => {
    const a = await botMatch(42, 20);
    const b = await botMatch(42, 20);
    expect(a.shots.length).toBeGreaterThan(0);
    expect(b.shots).toEqual(a.shots);
  });
});
