/**
 * The join screen's words and its controls legend (docs/design/v2-comp-join.png): the room line
 * under the legend, the nickname counter, and the four controls a new player needs first.
 * roomLine and nameCount are pure (unit tested); fillJoinLegend only draws.
 */
import { NAME_MAX_LENGTH } from "@padel/shared";
import { keycap, mouse, wasdKeys } from "./glyphs.js";

/** The room under the legend: "3 playing · 1 watching" from a roster, or the rule before one arrives. */
export function roomLine(roster: { players: readonly { isBot: boolean }[]; spectatorCount: number } | null): string {
  if (!roster) return "First four play · the rest watch";
  // A bot's seat is anyone's for the taking: only people count as playing.
  const playing = roster.players.filter((p) => !p.isBot).length;
  if (playing === 0 && roster.spectatorCount === 0) return "Court is free";
  return `${playing} playing · ${roster.spectatorCount} watching`;
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
