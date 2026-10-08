/**
 * The controls, shown two ways: a centred card the first time a Player joins (and on "?"), and an
 * always-on compact legend, bottom-right, with the "?" key and the three hits a new player must
 * know (left click Drive, right click Lob, Space serve). Spectators get "?" alone, and a card with
 * only what they can do (TAKE SEAT, M).
 * controlRows, legendRows and shouldShowCard are pure (unit tested); the classes only draw them.
 */
import type { Role } from "@padel/shared";
import { arrowKeys, keycap, mouse, wasdKeys } from "./glyphs.js";

/**
 * One control: the keys to press (drawn as glyphs) and what they do. A key is a key legend
 * ("E", "SPACE") or one of the drawn groups WASD, ARROWS, LMB (left click), RMB (right click), or
 * TAKE SEAT (the on-screen button). A row with no keys is a note.
 */
export interface ControlRow {
  keys: string[];
  label: string;
  /** How to do it, after the label. */
  note?: string;
}

/** Remembers that the card was closed once, so it opens by itself only the first time. */
export const CONTROLS_SEEN_KEY = "mpc-controls-seen";

const DRIVE: ControlRow = { keys: ["LMB"], label: "Drive" };
const LOB: ControlRow = { keys: ["RMB"], label: "Lob" };

/** Everything the card lists for a role: how to move, how to hit, and the rest. Pure. */
export function controlRows(role: Role): { move: ControlRow[]; hit: ControlRow[]; other: ControlRow[] } {
  if (role === "spectator") {
    return {
      move: [],
      hit: [],
      other: [
        { keys: ["TAKE SEAT"], label: "Play when a seat is free" },
        { keys: ["M"], label: "Sound" },
      ],
    };
  }
  return {
    move: [
      { keys: ["WASD"], label: "Move" },
      { keys: ["ARROWS"], label: "Move" },
    ],
    hit: [
      DRIVE,
      LOB,
      { keys: [], label: "Smash: automatic when the ball is high" },
      { keys: [], label: "Aim: point the mouse at the court" },
    ],
    other: [
      { keys: ["SPACE"], label: "Serve", note: "SPACE to toss · CLICK at the top" },
      { keys: ["E"], label: "React" },
      { keys: ["M"], label: "Sound" },
      { keys: ["ENTER"], label: "Skip replay" },
      { keys: ["B", "N"], label: "Add / clear bots" },
    ],
  };
}

/** The compact legend beside "?": the Drive, the Lob and the serve, for Players only. Pure. */
export function legendRows(role: Role): ControlRow[] {
  return role === "player" ? [DRIVE, LOB, { keys: ["SPACE"], label: "Serve" }] : [];
}

/** Closing the card counts as "seen" only for the Player card: a Spectator still gets it on taking a seat. Pure. */
export function persistSeenOnClose(role: Role): boolean {
  return role === "player";
}

/** The card opens by itself once, for a Player who has not closed it before. Pure. */
export function shouldShowCard(seen: boolean, role: Role): boolean {
  return role === "player" && !seen;
}

/** What Esc closes, topmost first: the controls card, then the emote tray. Pure. */
export function escapeCloses(open: { controlsCard: boolean; tray: boolean }): "controls" | "tray" | null {
  if (open.controlsCard) return "controls";
  return open.tray ? "tray" : null;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function div(className: string, text?: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  if (text !== undefined) d.textContent = text;
  return d;
}

/** The glyph for one key of a ControlRow. */
function keyGlyph(key: string): Element {
  switch (key) {
    case "WASD":
      return wasdKeys();
    case "ARROWS":
      return arrowKeys();
    case "LMB":
      return mouse("left");
    case "RMB":
      return mouse("right");
    case "TAKE SEAT": {
      // The real button, in miniature: what to look for on screen.
      const chip = document.createElement("span");
      chip.className = "ct-chip";
      chip.textContent = "Take seat";
      return chip;
    }
    default:
      return keycap(key);
  }
}

/** A row's keys, a slash between alternatives ("B / N"). */
function keyGroup(keys: string[]): HTMLDivElement {
  const group = div("ct-keys");
  keys.forEach((k, i) => {
    if (i > 0) group.append(div("ct-slash", "/"));
    group.append(keyGlyph(k));
  });
  return group;
}

/** A glyph over its label, as in the join comp's legend. */
function figure(row: ControlRow, className: string): HTMLDivElement {
  const fig = div(className);
  fig.append(keyGroup(row.keys), div("ct-fig-label", row.label));
  return fig;
}

/**
 * The controls card: a centred broadcast card (white CONTROLS strip, MOVE and HIT columns, the
 * other keys, then "Got it"). Drawn per role; `onClose` runs when it is dismissed by the button.
 */
export class ControlsCard {
  private role: Role | null = null;
  private open = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly onGotIt: () => void,
  ) {
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Controls");
  }

  get showing(): boolean {
    return this.open;
  }

  /** The role the card was last drawn for. */
  get shownRole(): Role | null {
    return this.role;
  }

  show(role: Role): void {
    if (role !== this.role) this.build(role);
    this.open = true;
    this.root.classList.add("show");
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove("show");
  }

  private build(role: Role): void {
    this.role = role;
    const { move, hit, other } = controlRows(role);
    const head = document.createElement("h2");
    head.className = "ct-head";
    head.textContent = "Controls";
    const parts: HTMLElement[] = [head];

    if (move.length > 0 || hit.length > 0) {
      const moveCol = div("ct-col ct-move");
      const moveGlyphs = div("ct-move-keys");
      move.forEach((row, i) => {
        if (i > 0) moveGlyphs.append(div("ct-or", "or"));
        moveGlyphs.append(keyGroup(row.keys));
      });
      moveCol.append(div("ct-colhead", "Move"), moveGlyphs);

      const hitCol = div("ct-col ct-hit");
      const mice = div("ct-mice");
      const notes = div("ct-notes");
      for (const row of hit) {
        if (row.keys.length > 0) mice.append(figure(row, "ct-fig"));
        else notes.append(div("ct-note", row.label));
      }
      hitCol.append(div("ct-colhead", "Hit"), mice, notes);

      const cols = div("ct-cols");
      cols.append(moveCol, hitCol);
      parts.push(cols);
    }

    // Without the MOVE and HIT columns (Spectators) the few rows stack in one column.
    const list = div(parts.length > 1 ? "ct-other" : "ct-other ct-other-single");
    for (const row of other) {
      const line = div(row.note ? "ct-row ct-row-wide" : "ct-row");
      line.append(keyGroup(row.keys), div("ct-label", row.label));
      if (row.note) line.append(div("ct-rownote", row.note));
      list.append(line);
    }
    parts.push(list);

    const again = div("ct-again");
    again.append(keycap("?", null), div("ct-again-label", "shows this again"));
    const gotIt = document.createElement("button");
    gotIt.type = "button";
    gotIt.className = "primary-btn";
    gotIt.textContent = "Got it";
    gotIt.addEventListener("click", (e) => {
      this.onGotIt();
      // After a mouse click, give Space back to the serve toss; keyboard users keep focus.
      if (e.detail > 0) gotIt.blur();
    });
    const foot = div("ct-foot");
    foot.append(again, gotIt);
    parts.push(foot);

    this.root.replaceChildren(...parts);
  }
}

/** The compact legend, bottom-right: the "?" key (toggles the card) and, for Players, three hints. */
export class ControlsLegend {
  private role: Role | null = null;
  private readonly help: HTMLButtonElement;
  private readonly mini: HTMLDivElement;

  constructor(root: HTMLElement, onHelp: () => void) {
    this.help = document.createElement("button");
    this.help.type = "button";
    this.help.className = "ctl-help";
    this.help.title = "Controls (?)";
    this.help.setAttribute("aria-label", "Controls");
    this.help.setAttribute("aria-expanded", "false");
    this.help.append(keycap("?", null));
    this.help.addEventListener("click", (e) => {
      onHelp();
      if (e.detail > 0) this.help.blur();
    });
    this.mini = div("ctl-mini");
    root.append(this.mini, this.help);
  }

  render(role: Role): void {
    if (role === this.role) return;
    this.role = role;
    this.mini.replaceChildren(...legendRows(role).map((row) => figure(row, "ctl-fig")));
  }

  setExpanded(open: boolean): void {
    this.help.setAttribute("aria-expanded", String(open));
  }
}
