/**
 * The pro-tour score bug, bottom-left: a navy header strip over two navy team rows (colour bar,
 * team dot, name, optic ball on the serving team, games, points), and the Spanish score call in a
 * strip under it after each point.
 * bugModel is pure (unit tested); ScoreBug only draws a model.
 */
import type { MatchMsg, Team } from "@padel/shared";
import { scoreCall, teamLabel } from "./copy.js";

export interface BugRow {
  team: Team;
  label: "AZUL" | "ROJO";
  games: number;
  points: string;
  serving: boolean;
}

export interface BugModel {
  header: string;
  tiebreak: boolean;
  rows: [BugRow, BugRow] | null;
  call: string | null;
  /** A rally is in play: the score call strip hides so the rally screen stays clean. */
  rally: boolean;
}

const CLUB = "MEUSS PADEL CLUB";
/** How long the score call stays under the bug. */
const CALL_MS = 2500;

function teamOf(slot: string | null): Team | null {
  return slot ? (slot.startsWith("A") ? "A" : "B") : null;
}

/** A point just went to a team: a won point, or a double fault that is not a game or set. */
function pointJustWon(m: MatchMsg, prev: MatchMsg | null): boolean {
  if (!prev) return false;
  const pointEvent = m.eventKind === "point" || (m.eventKind === "fault" && m.eventTeam !== null);
  const moved = m.pointA !== prev.pointA || m.pointB !== prev.pointB;
  return pointEvent && moved && m.gamesA === prev.gamesA && m.gamesB === prev.gamesB;
}

/** The score bug for a match state; `prev` is the state before it, to spot the point just won. */
export function bugModel(m: MatchMsg | null, prev: MatchMsg | null): BugModel {
  if (!m || m.phase === "warmup") return { header: CLUB, tiebreak: false, rows: null, call: null, rally: false };
  const over = m.phase === "over";
  const server = over ? null : teamOf(m.serverSlot);
  const row = (team: Team): BugRow => ({
    team,
    label: teamLabel(team),
    games: team === "A" ? m.gamesA : m.gamesB,
    points: team === "A" ? m.pointA : m.pointB,
    serving: server === team,
  });
  let call: string | null = null;
  if (!over && pointJustWon(m, prev)) {
    const first = server ?? "A";
    const [s, r] = first === "A" ? [m.pointA, m.pointB] : [m.pointB, m.pointA];
    call = scoreCall(s, r, m.tiebreak);
  }
  return {
    header: over ? "FINAL" : CLUB,
    tiebreak: m.tiebreak && !over,
    rows: [row("A"), row("B")],
    call,
    rally: m.phase === "rally",
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface RowEls {
  root: HTMLDivElement;
  games: HTMLSpanElement;
  points: HTMLSpanElement;
}

export class ScoreBug {
  private readonly title: HTMLSpanElement;
  private readonly tb: HTMLSpanElement;
  private readonly rowsEl: HTMLDivElement;
  private readonly warmup: HTMLDivElement;
  private readonly callEl: HTMLDivElement;
  private readonly rows: Record<Team, RowEls>;
  private callTimer: number | undefined;

  constructor(root: HTMLElement) {
    root.classList.add("scorebug");
    const head = el("div", "sb-head");
    this.title = el("span", "sb-title", CLUB);
    this.tb = el("span", "sb-tb", "TB");
    head.append(this.title, this.tb);

    this.rowsEl = el("div", "sb-rows");
    const makeRow = (team: Team): RowEls => {
      const r = el("div", `sb-row ${team === "A" ? "azul" : "rojo"}`);
      const games = el("span", "sb-games");
      const points = el("span", "sb-points");
      const name = el("span", "sb-name");
      name.append(el("span", "sb-label", teamLabel(team)), serveBall());
      r.append(el("span", "sb-bar"), el("span", "sb-dot"), name, games, points);
      this.rowsEl.append(r);
      return { root: r, games, points };
    };
    this.rows = { A: makeRow("A"), B: makeRow("B") };

    this.warmup = el("div", "sb-warmup", "WARM-UP");
    this.callEl = el("div", "sb-call");
    this.callEl.setAttribute("role", "status");
    this.callEl.setAttribute("aria-live", "polite");
    root.replaceChildren(head, this.rowsEl, this.warmup, this.callEl);
  }

  render(model: BugModel): void {
    this.title.textContent = model.header;
    this.tb.hidden = !model.tiebreak;
    this.rowsEl.hidden = model.rows === null;
    this.warmup.hidden = model.rows !== null;
    for (const r of model.rows ?? []) {
      const els = this.rows[r.team];
      els.root.classList.toggle("serving", r.serving);
      setCell(els.games, String(r.games));
      setCell(els.points, r.points);
    }
    if (model.call !== null) this.showCall(model.call);
    else if (model.rows === null || model.rally) this.hideCall();
  }

  private showCall(text: string): void {
    this.callEl.textContent = text;
    this.callEl.classList.remove("show");
    void this.callEl.offsetWidth; // restart the entrance for back-to-back calls
    this.callEl.classList.add("show");
    window.clearTimeout(this.callTimer);
    this.callTimer = window.setTimeout(() => this.hideCall(), CALL_MS);
  }

  private hideCall(): void {
    window.clearTimeout(this.callTimer);
    this.callEl.classList.remove("show");
  }
}

const SVG = "http://www.w3.org/2000/svg";

/** The serving team's mark: a small optic ball with its seam. */
function serveBall(): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "sb-serve");
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("aria-hidden", "true");
  const ball = document.createElementNS(SVG, "circle");
  ball.setAttribute("cx", "5");
  ball.setAttribute("cy", "5");
  ball.setAttribute("r", "4.6");
  const seam = document.createElementNS(SVG, "path");
  seam.setAttribute("d", "M2.1 1.9C4.3 3.9 4.3 6.1 2.1 8.1M7.9 1.9C5.7 3.9 5.7 6.1 7.9 8.1");
  svg.append(ball, seam);
  return svg;
}

/** Write a cell, flashing it when an existing value changes (not on the first fill). */
function setCell(cell: HTMLElement, value: string): void {
  const old = cell.textContent;
  if (old === value) return;
  cell.textContent = value;
  if (old === "") return;
  cell.classList.remove("flash");
  void cell.offsetWidth; // restart the animation
  cell.classList.add("flash");
}
