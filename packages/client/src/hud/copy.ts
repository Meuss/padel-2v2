/**
 * English broadcast copy for the match graphics (score call, Banner); the team names stay AZUL / ROJO.
 * Pure: no DOM, so it is unit tested directly.
 */
import type { MatchEventKind, Team } from "@padel/shared";

/** Spaced en dash, the separator in every score line. */
const DASH = " – ";

const POINT_WORDS: Record<string, string> = {
  "0": "LOVE",
  "15": "FIFTEEN",
  "30": "THIRTY",
  "40": "FORTY",
  // Only reachable with golden point turned off.
  Ad: "ADVANTAGE",
};

export function teamLabel(t: Team): "AZUL" | "ROJO" {
  return t === "A" ? "AZUL" : "ROJO";
}

function pointWord(label: string): string {
  return POINT_WORDS[label] ?? label.toUpperCase();
}

/** English score call, server's score first. pointServer/pointReceiver are MatchMsg point labels. */
export function scoreCall(pointServer: string, pointReceiver: string, tiebreak: boolean): string {
  if (tiebreak) return `${pointServer}${DASH}${pointReceiver}`;
  if (pointServer === pointReceiver) {
    return pointServer === "40" ? "GOLDEN POINT" : `${pointWord(pointServer)} ALL`;
  }
  return `${pointWord(pointServer)}${DASH}${pointWord(pointReceiver)}`;
}

export interface BannerCopy {
  title: string;
  sub: string | null;
  tone: "team" | "fault" | "neutral";
  team: Team | null;
}

/** The Banner for a point that makes it 40–40: the games, then the points (as in comp 3). */
export function goldenPointBanner(gamesA: number, gamesB: number): BannerCopy {
  return { title: "GOLDEN POINT", sub: `AZUL ${gamesA}${DASH}${gamesB} ROJO · 40${DASH}40`, tone: "neutral", team: null };
}

/**
 * The between-point Banner for a match event, or null when the event gets none (points only
 * update the score bug and the score call). A fault that hands a team the point is a double fault.
 */
export function bannerFor(
  kind: MatchEventKind,
  team: Team | null,
  gamesA: number,
  gamesB: number,
  reason: string | null,
): BannerCopy | null {
  switch (kind) {
    case "point":
      return null;
    case "game":
      return { title: "GAME", sub: `AZUL ${gamesA}${DASH}${gamesB} ROJO`, tone: "team", team };
    case "set": {
      if (team === null) {
        return { title: "SET & MATCH", sub: `AZUL ${gamesA}${DASH}${gamesB} ROJO`, tone: "team", team };
      }
      const [won, lost] = team === "A" ? [gamesA, gamesB] : [gamesB, gamesA];
      return { title: "SET & MATCH", sub: `${teamLabel(team)} WINS ${won}${DASH}${lost}`, tone: "team", team };
    }
    case "fault":
      return { title: team === null ? "FAULT" : "DOUBLE FAULT", sub: reason, tone: "fault", team };
    case "let":
      return { title: "LET", sub: "REPLAY THE SERVE", tone: "neutral", team: null };
    case "start":
      return { title: "MATCH", sub: "AZUL vs ROJO", tone: "neutral", team: null };
    case "reset":
      return { title: "RESET", sub: null, tone: "neutral", team: null };
  }
}
