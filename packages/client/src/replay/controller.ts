/**
 * The Instant replay, put together for the page: the recorder (fed every snapshot), the director
 * (fed every match update, a tick each frame and skips) and the player that poses the recorded
 * play. It tells the page when the replay view goes on or off, and whether the Final card may open.
 */
import { isNotable, type MatchMsg, type SnapshotMsg } from "@padel/shared";
import { clipTime, isPlaying, nextState, pointOutcome, type DirectorEvent, type DirectorState } from "./director.js";
import { ReplayPlayer, type ReplayEventHandler, type ReplayPose } from "./player.js";
import { ReplayRecorder } from "./recorder.js";

/** The Final card comes this long after the Set Banner (or when the match-point replay ends). */
export const FINAL_DELAY_MS = 1200;

/**
 * Whether the Final card, due at `dueAt` (local clock; null when none is waiting), opens now: its
 * delay is over and no replay is held or playing (the match point's replay plays first). Pure.
 */
export function finalDue(dueAt: number | null, nowMs: number, directorLive: boolean): boolean {
  return dueAt !== null && nowMs >= dueAt && directorLive;
}

/** What the controller needs from the page. */
export interface ReplayHost {
  /** The replay view (Broadcast cam, recorded play, REPLAY tag) goes on or off. */
  setView(on: boolean): void;
  /** The Final card is up: no replay starts over it. */
  finalCardShowing(): boolean;
  /** Dev only: every point counts as notable. */
  forceNotable(): boolean;
}

const LIVE: DirectorState = { mode: "live" };
const TICK: DirectorEvent = { t: "tick" };
const SKIP: DirectorEvent = { t: "skip" };

export class ReplayController {
  /** The last seconds of play, recorded as snapshots arrive. */
  private readonly recorder = new ReplayRecorder();
  private readonly player = new ReplayPlayer(this.recorder);
  private director: DirectorState = LIVE;
  private shown = false;

  constructor(private readonly host: ReplayHost) {}

  /** Whether the replay view is on screen. */
  get showing(): boolean {
    return this.shown;
  }

  /** No replay is held or playing. */
  get live(): boolean {
    return this.director.mode === "live";
  }

  onSnapshot(msg: SnapshotMsg): void {
    this.recorder.add(msg);
  }

  /** A new Welcome: forget the recording (a restarted server's clock starts elsewhere) and go live. */
  reset(nowMs: number): void {
    this.recorder.reset();
    this.director = LIVE;
    this.sync(nowMs);
  }

  /**
   * On each match update: a point that just ended may queue a replay of its clip (notable
   * points only), and a toss or a rally start cuts a replay back to live.
   */
  onMatch(m: MatchMsg, prev: MatchMsg | null, nowMs: number): void {
    const outcome = pointOutcome(m, prev);
    const end = this.recorder.newestMs;
    if (outcome && end !== null) {
      const notable = this.host.forceNotable() || isNotable({ ...this.recorder.pointSummary(outcome.winner), ...outcome });
      const pointStartMs = this.recorder.pointStartMs;
      const ev: DirectorEvent = { t: "pointEnd", notable, pointStartMs, pointEndMs: end, finalCard: this.host.finalCardShowing() };
      this.director = nextState(this.director, ev, nowMs);
    }
    this.director = nextState(this.director, { t: "phase", phase: m.phase, tossing: m.tossing }, nowMs);
    this.sync(nowMs);
  }

  /** A Player skipped (us, or anyone through the server): back to live at once. */
  skip(nowMs: number): void {
    this.director = nextState(this.director, SKIP, nowMs);
    this.sync(nowMs);
  }

  /** Once per frame, before anything is drawn: a clip that is over ends, a held one starts. */
  tick(nowMs: number): void {
    this.director = nextState(this.director, TICK, nowMs);
    this.sync(nowMs);
  }

  /**
   * While the replay view is on: the recorded pose at this frame, handing `onEvents` the recorded
   * events the clip has reached. Null when no replay is showing or nothing is recorded there.
   */
  pose(nowMs: number, onEvents: ReplayEventHandler): ReplayPose | null {
    if (!this.shown || this.director.mode !== "replay") return null;
    return this.player.advance(clipTime(this.director, nowMs), onEvents) ? this.player.pose : null;
  }

  /** Show or leave the replay view to match the director (after every director change). */
  private sync(nowMs: number): void {
    const on = isPlaying(this.director, nowMs);
    if (on === this.shown) return;
    this.shown = on;
    if (on && this.director.mode === "replay") this.player.start(this.director.fromMs);
    this.host.setView(on);
  }
}
