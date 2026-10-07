/**
 * The Final card: a centred broadcast card once the match is over. A white "SET & MATCH" strip,
 * the winner in their team colour, the set score, the winners' names, three stats rows (Azul vs
 * Rojo), and the Rematch vote in its footer.
 * finalModel is pure (unit tested); FinalCard only draws a model and the vote.
 */
import type { MatchMsg, MatchStats, Slot, Team } from "@padel/shared";
import { teamLabel } from "./copy.js";

export interface FinalRow {
  label: string;
  a: string;
  b: string;
  /** One number for the whole match (shown once, across both columns); `a` and `b` both hold it. */
  shared?: true;
}

export interface FinalModel {
  winner: Team;
  /** Winner's games first, as the Banner says it ("6 – 4"). */
  setScore: [number, number];
  /** The winning team's seated players, truncated for the card. */
  names: string[];
  rows: FinalRow[];
}

/** Longest name on the card, in characters (graphemes), the ellipsis included. */
export const NAME_MAX = 14;
const ELLIPSIS = "…";
/** A team without a shot has no percentage. */
const NO_VALUE = "–";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `name` cut to NAME_MAX characters with an ellipsis; an emoji is never split. Pure. */
export function truncateName(name: string): string {
  const chars = Array.from(graphemes.segment(name), (s) => s.segment);
  return chars.length <= NAME_MAX ? name : chars.slice(0, NAME_MAX - 1).join("") + ELLIPSIS;
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : NO_VALUE;
}

/** The winner: the match's own, else more games, else more points won. */
function winnerOf(m: MatchMsg, stats: MatchStats): Team {
  if (m.winner) return m.winner;
  if (m.gamesA !== m.gamesB) return m.gamesA > m.gamesB ? "A" : "B";
  return stats.A.points >= stats.B.points ? "A" : "B";
}

const SLOT_ORDER: Slot[] = ["A1", "A2", "B1", "B2"];

/** The Final card for a match state, or null unless the match is over with its stats. Pure. */
export function finalModel(m: MatchMsg, names: Map<Slot, { name: string; team: Team }>): FinalModel | null {
  const stats = m.stats;
  if (m.phase !== "over" || !stats) return null;
  const winner = winnerOf(m, stats);
  const won = winner === "A" ? m.gamesA : m.gamesB;
  const lost = winner === "A" ? m.gamesB : m.gamesA;
  const winners: string[] = [];
  for (const slot of SLOT_ORDER) {
    const p = names.get(slot);
    if (p && p.team === winner) winners.push(truncateName(p.name));
  }
  const rally = String(stats.longestRally);
  return {
    winner,
    setScore: [won, lost],
    names: winners,
    rows: [
      { label: "PERFECT SHOTS", a: percent(stats.A.perfect, stats.A.shots), b: percent(stats.B.perfect, stats.B.shots) },
      { label: "SMASHES", a: String(stats.A.smashes), b: String(stats.B.smashes) },
      { label: "LONGEST RALLY", a: rally, b: rally, shared: true },
    ],
  };
}

/** The Rematch vote as the card's footer shows it. */
export interface FinalVote {
  /** A vote is open (Rematch, or a reset someone started). */
  active: boolean;
  accepted: number;
  needed: number;
  /** We are a seated Player (spectators wait). */
  canVote: boolean;
  /** We already accepted this vote. */
  acceptedByMe: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const DASH = "–";

/** Draws the Final card into its root; the root wipes in on `show` and out on `hide`. */
export class FinalCard {
  private readonly winnerEl = el("div", "fc-winner");
  private readonly scoreWon = el("span", "fc-games");
  private readonly scoreLost = el("span", "fc-games");
  private readonly namesEl = el("div", "fc-names");
  private readonly statsBody = el("tbody", "");
  private readonly countEl = el("div", "fc-count");
  private readonly countN = el("span", "fc-count-n");
  private readonly accept = el("button", "primary-btn", "Accept");
  private readonly decline = el("button", "ghost-btn", "Decline");
  private readonly actions = el("div", "fc-actions");
  private readonly wait = el("div", "fc-wait", "Waiting for the players…");
  private shown = false;

  constructor(
    private readonly root: HTMLElement,
    handlers: { accept: () => void; decline: () => void },
  ) {
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Final");

    const head = el("div", "fc-head", "SET & MATCH");
    const block = el("div", "fc-block");
    const score = el("div", "fc-score");
    score.append(this.scoreWon, el("span", "fc-dash", DASH), this.scoreLost);
    const top = el("div", "fc-top");
    this.winnerEl.setAttribute("aria-live", "polite");
    top.append(block, this.winnerEl, score, this.namesEl);

    const table = el("table", "fc-stats");
    const headRow = el("tr", "");
    const thA = el("th", "fc-team azul");
    thA.scope = "col";
    thA.append(el("span", "fc-dot"), "AZUL");
    const thLabel = el("th", "fc-label");
    thLabel.scope = "col";
    const thB = el("th", "fc-team rojo");
    thB.scope = "col";
    thB.append(el("span", "fc-dot"), "ROJO");
    headRow.append(thA, thLabel, thB);
    const thead = el("thead", "");
    thead.append(headRow);
    table.append(thead, this.statsBody);

    for (const b of [this.accept, this.decline]) {
      b.type = "button";
      // After a mouse click, give Space back to the game; keyboard users keep focus.
      b.addEventListener("click", (e) => {
        if (e.detail > 0) b.blur();
      });
    }
    this.accept.addEventListener("click", handlers.accept);
    this.decline.addEventListener("click", handlers.decline);
    this.actions.append(this.accept, this.decline);
    this.countEl.append(this.countN, el("span", "fc-count-label", "accepted"));
    const foot = el("div", "fc-foot");
    foot.append(el("div", "fc-q", "REMATCH?"), this.countEl, this.actions, this.wait);

    root.replaceChildren(head, top, table, foot);
  }

  get showing(): boolean {
    return this.shown;
  }

  show(m: FinalModel): void {
    const team = m.winner === "A" ? "azul" : "rojo";
    this.root.dataset.team = team;
    this.winnerEl.textContent = `${teamLabel(m.winner)} WINS`;
    this.scoreWon.textContent = String(m.setScore[0]);
    this.scoreLost.textContent = String(m.setScore[1]);
    // Nicknames are user input: textContent only.
    const names: (HTMLElement | string)[] = [];
    m.names.forEach((n, i) => {
      if (i > 0) names.push(el("span", "fc-sep", "·"));
      names.push(el("span", "fc-name", n));
    });
    this.namesEl.replaceChildren(...names);
    this.namesEl.hidden = m.names.length === 0;
    this.statsBody.replaceChildren(...m.rows.map(row));
    if (this.shown) return;
    this.shown = true;
    this.root.classList.remove("out");
    void this.root.offsetWidth;
    this.root.classList.add("in");
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.replace("in", "out");
  }

  setVote(v: FinalVote): void {
    this.countEl.hidden = !v.active;
    this.countN.textContent = `${v.accepted}/${v.needed}`;
    this.actions.hidden = !v.canVote;
    this.wait.hidden = v.canVote;
    // With no vote open, Accept opens one; Decline only answers an open vote.
    this.accept.disabled = v.active && v.acceptedByMe;
    this.accept.textContent = v.active && v.acceptedByMe ? "Accepted" : "Accept";
    this.decline.disabled = !v.active;
  }
}

function row(r: FinalRow): HTMLTableRowElement {
  const tr = el("tr", r.shared ? "shared" : "");
  const label = el("th", "fc-label", r.label);
  label.scope = "row";
  if (r.shared) {
    // One number for the match: the label, then the value, centred across the row.
    label.colSpan = 3;
    label.append(el("span", "fc-shared", r.a));
    tr.append(label);
  } else {
    tr.append(el("td", "fc-val", r.a), label, el("td", "fc-val", r.b));
  }
  return tr;
}
