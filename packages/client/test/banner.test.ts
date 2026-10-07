import type { MatchMsg } from "@padel/shared";
import { describe, expect, it } from "vitest";
import { BANNER_MS, BannerQueue, bannerForMatch, type BannerItem } from "../src/hud/banner.js";

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

const item = (title: string, durationMs = 1000): BannerItem => ({
  copy: { title, sub: null, tone: "neutral", team: null },
  durationMs,
});

describe("BannerQueue", () => {
  it("shows nothing until a Banner arrives", () => {
    expect(new BannerQueue().current(0)).toBeNull();
  });

  it("holds a Banner for its duration, then expires it", () => {
    const q = new BannerQueue();
    const a = item("JUEGO", 2200);
    q.show(a, 1000);
    expect(q.current(1000)).toBe(a);
    expect(q.current(3199)).toBe(a);
    expect(q.current(3200)).toBeNull();
    expect(q.current(5000)).toBeNull();
  });

  it("replaces the Banner on screen and never stacks", () => {
    const q = new BannerQueue();
    const a = item("FALTA", 1600);
    const b = item("JUEGO", 2200);
    q.show(a, 0);
    q.show(b, 500);
    expect(q.current(600)).toBe(b);
    // The replacement runs its full duration from when it arrived…
    expect(q.current(2699)).toBe(b);
    // …and once it expires the earlier Banner does not come back.
    expect(q.current(2700)).toBeNull();
  });

  it("keeps a Banner with no end until it is replaced or cleared", () => {
    const q = new BannerQueue();
    const set = item("SET Y PARTIDO", Infinity);
    q.show(set, 0);
    expect(q.current(600_000)).toBe(set);
    q.clear();
    expect(q.current(600_001)).toBeNull();
  });
});

describe("Banner durations", () => {
  it("is 1.6 s for a fault or let and 2.2 s for a game, start or reset", () => {
    expect(BANNER_MS.fault).toBe(1600);
    expect(BANNER_MS.let).toBe(1600);
    expect(BANNER_MS.game).toBe(2200);
    expect(BANNER_MS.start).toBe(2200);
    expect(BANNER_MS.reset).toBe(2200);
  });

  it("keeps the Set Banner up until the Final card takes over", () => {
    expect(BANNER_MS.set).toBe(Infinity);
  });
});

describe("bannerForMatch", () => {
  const rally = msg({ phase: "rally", awaitingServe: false });

  it("is null without a new event", () => {
    expect(bannerForMatch(msg(), rally)).toBeNull();
    const fault = msg({ phase: "between", event: "FALTA", eventKind: "fault", reason: "Into the net" });
    // The same event re-sent (another field changed) is not a new Banner.
    expect(bannerForMatch({ ...fault, awaitingServe: false }, fault)).toBeNull();
  });

  it("waits for a previous state, so joining mid-break shows no stale Banner", () => {
    expect(bannerForMatch(msg({ event: "JUEGO — AZUL", eventKind: "game", eventTeam: "A", gamesA: 1 }), null)).toBeNull();
  });

  it("gives a game its Banner and duration", () => {
    const b = bannerForMatch(msg({ event: "JUEGO — AZUL", eventKind: "game", eventTeam: "A", gamesA: 3, gamesB: 2 }), rally);
    expect(b).toEqual({
      copy: { title: "JUEGO", sub: "AZUL 3 – 2 ROJO", tone: "team", team: "A" },
      durationMs: 2200,
    });
  });

  it("gives a fault the short duration", () => {
    const b = bannerForMatch(msg({ phase: "between", event: "FALTA", eventKind: "fault", reason: "Into the net" }), rally);
    expect(b?.copy.title).toBe("FALTA");
    expect(b?.copy.tone).toBe("fault");
    expect(b?.durationMs).toBe(1600);
  });

  it("gives a plain point no Banner", () => {
    const m = msg({ phase: "between", event: "PUNTO — AZUL", eventKind: "point", eventTeam: "A", pointA: "30", pointB: "15" });
    expect(bannerForMatch(m, rally)).toBeNull();
  });

  it("calls PUNTO DE ORO when a point makes it 40–40", () => {
    const m = msg({
      phase: "between",
      event: "PUNTO — ROJO",
      eventKind: "point",
      eventTeam: "B",
      pointA: "40",
      pointB: "40",
      gamesA: 5,
      gamesB: 4,
    });
    expect(bannerForMatch(m, rally)).toEqual({
      copy: { title: "PUNTO DE ORO", sub: "AZUL 5 – 4 ROJO · 40 – 40", tone: "neutral", team: null },
      durationMs: 2200,
    });
  });

  it("calls PUNTO DE ORO when a double fault makes it 40–40", () => {
    const m = msg({ event: "DOBLE FALTA", eventKind: "fault", eventTeam: "B", pointA: "40", pointB: "40" });
    expect(bannerForMatch(m, rally)?.copy.title).toBe("PUNTO DE ORO");
  });

  it("does not call PUNTO DE ORO in a tiebreak", () => {
    const m = msg({ event: "PUNTO — AZUL", eventKind: "point", eventTeam: "A", pointA: "40", pointB: "40", tiebreak: true });
    expect(bannerForMatch(m, rally)).toBeNull();
  });
});
