/**
 * The join screen's words and its controls legend (docs/design/v2-comp-join.png): the room line
 * under the legend, the nickname counter, and the four controls a new player needs first.
 * roomLine, countsLine, statusUrl, parseStatus and nameCount are pure (unit tested); fillJoinLegend
 * only draws, and fetchRoomCounts reads the server's GET /status before the player connects.
 */
import { NAME_MAX_LENGTH } from "@padel/shared";
import { keycap, mouse, wasdKeys } from "./glyphs.js";

/** The room in people: humans seated, and everyone else connected. */
export interface RoomCounts {
  playing: number;
  watching: number;
}

/** "2v2 · 3 playing · 1 watching", or "2v2 · court is free" when nobody is there. Pure. */
export function countsLine({ playing, watching }: RoomCounts): string {
  if (playing === 0 && watching === 0) return "2v2 · court is free";
  return `2v2 · ${playing} playing · ${watching} watching`;
}

/** The room under the legend: "2v2 · 3 playing · 1 watching" from a roster, or the rule before one arrives. */
export function roomLine(roster: { players: readonly { isBot: boolean }[]; spectatorCount: number } | null): string {
  if (!roster) return "2v2 · first four play · the rest watch";
  // A bot's seat is anyone's for the taking: only people count as playing.
  return countsLine({ playing: roster.players.filter((p) => !p.isBot).length, watching: roster.spectatorCount });
}

/** The server's GET /status address from its ws(s) address (http(s), same host); null if unreadable. Pure. */
export function statusUrl(serverUrl: string): string | null {
  const m = /^(wss?):\/\/([^/?#]+)/i.exec(serverUrl.trim());
  if (!m) return null;
  return `${m[1]!.toLowerCase() === "wss" ? "https" : "http"}://${m[2]}/status`;
}

/** The /status body if it is two non-negative whole counts, else null. Pure. */
export function parseStatus(body: unknown): RoomCounts | null {
  if (typeof body !== "object" || body === null) return null;
  const { playing, watching } = body as Record<string, unknown>;
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  return count(playing) && count(watching) ? { playing, watching } : null;
}

/**
 * The room's counts from the server before connecting (null on any failure, silently). The request
 * also wakes a sleeping free-tier server while the player types a name.
 */
export async function fetchRoomCounts(serverUrl: string, timeoutMs = 4000): Promise<RoomCounts | null> {
  const url = statusUrl(serverUrl);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    return res.ok ? parseStatus(await res.json()) : null;
  } catch {
    return null;
  }
}

/**
 * The join screen's /status readings: the request starts now (at page load, so it wakes a sleeping
 * server early) and the first visit gets that reading; each later visit (after a kick) asks afresh.
 */
export function roomCountsReader(fetchCounts: () => Promise<RoomCounts | null>): () => Promise<RoomCounts | null> {
  let atLoad: Promise<RoomCounts | null> | null = fetchCounts();
  return () => {
    const counts = atLoad ?? fetchCounts();
    atLoad = null;
    return counts;
  };
}

/** The field's cap: 16 code points, like the server's (maxlength would count UTF-16 units). Pure. */
export function capName(value: string): string {
  const points = Array.from(value);
  return points.length > NAME_MAX_LENGTH ? points.slice(0, NAME_MAX_LENGTH).join("") : value;
}

/** "7/16": counted by code point, like the server's cap, so an emoji counts once. */
export function nameCount(value: string): string {
  return `${Array.from(value).length}/${NAME_MAX_LENGTH}`;
}

/** Fills the legend list: MOVE, DRIVE, LOB, SERVE, each a drawn glyph over its label. */
export function fillJoinLegend(list: HTMLElement): void {
  const items: [SVGSVGElement, string][] = [
    [wasdKeys(), "Move"],
    [mouse("left"), "Drive"],
    [mouse("right"), "Lob"],
    [keycap("SPACE", "Space"), "Serve"],
  ];
  list.replaceChildren(
    ...items.map(([glyph, label]) => {
      const li = document.createElement("li");
      const art = document.createElement("span");
      art.className = "jc-glyph";
      art.append(glyph);
      const name = document.createElement("span");
      name.className = "jc-label";
      name.textContent = label;
      li.append(art, name);
      return li;
    }),
  );
}
