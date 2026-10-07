import type { MatchMsg } from "@padel/shared";
import { describe, expect, it } from "vitest";
import { bugModel } from "../src/hud/scorebug.js";

function msg(over: Partial<MatchMsg> = {}): MatchMsg {
  return {
    t: "match",
    phase: "serve",
    pointA: "0",
    pointB: "0",
    gamesA: 0,
    gamesB: 0,
    tiebreak: false,
    sideA: -1,
    serverSlot: "A1",
    serveBox: "deuce",
    awaitingServe: true,
    tossing: false,
    event: null,
    eventKind: null,
    eventTeam: null,
    reason: null,
    highlight: null,
    winner: null,
    stats: null,
    ...over,
  };
}

describe("bugModel", () => {
  it("shows the warm-up without team rows", () => {
    const m = bugModel(msg({ phase: "warmup", serverSlot: null }), null);
    expect(m.rows).toBeNull();
    expect(m.header).toBe("MEUSS PADEL CLUB");
    expect(m.call).toBeNull();
  });

  it("treats no match yet like the warm-up", () => {
    expect(bugModel(null, null)).toEqual({ header: "MEUSS PADEL CLUB", tiebreak: false, rows: null, call: null, rally: false });
  });

  it("lays out AZUL then ROJO with games and point labels", () => {
    const m = bugModel(msg({ gamesA: 3, gamesB: 2, pointA: "30", pointB: "15", phase: "rally" }), null);
    expect(m.header).toBe("MEUSS PADEL CLUB");
    expect(m.tiebreak).toBe(false);
    expect(m.rows).toEqual([
      { team: "A", label: "AZUL", games: 3, points: "30", serving: true },
      { team: "B", label: "ROJO", games: 2, points: "15", serving: false },
    ]);
  });

  it("marks the serving team from the server slot", () => {
    const m = bugModel(msg({ serverSlot: "B2" }), null);
    expect(m.rows?.map((r) => r.serving)).toEqual([false, true]);
  });

  it("flags a tiebreak and shows tiebreak points", () => {
    const m = bugModel(msg({ tiebreak: true, gamesA: 6, gamesB: 6, pointA: "4", pointB: "3" }), null);
    expect(m.tiebreak).toBe(true);
    expect(m.rows?.map((r) => r.points)).toEqual(["4", "3"]);
  });

  it("reads FINAL once the match is over, with nobody serving", () => {
    const m = bugModel(
      msg({ phase: "over", gamesA: 6, gamesB: 4, winner: "A", eventKind: "set", eventTeam: "A" }),
      msg({ phase: "rally", gamesA: 5, gamesB: 4, pointA: "40" }),
    );
    expect(m.header).toBe("FINAL");
    expect(m.rows?.every((r) => !r.serving)).toBe(true);
    expect(m.call).toBeNull();
  });

  it("calls the score, server's score first, on the transition where a point is won", () => {
    const prev = msg({ phase: "rally", serverSlot: "B1", pointA: "15", pointB: "15" });
    const next = msg({ phase: "between", serverSlot: "B1", pointA: "30", pointB: "15", eventKind: "point", eventTeam: "A" });
    expect(bugModel(next, prev).call).toBe("QUINCE – TREINTA");
  });

  it("does not repeat the call on later messages of the same point", () => {
    const won = msg({ phase: "between", pointA: "15", eventKind: "point", eventTeam: "A" });
    const serve = msg({ phase: "serve", pointA: "15", eventKind: "point", eventTeam: "A" });
    expect(bugModel(serve, won).call).toBeNull();
    expect(bugModel(won, null).call).toBeNull();
  });

  it("calls the score for a double fault that hands over the point", () => {
    const prev = msg({ phase: "serve", pointA: "0", pointB: "0" });
    const next = msg({ phase: "between", pointA: "0", pointB: "15", eventKind: "fault", eventTeam: "B" });
    expect(bugModel(next, prev).call).toBe("NADA – QUINCE");
  });

  it("does not call a game, a first-serve fault or a reset", () => {
    const prev = msg({ pointA: "40", pointB: "15" });
    expect(bugModel(msg({ gamesA: 1, eventKind: "game", eventTeam: "A" }), prev).call).toBeNull();
    expect(bugModel(msg({ pointA: "40", pointB: "15", eventKind: "fault" }), prev).call).toBeNull();
    expect(bugModel(msg({ eventKind: "reset" }), prev).call).toBeNull();
  });

  it("calls tiebreak points as numbers, server's first", () => {
    const prev = msg({ tiebreak: true, gamesA: 6, gamesB: 6, serverSlot: "A2", pointA: "3", pointB: "2" });
    const next = msg({ ...prev, pointA: "4", eventKind: "point", eventTeam: "A", phase: "between" });
    expect(bugModel(next, prev).call).toBe("4 – 2");
    expect(bugModel({ ...next, serverSlot: "B1" }, { ...prev, serverSlot: "B1" }).call).toBe("2 – 4");
  });

  it("calls 40-40 the golden point", () => {
    const prev = msg({ phase: "rally", pointA: "40", pointB: "30" });
    const next = msg({ phase: "between", pointA: "40", pointB: "40", eventKind: "point", eventTeam: "B" });
    expect(bugModel(next, prev).call).toBe("PUNTO DE ORO");
  });

  it("calls an equal score below 40 IGUALES", () => {
    const prev = msg({ phase: "rally", serverSlot: "B1", pointA: "0", pointB: "15" });
    const next = msg({ phase: "between", serverSlot: "B1", pointA: "15", pointB: "15", eventKind: "point", eventTeam: "A" });
    expect(bugModel(next, prev).call).toBe("QUINCE IGUALES");
  });

  it("flags the rally so the call strip hides", () => {
    expect(bugModel(msg({ phase: "rally" }), null).rally).toBe(true);
    expect(bugModel(msg({ phase: "between" }), null).rally).toBe(false);
    expect(bugModel(msg({ phase: "serve" }), null).rally).toBe(false);
  });
});
