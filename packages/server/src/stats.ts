/**
 * Match statistics for the Final card: per-team Shots, perfect Timing, Smashes and points won,
 * the longest Rally, and the match length. The room feeds it every Shot and every point.
 */
import type { MatchStats, ShotKind, Team, TeamStats, Timing } from "@padel/shared";

const emptyTeam = (): TeamStats => ({ shots: 0, perfect: 0, smashes: 0, points: 0 });

export class MatchStatsTracker {
  private teams: Record<Team, TeamStats> = { A: emptyTeam(), B: emptyTeam() };
  /** Shots in the Rally under way: a serve starts a new one. */
  private rally = 0;
  private longestRally = 0;
  private endedAt: number | null = null;

  /** `startedAt` is the room's simulation clock (ms) when the match started. */
  constructor(private readonly startedAt: number) {}

  shot(team: Team, kind: ShotKind, timing: Timing): void {
    const t = this.teams[team];
    t.shots++;
    if (timing === "perfect") t.perfect++;
    if (kind === "smash") t.smashes++;
    this.rally = kind === "serve" ? 1 : this.rally + 1;
  }

  /** A point went to `winner`: it closes the Rally under way. */
  point(winner: Team): void {
    this.teams[winner].points++;
    this.longestRally = Math.max(this.longestRally, this.rally);
    this.rally = 0;
  }

  /** The match ended at `now` (simulation clock, ms); the duration stops there. */
  finish(now: number): void {
    this.endedAt ??= now;
  }

  /** The statistics so far; the duration runs to `now` until the match is finished. */
  snapshot(now: number): MatchStats {
    return {
      A: { ...this.teams.A },
      B: { ...this.teams.B },
      longestRally: this.longestRally,
      durationS: Math.round(((this.endedAt ?? now) - this.startedAt) / 1000),
    };
  }
}
