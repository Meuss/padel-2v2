/**
 * The between-point Banner: a lower-third band (navy title band under an optic rule, then a sub
 * band) that wipes in, holds, and wipes out. Measured from docs/design/v2-comp-between-points.png.
 * BannerQueue and bannerForMatch are pure (unit tested); Banner only draws the current item.
 */
import type { MatchMsg, MatchEventKind } from "@padel/shared";
import { bannerFor, goldenPointBanner, type BannerCopy } from "./copy.js";

export interface BannerItem {
  copy: BannerCopy;
  durationMs: number;
}

/** "golden" is a point that makes it 40–40; the other kinds are match events that get a Banner. */
export type BannerKind = Exclude<MatchEventKind, "point"> | "golden";

/** How long each Banner holds. The Set Banner stays until the Final card replaces it. */
export const BANNER_MS: Record<BannerKind, number> = {
  fault: 1600,
  let: 1600,
  game: 2200,
  start: 2200,
  reset: 2200,
  golden: 2200,
  set: Infinity,
};

/** One Banner at a time: a new one replaces the one on screen, never stacks behind it. Pure. */
export class BannerQueue {
  private item: BannerItem | null = null;
  private until = 0;

  show(item: BannerItem, nowMs: number): void {
    this.item = item;
    this.until = nowMs + item.durationMs;
  }

  current(nowMs: number): BannerItem | null {
    if (this.item && nowMs >= this.until) this.item = null;
    return this.item;
  }

  clear(): void {
    this.item = null;
  }
}

function eventKey(m: MatchMsg): string | null {
  return m.eventKind ? `${m.eventKind}|${m.eventTeam ?? ""}|${m.event ?? ""}` : null;
}

/** A point (or a double fault's point) that just made the score 40–40 outside a tiebreak. */
function isGoldenPoint(m: MatchMsg): boolean {
  const pointEvent = m.eventKind === "point" || (m.eventKind === "fault" && m.eventTeam !== null);
  return pointEvent && !m.tiebreak && m.pointA === "40" && m.pointB === "40";
}

/**
 * The Banner for a match update, or null. Only a new event gets one (`prev` is the state before),
 * and never on the first state seen, so joining mid-break shows nothing stale. Pure.
 */
export function bannerForMatch(m: MatchMsg, prev: MatchMsg | null): BannerItem | null {
  const key = eventKey(m);
  if (!prev || !m.eventKind || key === eventKey(prev)) return null;
  if (isGoldenPoint(m)) return { copy: goldenPointBanner(m.gamesA, m.gamesB), durationMs: BANNER_MS.golden };
  if (m.eventKind === "point") return null;
  // The Rematch passed: the new match opens with MATCH, not RESET.
  if (m.eventKind === "reset" && prev.phase === "over" && m.phase !== "over") {
    return { copy: bannerFor("start", null, m.gamesA, m.gamesB, null)!, durationMs: BANNER_MS.start };
  }
  const copy = bannerFor(m.eventKind, m.eventTeam, m.gamesA, m.gamesB, m.reason);
  return copy ? { copy, durationMs: BANNER_MS[m.eventKind] } : null;
}

/** Draws the queue's current Banner; call `update` every frame. */
export class Banner {
  private readonly title: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private shown: BannerItem | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly queue: BannerQueue,
  ) {
    root.classList.add("banner");
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    const rule = document.createElement("div");
    rule.className = "bn-rule";
    const block = document.createElement("div");
    block.className = "bn-block";
    this.title = document.createElement("div");
    this.title.className = "bn-title";
    this.sub = document.createElement("div");
    this.sub.className = "bn-sub";
    root.replaceChildren(rule, block, this.title, this.sub);
  }

  /** True while a Banner is on screen (other lower-third graphics step aside). */
  get showing(): boolean {
    return this.shown !== null;
  }

  update(nowMs: number): void {
    const item = this.queue.current(nowMs);
    if (item === this.shown) return;
    this.shown = item;
    if (item === null) {
      this.root.classList.replace("in", "out");
      return;
    }
    const { title, sub, tone, team } = item.copy;
    this.title.textContent = title;
    this.sub.textContent = sub ?? "";
    this.sub.hidden = sub === null;
    this.root.dataset.tone = tone;
    this.root.dataset.team = team === "A" ? "azul" : team === "B" ? "rojo" : "";
    // Restart the wipe from the left, also when a Banner replaces the one on screen.
    this.root.classList.remove("in", "out");
    void this.root.offsetWidth;
    this.root.classList.add("in");
  }
}
