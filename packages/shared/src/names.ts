/**
 * Nickname cleaning shared by client and server. Names are shown to every
 * player, so the server never trusts what a client sends. Escaping is NOT done
 * here: the client must render names with textContent, never innerHTML.
 */
import { NAME_MAX_LENGTH } from "./constants.js";

// C0/C1 control characters plus the bidi overrides/isolates used to spoof text.
const UNSAFE_CHARS = /[\p{Cc}‪-‮⁦-⁩]/gu;

/** Clean a client-supplied nickname, or return `fallback` when nothing usable is left. */
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw.replace(UNSAFE_CHARS, "").replace(/\s+/g, " ").trim();
  // Array.from splits by code point, so an emoji is never cut in half.
  const capped = Array.from(cleaned).slice(0, NAME_MAX_LENGTH).join("").trim();
  return capped || fallback;
}
