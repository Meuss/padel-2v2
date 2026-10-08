/**
 * Instant replay rules shared by the client's director (which plays the replay) and the server
 * (which holds a Bot's toss until a replay would end, so a Bot never cuts one short).
 * Times are server time (ms), except where a function says otherwise.
 */
import type { ShotKind } from "./shots.js";

/** How long after the point end the replay starts (after the Banner's entry). */
export const REPLAY_DELAY_MS = 1000;
/** The clip starts this long before the serve of a short point… */
export const REPLAY_LEAD_MS = 600;
/** …and is never longer than this: a long point keeps only its end. */
export const REPLAY_MAX_MS = 4500;
/** Playback speed: slower than live, so the decisive shot reads. */
export const REPLAY_SPEED = 0.85;
/** A rally of at least this many shots (the serve included) is notable. */
export const NOTABLE_RALLY_SHOTS = 6;

/** Whether a point is worth a replay: a long rally, a Smash winner, a golden point or the match point. */
export function isNotable(p: {
  shots: number;
  lastWinnerShot: ShotKind | null;
  goldenPoint: boolean;
  matchPoint: boolean;
}): boolean {
  return p.shots >= NOTABLE_RALLY_SHOTS || p.lastWinnerShot === "smash" || p.goldenPoint || p.matchPoint;
}

/** The recorded stretch to replay: from REPLAY_LEAD_MS before the serve, at most REPLAY_MAX_MS. */
export function clipFor(pointStartMs: number | null, pointEndMs: number): { fromMs: number; toMs: number } {
  const earliest = pointEndMs - REPLAY_MAX_MS;
  const fromMs = pointStartMs === null ? earliest : Math.max(earliest, pointStartMs - REPLAY_LEAD_MS);
  return { fromMs, toMs: pointEndMs };
}

/** How long after its point ends the replay of a point is over: the start delay, then the clip at REPLAY_SPEED. */
export function replayLengthMs(pointStartMs: number | null, pointEndMs: number): number {
  const { fromMs, toMs } = clipFor(pointStartMs, pointEndMs);
  return REPLAY_DELAY_MS + (toMs - fromMs) / REPLAY_SPEED;
}
