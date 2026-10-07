import { describe, expect, it } from "vitest";
import { TICK_RATE, type MatchMsg, type ShotEvent, type SnapshotMsg, type Team } from "@padel/shared";
import { Room } from "../src/room.js";
import { fakeClient } from "./fakes.js";

const POINT_ORDER = ["0", "15", "30", "40", "Ad"];
/** A team's score as one comparable number: games first, then the point label (or tiebreak count). */
const scoreOf = (m: MatchMsg, team: Team) => {
  const games = team === "A" ? m.gamesA : m.gamesB;
  const label = team === "A" ? m.pointA : m.pointB;
  return games * 100 + (m.tiebreak ? Number(label) : POINT_ORDER.indexOf(label));
};

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
  // A point ends on the first match message entering "between" or "over"; its winner is the
  // team whose score went up since the previous point ended.
  const points: { winner: Team; reason: string | null }[] = [];
  let phase = "";
  let before: MatchMsg | null = null;
  for (const m of messages.filter((m): m is MatchMsg => m.t === "match")) {
    const ended = (m.phase === "between" || m.phase === "over") && phase !== m.phase;
    if (ended && before) {
      const winner: Team = scoreOf(m, "A") > scoreOf(before, "A") ? "A" : "B";
      points.push({ winner, reason: m.reason });
    }
    if (m.phase === "serve") before = m;
    phase = m.phase;
  }
  return { shots, points };
}

describe("bots use every shot with imperfect timing", () => {
  it("a 2-minute bot match has Drives, Lobs and every Timing, with rallies won by both teams", async () => {
    const { shots, points } = await botMatch(1, 120);
    const kinds = new Set(shots.map((s) => s.kind));
    const timings = new Set(shots.filter((s) => s.kind !== "serve").map((s) => s.timing));
    expect(kinds).toContain("drive");
    expect(kinds).toContain("lob");
    expect(kinds).toContain("serve");
    expect([...timings].sort()).toEqual(["early", "late", "perfect"]);
    expect(points.some((p) => p.winner === "A")).toBe(true);
    expect(points.some((p) => p.winner === "B")).toBe(true);
    expect(points.filter((p) => p.reason?.startsWith("Double hit"))).toEqual([]);
  });

  it("bots Smash high balls: a Smash appears in at least 3 of 5 seeded 2-minute matches", async () => {
    let withSmash = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const { shots } = await botMatch(seed, 120);
      if (shots.some((s) => s.kind === "smash")) withSmash++;
    }
    expect(withSmash).toBeGreaterThanOrEqual(3);
  });

  it("the same seed plays the same match", async () => {
    const a = await botMatch(42, 20);
    const b = await botMatch(42, 20);
    expect(a.shots.length).toBeGreaterThan(0);
    expect(b.shots).toEqual(a.shots);
  });
});
