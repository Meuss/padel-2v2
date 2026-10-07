/**
 * Nickname cleaning shared by client and server. Names are shown to every
 * player, so the server never trusts what a client sends. Escaping is NOT done
 * here: the client must render names with textContent, never innerHTML.
 */
import { NAME_MAX_LENGTH } from "./constants.js";

// C0/C1 control characters, zero-width characters (U+200B-U+200F, U+2060,
// U+FEFF) and the bidi overrides/isolates (U+202A-U+202E, U+2066-U+2069) used
// to spoof text. Escaped so the invisible characters are visible in source.
const UNSAFE_CHARS = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu;

/** Clean a client-supplied nickname, or return `fallback` when nothing usable is left. */
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw.replace(UNSAFE_CHARS, "").replace(/\s+/g, " ").trim();
  // Array.from splits by code point, so an emoji is never cut in half.
  const capped = Array.from(cleaned).slice(0, NAME_MAX_LENGTH).join("").trim();
  return capped || fallback;
}
