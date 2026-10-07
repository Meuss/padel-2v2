/**
 * The Instant replay's recording: the last RECORD_MS of snapshots as they arrive (shallow
 * copies: the decoded snapshot's own objects, never mutated), and the shots of the current
 * point, which starts at its serve ShotEvent.
 */
import type { ContactEvent, PlayerState, ShotEvent, ShotKind, SnapshotMsg, Team, Vec3 } from "@padel/shared";

/** How much play is kept: comfortably more than a clip plus its start delay. */
export const RECORD_MS = 8000;

export interface RecordedFrame {
  serverTime: number;
  ball: Vec3;
  players: readonly PlayerState[];
  shots: readonly ShotEvent[];
  contacts: readonly ContactEvent[];
}

const NONE: readonly never[] = [];

export class ReplayRecorder {
  private buf: RecordedFrame[] = [];
  private startMs: number | null = null;
  /** Shots since the current point's serve. */
  private shots: ShotEvent[] = [];

  /** Recorded frames, oldest first. */
  get frames(): readonly RecordedFrame[] {
    return this.buf;
  }

  /** Server time of the newest frame, or null before any. */
  get newestMs(): number | null {
    return this.buf.length > 0 ? this.buf[this.buf.length - 1]!.serverTime : null;
  }

  /** Server time of the current point's serve, or null if it was not seen. */
  get pointStartMs(): number | null {
    return this.startMs;
  }

  add(s: SnapshotMsg): void {
    const newest = this.newestMs;
    // A late (out-of-order) snapshot adds nothing a replay needs.
    if (newest !== null && s.serverTime <= newest) return;
    const shots = s.shots ?? NONE;
    this.buf.push({ serverTime: s.serverTime, ball: s.ball.pos, players: s.players, shots, contacts: s.contacts ?? NONE });
    while (this.buf[0]!.serverTime < s.serverTime - RECORD_MS) this.buf.shift();
    for (const shot of shots) {
      if (shot.kind === "serve") {
        this.startMs = s.serverTime;
        this.shots.length = 0;
      }
      this.shots.push(shot);
    }
  }

  /** The current point's shot count (serve included) and the last shot `winner`'s team struck. */
  pointSummary(winner: Team): { shots: number; lastWinnerShot: ShotKind | null } {
    let last: ShotKind | null = null;
    for (const shot of this.shots) if (shot.slot.startsWith(winner)) last = shot.kind;
    return { shots: this.shots.length, lastWinnerShot: last };
  }

  /** Forget everything (on a new Welcome: a restarted server's clock starts elsewhere). */
  reset(): void {
    this.buf = [];
    this.startMs = null;
    this.shots.length = 0;
  }
}
