import { describe, expect, it } from "vitest";
import { bannerFor, scoreCall, teamLabel } from "../src/hud/copy.js";

describe("teamLabel", () => {
  it("names team A AZUL and team B ROJO", () => {
    expect(teamLabel("A")).toBe("AZUL");
    expect(teamLabel("B")).toBe("ROJO");
  });
});

describe("scoreCall", () => {
  it.each([
    ["15", "0", "FIFTEEN – LOVE"],
    ["0", "30", "LOVE – THIRTY"],
    ["40", "15", "FORTY – FIFTEEN"],
    ["30", "40", "THIRTY – FORTY"],
  ])("calls %s-%s as %s", (s, r, call) => {
    expect(scoreCall(s, r, false)).toBe(call);
  });

  it("puts the server's score first", () => {
    expect(scoreCall("0", "15", false)).toBe("LOVE – FIFTEEN");
    expect(scoreCall("15", "0", false)).toBe("FIFTEEN – LOVE");
  });

  it("calls equal scores below 40 ALL", () => {
    expect(scoreCall("0", "0", false)).toBe("LOVE ALL");
    expect(scoreCall("15", "15", false)).toBe("FIFTEEN ALL");
    expect(scoreCall("30", "30", false)).toBe("THIRTY ALL");
  });

  it("calls deuce GOLDEN POINT", () => {
    expect(scoreCall("40", "40", false)).toBe("GOLDEN POINT");
  });

  it("calls a tiebreak in digits, server first, even when level", () => {
    expect(scoreCall("5", "3", true)).toBe("5 – 3");
    expect(scoreCall("2", "6", true)).toBe("2 – 6");
    expect(scoreCall("4", "4", true)).toBe("4 – 4");
  });
});

describe("bannerFor", () => {
  it("gives points no banner", () => {
    expect(bannerFor("point", "A", 0, 0, null)).toBeNull();
  });

  it("calls a game with the games line, Azul first", () => {
    expect(bannerFor("game", "A", 4, 3, null)).toEqual({
      title: "GAME",
      sub: "AZUL 4 – 3 ROJO",
      tone: "team",
      team: "A",
    });
    expect(bannerFor("game", "B", 2, 5, null)).toEqual({
      title: "GAME",
      sub: "AZUL 2 – 5 ROJO",
      tone: "team",
      team: "B",
    });
  });

  it("calls the set with the winner and the winner's games first", () => {
    expect(bannerFor("set", "B", 4, 6, null)).toEqual({
      title: "SET & MATCH",
      sub: "ROJO WINS 6 – 4",
      tone: "team",
      team: "B",
    });
    expect(bannerFor("set", "A", 7, 6, null)?.sub).toBe("AZUL WINS 7 – 6");
  });

  it("calls a first-serve fault FAULT with the reason", () => {
    expect(bannerFor("fault", null, 1, 1, "Into the net")).toEqual({
      title: "FAULT",
      sub: "Into the net",
      tone: "fault",
      team: null,
    });
  });

  it("calls a fault with a point winner DOUBLE FAULT", () => {
    expect(bannerFor("fault", "B", 1, 1, "SERVE LONG")).toEqual({
      title: "DOUBLE FAULT",
      sub: "SERVE LONG",
      tone: "fault",
      team: "B",
    });
  });

  it("calls a let LET, REPLAY THE SERVE", () => {
    expect(bannerFor("let", null, 0, 0, null)).toEqual({
      title: "LET",
      sub: "REPLAY THE SERVE",
      tone: "neutral",
      team: null,
    });
  });

  it("calls the match start MATCH, AZUL vs ROJO", () => {
    expect(bannerFor("start", null, 0, 0, null)).toEqual({
      title: "MATCH",
      sub: "AZUL vs ROJO",
      tone: "neutral",
      team: null,
    });
  });

  it("calls a set reset RESET with no sub line", () => {
    expect(bannerFor("reset", null, 0, 0, null)).toEqual({
      title: "RESET",
      sub: null,
      tone: "neutral",
      team: null,
    });
  });
});
