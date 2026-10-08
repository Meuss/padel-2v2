/**
 * The Instant replay director: a pure state machine deciding whether a point is replayed and
 * which stretch of the recording plays. Times: `fromMs`/`toMs` are server time (the recording's
 * clock), `startedAtMs` and every `nowMs` are the local clock (performance.now()).
 *
 * A replay is held as "replay" from the point end; it only starts playing at `startedAtMs`,
 * REPLAY_DELAY_MS later, after the Banner's entry. It ends at the end of the clip, on a skip,
 * on the serve toss, or when a rally starts, so it never delays the Serve. Which points are
 * notable, the clip and the timing constants live in @padel/shared (replay.ts): the server holds a
 * Bot's toss with the same rules.
 */
import { REPLAY_DELAY_MS, REPLAY_SPEED, clipFor, type MatchMsg, type MatchPhase, type Team } from "@padel/shared";

export type DirectorState = { mode: "live" } | { mode: "replay"; fromMs: number; toMs: number; startedAtMs: number };

export type DirectorEvent =
  /** A point just ended (server times from the recorder); `finalCard`: the Final card is up. */
  | { t: "pointEnd"; notable: boolean; pointStartMs: number | null; pointEndMs: number; finalCard: boolean }
  /** A match update. */
  | { t: "phase"; phase: MatchPhase; tossing: boolean }
  /** A Player skipped the replay (relayed by the server). */
  | { t: "skip" }
  /** Time passes: ends a replay whose clip is over. */
  | { t: "tick" };

const LIVE: DirectorState = { mode: "live" };

/** True while a replay is on screen (held, but not yet started, counts as live). */
export function isPlaying(s: DirectorState, nowMs: number): s is Extract<DirectorState, { mode: "replay" }> {
  return s.mode === "replay" && nowMs >= s.startedAtMs;
}

/** The recording's server time to show at local time `nowMs`. */
export function clipTime(s: Extract<DirectorState, { mode: "replay" }>, nowMs: number): number {
  return s.fromMs + (nowMs - s.startedAtMs) * REPLAY_SPEED;
}

export function nextState(s: DirectorState, ev: DirectorEvent, nowMs: number): DirectorState {
  switch (ev.t) {
    case "pointEnd": {
      // Never over a replay already held or playing, nor over the Final card.
      if (s.mode === "replay" || ev.finalCard || !ev.notable) return s;
      return { mode: "replay", ...clipFor(ev.pointStartMs, ev.pointEndMs), startedAtMs: nowMs + REPLAY_DELAY_MS };
    }
    case "phase":
      // The toss is the cut: the server must see their toss, and the receivers the serve.
      if (s.mode === "replay" && (ev.phase === "rally" || (ev.phase === "serve" && ev.tossing))) return LIVE;
      return s;
    case "skip":
      return s.mode === "replay" ? LIVE : s;
    case "tick":
      if (s.mode === "replay" && nowMs >= s.startedAtMs + (s.toMs - s.fromMs) / REPLAY_SPEED) return LIVE;
      return s;
  }
}

/**
 * The point a match update just ended, or null: a new point, game or set event, or a double
 * fault's point. `prev` is the state before it (the score the point was played at); the first
 * state seen never counts, so joining mid-break replays nothing. Pure.
 */
export function pointOutcome(
  m: MatchMsg,
  prev: MatchMsg | null,
): { winner: Team; goldenPoint: boolean; matchPoint: boolean } | null {
  if (!prev || !m.eventKind || !m.eventTeam) return null;
  if (eventKey(m) === eventKey(prev)) return null;
  const pointEvent = m.eventKind === "point" || m.eventKind === "game" || m.eventKind === "set" || m.eventKind === "fault";
  if (!pointEvent) return null;
  return {
    winner: m.eventTeam,
    // Played at 40–40 outside a tiebreak: the deciding golden point.
    goldenPoint: !prev.tiebreak && prev.pointA === "40" && prev.pointB === "40",
    matchPoint: m.eventKind === "set",
  };
}

function eventKey(m: MatchMsg): string | null {
  return m.eventKind ? `${m.eventKind}|${m.eventTeam ?? ""}|${m.event ?? ""}` : null;
}
