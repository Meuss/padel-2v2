import type { MatchMsg, MatchStats, Slot, Team } from "@padel/shared";
import { describe, expect, it } from "vitest";
import { finalModel, truncateName } from "../src/hud/finalcard.js";

const STATS: MatchStats = {
  A: { shots: 120, perfect: 47, smashes: 9, points: 30 },
  B: { shots: 101, perfect: 22, smashes: 4, points: 21 },
  longestRally: 14,
  durationS: 612,
};

function msg(over: Partial<MatchMsg> = {}): MatchMsg {
  return {
    t: "match",
    phase: "over",
    pointA: "0",
    pointB: "0",
    gamesA: 6,
    gamesB: 4,
    tiebreak: false,
    sideA: -1,
    serverSlot: null,
    serveBox: null,
    awaitingServe: false,
    tossing: false,
    event: "SET Y PARTIDO",
    eventKind: "set",
    eventTeam: "A",
    reason: null,
    highlight: null,
    winner: "A",
    stats: STATS,
    ...over,
  };
}

function roster(entries: [Slot, string][]): Map<Slot, { name: string; team: Team }> {
  return new Map(entries.map(([slot, name]) => [slot, { name, team: slot.startsWith("A") ? "A" : "B" }]));
}

const FOUR = roster([
  ["A1", "Alice"],
  ["A2", "Bob"],
  ["B1", "Carla"],
  ["B2", "Dani"],
]);

describe("finalModel", () => {
  it("is null unless the match is over with stats", () => {
    expect(finalModel(msg({ phase: "serve", winner: null }), FOUR)).toBeNull();
    expect(finalModel(msg({ phase: "rally", winner: null }), FOUR)).toBeNull();
    expect(finalModel(msg({ stats: null }), FOUR)).toBeNull();
  });

  it("reads the winner, the set score winner-first and the winners' names", () => {
    const m = finalModel(msg(), FOUR)!;
    expect(m.winner).toBe("A");
    expect(m.setScore).toEqual([6, 4]);
    expect(m.names).toEqual(["Alice", "Bob"]);

    const rojo = finalModel(msg({ winner: "B", eventTeam: "B", gamesA: 5, gamesB: 7 }), FOUR)!;
    expect(rojo.winner).toBe("B");
    expect(rojo.setScore).toEqual([7, 5]);
    expect(rojo.names).toEqual(["Carla", "Dani"]);
  });

  it("falls back to the games, then the points won, when the winner is missing", () => {
    expect(finalModel(msg({ winner: null, gamesA: 3, gamesB: 6 }), FOUR)!.winner).toBe("B");
    const tied = { ...STATS, A: { ...STATS.A, points: 10 }, B: { ...STATS.B, points: 12 } };
    expect(finalModel(msg({ winner: null, gamesA: 6, gamesB: 6, stats: tied }), FOUR)!.winner).toBe("B");
  });

  it("builds the stats rows, Azul then Rojo, with perfect shots as a rounded percentage", () => {
    const m = finalModel(msg(), FOUR)!;
    expect(m.rows).toEqual([
      // 47/120 = 39.17 %, 22/101 = 21.78 %
      { label: "PERFECT SHOTS", a: "39%", b: "22%" },
      { label: "SMASHES", a: "9", b: "4" },
      { label: "LONGEST RALLY", a: "14", b: "14", shared: true },
    ]);
  });

  it("rounds half up and shows a dash for a team without a shot", () => {
    const stats = { ...STATS, A: { ...STATS.A, shots: 8, perfect: 1 }, B: { ...STATS.B, shots: 0, perfect: 0 } };
    const m = finalModel(msg({ stats }), FOUR)!;
    // 1/8 = 12.5 %
    expect(m.rows[0]).toEqual({ label: "PERFECT SHOTS", a: "13%", b: "–" });
  });

  it("truncates long names to 14 characters with an ellipsis", () => {
    const m = finalModel(msg(), roster([["A1", "ABCDEFGHIJKLMNOP"], ["A2", "Fourteen-chars"]]))!;
    expect(m.names).toEqual(["ABCDEFGHIJKLM…", "Fourteen-chars"]);
    expect([...m.names[0]!]).toHaveLength(14);
  });

  it("lists a winning team with a single player, or none left seated", () => {
    expect(finalModel(msg(), roster([["A2", "Solo"]]))!.names).toEqual(["Solo"]);
    expect(finalModel(msg(), roster([["B1", "Carla"]]))!.names).toEqual([]);
  });
});

describe("truncateName", () => {
  it("keeps short names and never splits an emoji", () => {
    expect(truncateName("Ana")).toBe("Ana");
    expect(truncateName("👨‍👩‍👧‍👦".repeat(16))).toBe("👨‍👩‍👧‍👦".repeat(13) + "…");
  });
});
