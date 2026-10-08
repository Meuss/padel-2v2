import { describe, expect, it } from "vitest";
import { TICK_RATE, type MatchMsg, type ShotEvent, type ShotKind, type SnapshotMsg, type Team } from "@padel/shared";
import { Room } from "../src/room.js";
import { fakeClient } from "./fakes.js";

const POINT_ORDER = ["0", "15", "30", "40", "Ad"];
/** A team's score as one comparable number: games first, then the point label (or tiebreak count). */
const scoreOf = (m: MatchMsg, team: Team) => {
  const games = team === "A" ? m.gamesA : m.gamesB;
  const label = team === "A" ? m.pointA : m.pointB;
  return games * 100 + (m.tiebreak ? Number(label) : POINT_ORDER.indexOf(label));
};

/** Several simulated minutes of physics per test: room on a loaded CI machine. */
const LONG_TEST_MS = 30_000;

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
  // `lastShot` is the kind of the last Shot struck before the point ended.
  const points: { winner: Team; reason: string | null; lastShot: ShotKind | null }[] = [];
  let phase = "";
  let before: MatchMsg | null = null;
  let lastShot: ShotKind | null = null;
  for (const m of messages) {
    if (m.t === "snapshot") {
      for (const s of m.shots ?? []) lastShot = s.kind;
      continue;
    }
    if (m.t !== "match") continue;
    const ended = (m.phase === "between" || m.phase === "over") && phase !== m.phase;
    if (ended && before) {
      const winner: Team = scoreOf(m, "A") > scoreOf(before, "A") ? "A" : "B";
      points.push({ winner, reason: m.reason, lastShot });
    }
    if (ended) lastShot = null;
    if (m.phase === "serve") before = m;
    phase = m.phase;
  }
  return { shots, points };
}

describe("bots use every shot with imperfect timing", () => {
  it("a 5-minute bot match has Drives, Lobs and every Timing, with rallies won by both teams", async () => {
    // Rallies run long (and notable points wait for their replay): five minutes see both teams score.
    const { shots, points } = await botMatch(1, 300);
    const kinds = new Set(shots.map((s) => s.kind));
    const timings = new Set(shots.filter((s) => s.kind !== "serve").map((s) => s.timing));
    expect(kinds).toContain("drive");
    expect(kinds).toContain("lob");
    expect(kinds).toContain("serve");
    expect([...timings].sort()).toEqual(["early", "late", "perfect"]);
    expect(points.some((p) => p.winner === "A")).toBe(true);
    expect(points.some((p) => p.winner === "B")).toBe(true);
    expect(points.filter((p) => p.reason?.startsWith("DOUBLE HIT"))).toEqual([]);
  }, LONG_TEST_MS);

  it("bots Smash high balls: a Smash appears in at least 3 of 5 seeded 2-minute matches", async () => {
    let withSmash = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const { shots } = await botMatch(seed, 120);
      if (shots.some((s) => s.kind === "smash")) withSmash++;
    }
    expect(withSmash).toBeGreaterThanOrEqual(3);
  }, LONG_TEST_MS);

  it("bot Smashes go down the middle: none of 5 seeded matches ends a point on the glass on the full", async () => {
    let smashes = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const { shots, points } = await botMatch(seed, 120);
      smashes += shots.filter((s) => s.kind === "smash").length;
      const afterSmash = points.filter((p) => p.lastShot === "smash");
      expect(afterSmash.filter((p) => p.reason?.startsWith("HIT THE"))).toEqual([]);
    }
    expect(smashes).toBeGreaterThan(0);
  }, LONG_TEST_MS);

  it("bots aim inside the cage: under 10% of points in 5 seeded 3-minute matches end on the full", async () => {
    const reasons: (string | null)[] = [];
    for (const seed of [1, 2, 3, 4, 5]) reasons.push(...(await botMatch(seed, 180)).points.map((p) => p.reason));
    expect(reasons.length).toBeGreaterThanOrEqual(20);
    const onTheFull = reasons.filter((r) => r?.endsWith("ON THE FULL")).length;
    expect(onTheFull / reasons.length).toBeLessThan(0.1);
  }, LONG_TEST_MS);

  it("bots rarely net: INTO THE NET ends under 35% of points in 5 seeded 3-minute matches", async () => {
    const reasons: (string | null)[] = [];
    for (const seed of [1, 2, 3, 4, 5]) reasons.push(...(await botMatch(seed, 180)).points.map((p) => p.reason));
    expect(reasons.length).toBeGreaterThanOrEqual(20);
    const intoTheNet = reasons.filter((r) => r === "INTO THE NET").length;
    expect(intoTheNet / reasons.length).toBeLessThan(0.35);
  }, LONG_TEST_MS);

  it("the same seed plays the same match", async () => {
    const a = await botMatch(42, 20);
    const b = await botMatch(42, 20);
    expect(a.shots.length).toBeGreaterThan(0);
    expect(b.shots).toEqual(a.shots);
  });
});
