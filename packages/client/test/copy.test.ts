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
    ["15", "0", "QUINCE – NADA"],
    ["0", "30", "NADA – TREINTA"],
    ["40", "15", "CUARENTA – QUINCE"],
    ["30", "40", "TREINTA – CUARENTA"],
  ])("calls %s-%s as %s", (s, r, call) => {
    expect(scoreCall(s, r, false)).toBe(call);
  });

  it("puts the server's score first", () => {
    expect(scoreCall("0", "15", false)).toBe("NADA – QUINCE");
    expect(scoreCall("15", "0", false)).toBe("QUINCE – NADA");
  });

  it("calls equal scores below 40 IGUALES", () => {
    expect(scoreCall("0", "0", false)).toBe("NADA IGUALES");
    expect(scoreCall("15", "15", false)).toBe("QUINCE IGUALES");
    expect(scoreCall("30", "30", false)).toBe("TREINTA IGUALES");
  });

  it("calls deuce PUNTO DE ORO", () => {
    expect(scoreCall("40", "40", false)).toBe("PUNTO DE ORO");
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
      title: "JUEGO",
      sub: "AZUL 4 – 3 ROJO",
      tone: "team",
      team: "A",
    });
    expect(bannerFor("game", "B", 2, 5, null)).toEqual({
      title: "JUEGO",
      sub: "AZUL 2 – 5 ROJO",
      tone: "team",
      team: "B",
    });
  });

  it("calls the set with the winner and the winner's games first", () => {
    expect(bannerFor("set", "B", 4, 6, null)).toEqual({
      title: "SET Y PARTIDO",
      sub: "GANA ROJO 6 – 4",
      tone: "team",
      team: "B",
    });
    expect(bannerFor("set", "A", 7, 6, null)?.sub).toBe("GANA AZUL 7 – 6");
  });

  it("calls a first-serve fault FALTA with the reason", () => {
    expect(bannerFor("fault", null, 1, 1, "Into the net")).toEqual({
      title: "FALTA",
      sub: "Into the net",
      tone: "fault",
      team: null,
    });
  });

  it("calls a fault with a point winner DOBLE FALTA", () => {
    expect(bannerFor("fault", "B", 1, 1, "Double fault — long")).toEqual({
      title: "DOBLE FALTA",
      sub: "Double fault — long",
      tone: "fault",
      team: "B",
    });
  });

  it("calls a let LET, REPETIR SAQUE", () => {
    expect(bannerFor("let", null, 0, 0, null)).toEqual({
      title: "LET",
      sub: "REPETIR SAQUE",
      tone: "neutral",
      team: null,
    });
  });

  it("calls the match start PARTIDO, AZUL vs ROJO", () => {
    expect(bannerFor("start", null, 0, 0, null)).toEqual({
      title: "PARTIDO",
      sub: "AZUL vs ROJO",
      tone: "neutral",
      team: null,
    });
  });

  it("calls a set reset REINICIO with no sub line", () => {
    expect(bannerFor("reset", null, 0, 0, null)).toEqual({
      title: "REINICIO",
      sub: null,
      tone: "neutral",
      team: null,
    });
  });
});
