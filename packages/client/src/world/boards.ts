/**
 * LED ribbon content: which messages the boards cycle through (pure, tested)
 * and how they are painted onto the shared 2048×128 board canvas.
 */
import { PALETTE } from "./palette.js";

export interface BoardState {
  phase: "warmup" | "serve" | "rally" | "between" | "over";
  gamesA: number;
  gamesB: number;
  pointA: string;
  pointB: string;
  /** Seated player names, Azul first: [A1, A2, B1, B2], "" for an empty seat. */
  names: string[];
  /** Reaction id currently showing, or null. */
  reaction: string | null;
}

export const CLUB_NAME = "MEUSS PADEL CLUB";
export const BOARD_W = 2048;
export const BOARD_H = 128;
const FONT = "700 64px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
const OPTIC_YELLOW = "#e4f23a";

function team(names: string[]): string {
  return names
    .map((n) => n.trim().toUpperCase())
    .filter((n) => n !== "")
    .join(" · ");
}

/** Messages the LED ribbon cycles through, in order. Pure. */
export function boardMessages(s: BoardState): string[] {
  const out = [CLUB_NAME];
  if (s.phase === "warmup") {
    out.push("WARM-UP");
  } else {
    if (s.phase === "over") out.push("FINAL");
    out.push(`AZUL ${s.gamesA} · ${s.gamesB} ROJO`);
    out.push(`${s.pointA} – ${s.pointB}`);
    const azul = team(s.names.slice(0, 2));
    const rojo = team(s.names.slice(2));
    const vs = azul && rojo ? `${azul}  VS  ${rojo}` : azul || rojo;
    if (vs) out.push(vs);
  }
  const reaction = s.reaction?.trim();
  if (reaction) out.push(`${reaction.toUpperCase()}!`);
  return out;
}

/**
 * Paint the messages across the board canvas, each followed by a small
 * optic-yellow bullet. The cycle is repeated a whole number of times and its
 * spacing stretched (or the text squeezed) so it fills the width exactly: the
 * canvas then tiles seamlessly under `RepeatWrapping`. `scrollPx` shifts the
 * start; the live ribbon scrolls via `texture.offset.x`, so this only runs when
 * the text changes.
 */
export function drawBoard(ctx: CanvasRenderingContext2D, messages: string[], scrollPx: number): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = PALETTE.ledBackground;
  ctx.fillRect(0, 0, w, h);
  if (messages.length === 0) return;
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  const minGap = 64;
  const widths = messages.map((m) => ctx.measureText(m).width);
  const textW = widths.reduce((a, b) => a + b, 0);
  const natural = textW + minGap * messages.length;
  const cycles = Math.max(1, Math.floor(w / natural));
  // Squeeze the glyphs horizontally only when one cycle cannot fit at all.
  const squeeze = Math.min(1, (w - minGap * messages.length) / textW);
  const gap = (w / cycles - textW * squeeze) / messages.length;
  const cy = h / 2 + 3;
  const start = -(((scrollPx % w) + w) % w);
  for (let pass = 0; pass < 2; pass++) {
    let x = start + pass * w;
    for (let c = 0; c < cycles; c++) {
      messages.forEach((text, i) => {
        ctx.save();
        ctx.translate(x, cy);
        ctx.scale(squeeze, 1);
        ctx.fillStyle = PALETTE.ledText;
        ctx.fillText(text, 0, 0);
        ctx.restore();
        x += widths[i]! * squeeze + gap / 2;
        ctx.fillStyle = OPTIC_YELLOW;
        ctx.beginPath();
        ctx.arc(x, cy, 6, 0, Math.PI * 2);
        ctx.fill();
        x += gap / 2;
      });
    }
  }
}
