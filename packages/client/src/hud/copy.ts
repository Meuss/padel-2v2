/**
 * Spanish broadcast copy for the match graphics (score call, Banner, team names).
 * Pure: no DOM, so it is unit tested directly. UI chrome (buttons, prompts) stays English.
 */
import type { MatchEventKind, Team } from "@padel/shared";

/** Spaced en dash, the separator in every score line. */
const DASH = " – ";

const POINT_WORDS: Record<string, string> = {
  "0": "NADA",
  "15": "QUINCE",
  "30": "TREINTA",
  "40": "CUARENTA",
  // Only reachable with golden point turned off.
  Ad: "VENTAJA",
};

export function teamLabel(t: Team): "AZUL" | "ROJO" {
  return t === "A" ? "AZUL" : "ROJO";
}

function pointWord(label: string): string {
  return POINT_WORDS[label] ?? label.toUpperCase();
}

/** Spanish score call, server's score first. pointServer/pointReceiver are MatchMsg point labels. */
export function scoreCall(pointServer: string, pointReceiver: string, tiebreak: boolean): string {
  if (tiebreak) return `${pointServer}${DASH}${pointReceiver}`;
  if (pointServer === pointReceiver) {
    return pointServer === "40" ? "PUNTO DE ORO" : `${pointWord(pointServer)} IGUALES`;
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
  return { title: "PUNTO DE ORO", sub: `AZUL ${gamesA}${DASH}${gamesB} ROJO · 40${DASH}40`, tone: "neutral", team: null };
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
      return { title: "JUEGO", sub: `AZUL ${gamesA}${DASH}${gamesB} ROJO`, tone: "team", team };
    case "set": {
      if (team === null) {
        return { title: "SET Y PARTIDO", sub: `AZUL ${gamesA}${DASH}${gamesB} ROJO`, tone: "team", team };
      }
      const [won, lost] = team === "A" ? [gamesA, gamesB] : [gamesB, gamesA];
      return { title: "SET Y PARTIDO", sub: `GANA ${teamLabel(team)} ${won}${DASH}${lost}`, tone: "team", team };
    }
    case "fault":
      return { title: team === null ? "FALTA" : "DOBLE FALTA", sub: reason, tone: "fault", team };
    case "let":
      return { title: "LET", sub: "REPETIR SAQUE", tone: "neutral", team: null };
    case "start":
      return { title: "PARTIDO", sub: "AZUL vs ROJO", tone: "neutral", team: null };
    case "reset":
      return { title: "REINICIO", sub: null, tone: "neutral", team: null };
  }
}
