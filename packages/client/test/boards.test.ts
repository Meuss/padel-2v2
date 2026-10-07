import { describe, expect, it } from "vitest";
import { boardMessages, teamFromEvent, type BoardState } from "../src/world/boards.js";

const inMatch: BoardState = {
  phase: "rally",
  gamesA: 3,
  gamesB: 2,
  pointA: "30",
  pointB: "15",
  names: ["Ana", "Bot Heidi", "Leo", "Bot Mr Bean"],
  reaction: null,
};

describe("boardMessages", () => {
  it("shows the club name and warm-up before a match", () => {
    expect(
      boardMessages({ ...inMatch, phase: "warmup", gamesA: 0, gamesB: 0, pointA: "0", pointB: "0" }),
    ).toEqual(["MEUSS PADEL CLUB", "WARM-UP"]);
  });

  it("shows games, points and the seated names in a match", () => {
    expect(boardMessages(inMatch)).toEqual([
      "MEUSS PADEL CLUB",
      "AZUL 3 · 2 ROJO",
      "30 – 15",
      "ANA · BOT HEIDI  VS  LEO · BOT MR BEAN",
    ]);
  });

  it("appends the current reaction as a final shout", () => {
    const msgs = boardMessages({ ...inMatch, reaction: "gg" });
    expect(msgs.at(-1)).toBe("GG!");
    expect(msgs).toHaveLength(5);
  });

  it("puts FINAL right after the club name when the match is over", () => {
    const msgs = boardMessages({ ...inMatch, phase: "over" });
    expect(msgs[0]).toBe("MEUSS PADEL CLUB");
    expect(msgs[1]).toBe("FINAL");
    expect(msgs[2]).toBe("AZUL 3 · 2 ROJO");
  });

  it("uppercases names and never emits empty strings", () => {
    const msgs = boardMessages({ ...inMatch, names: ["ana", "", "  ", ""] });
    expect(msgs).not.toContain("");
    expect(msgs.at(-1)).toBe("ANA");
    expect(boardMessages({ ...inMatch, names: [] })).toEqual([
      "MEUSS PADEL CLUB",
      "AZUL 3 · 2 ROJO",
      "30 – 15",
    ]);
  });
});

describe("teamFromEvent", () => {
  it("maps the winner named in point, game and match events to a team", () => {
    expect(teamFromEvent("Point — Blue")).toBe("A");
    expect(teamFromEvent("Point — Red")).toBe("B");
    expect(teamFromEvent("Game — Red (2-3)")).toBe("B");
    expect(teamFromEvent("Set & Match — Blue! (6-4)")).toBe("A");
  });

  it("returns null for events that have no winner", () => {
    expect(teamFromEvent("Set reset")).toBeNull();
    expect(teamFromEvent("Match start")).toBeNull();
    expect(teamFromEvent("Fault — second serve")).toBeNull();
    expect(teamFromEvent(null)).toBeNull();
  });
});
