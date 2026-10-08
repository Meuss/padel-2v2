import {
  REPLAY_DELAY_MS,
  REPLAY_MAX_MS,
  REPLAY_SPEED,
  clipFor,
  isNotable,
  replayLengthMs,
  type MatchMsg,
  type ShotEvent,
  type SnapshotMsg,
  type Slot,
} from "@padel/shared";
import { describe, expect, it } from "vitest";
import {
  clipTime,
  isPlaying,
  nextState,
  pointOutcome,
  type DirectorEvent,
  type DirectorState,
} from "../src/replay/director.js";
import { RECORD_MS, ReplayRecorder } from "../src/replay/recorder.js";
import { FINAL_DELAY_MS, finalDue } from "../src/replay/controller.js";
import { ReplayPlayer } from "../src/replay/player.js";

function msg(over: Partial<MatchMsg> = {}): MatchMsg {
  return {
    t: "match",
    phase: "rally",
    pointA: "0",
    pointB: "0",
    gamesA: 0,
    gamesB: 0,
    tiebreak: false,
    sideA: -1,
    serverSlot: "A1",
    serveBox: "deuce",
    awaitingServe: false,
    tossing: false,
    event: null,
    eventKind: null,
    eventTeam: null,
    reason: null,
    highlight: null,
    winner: null,
    stats: null,
    ...over,
  };
}

function shot(slot: Slot, kind: ShotEvent["kind"]): ShotEvent {
  return { slot, kind, timing: "perfect", pos: { x: 0, y: 1, z: 0 } };
}

function snap(serverTime: number, over: Partial<SnapshotMsg> = {}): SnapshotMsg {
  return {
    t: "snapshot",
    tick: serverTime / 50,
    serverTime,
    ball: { pos: { x: serverTime / 1000, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    players: [{ slot: "A1", pos: { x: 0, y: 0, z: -serverTime / 1000 }, yaw: 0 }],
    ...over,
  };
}

const plain = { shots: 2, lastWinnerShot: "drive" as const, goldenPoint: false, matchPoint: false };

describe("isNotable", () => {
  it("a short, plain point is not notable", () => {
    expect(isNotable(plain)).toBe(false);
    expect(isNotable({ ...plain, shots: 5 })).toBe(false);
  });
  it("a rally of at least 6 shots is", () => {
    expect(isNotable({ ...plain, shots: 6 })).toBe(true);
  });
  it("a point won on a Smash is", () => {
    expect(isNotable({ ...plain, lastWinnerShot: "smash" })).toBe(true);
  });
  it("the golden point is", () => {
    expect(isNotable({ ...plain, goldenPoint: true })).toBe(true);
  });
  it("the set point that ended the match is", () => {
    expect(isNotable({ ...plain, matchPoint: true })).toBe(true);
  });
});

describe("pointOutcome", () => {
  it("reads a won point, with golden and match point flags", () => {
    expect(pointOutcome(msg({ phase: "between", eventKind: "point", eventTeam: "A", event: "POINT — AZUL" }), msg())).toEqual({
      winner: "A",
      goldenPoint: false,
      matchPoint: false,
    });
    const at4040 = msg({ pointA: "40", pointB: "40" });
    expect(pointOutcome(msg({ phase: "between", eventKind: "game", eventTeam: "B" }), at4040)?.goldenPoint).toBe(true);
    expect(pointOutcome(msg({ phase: "over", eventKind: "set", eventTeam: "B" }), msg())?.matchPoint).toBe(true);
  });
  it("a double fault ends a point, a first-serve fault or a let does not", () => {
    expect(pointOutcome(msg({ eventKind: "fault", eventTeam: "B" }), msg())?.winner).toBe("B");
    expect(pointOutcome(msg({ eventKind: "fault", eventTeam: null }), msg())).toBeNull();
    expect(pointOutcome(msg({ eventKind: "let" }), msg())).toBeNull();
  });
  it("only a new event counts, and never the first state seen", () => {
    const won = msg({ phase: "between", eventKind: "point", eventTeam: "A", event: "POINT — AZUL" });
    expect(pointOutcome(won, null)).toBeNull();
    expect(pointOutcome({ ...won, phase: "serve" }, won)).toBeNull();
  });
});

describe("clipFor", () => {
  it("starts 0.6 s before the serve of a short point", () => {
    expect(clipFor(10_000, 12_000)).toEqual({ fromMs: 9_400, toMs: 12_000 });
  });
  it("keeps only the last 4.5 s of a long point (or one whose serve was never seen)", () => {
    expect(clipFor(10_000, 20_000)).toEqual({ fromMs: 20_000 - REPLAY_MAX_MS, toMs: 20_000 });
    expect(clipFor(null, 20_000)).toEqual({ fromMs: 20_000 - REPLAY_MAX_MS, toMs: 20_000 });
  });
});

describe("nextState", () => {
  const live: DirectorState = { mode: "live" };
  const notableEnd: DirectorEvent = { t: "pointEnd", notable: true, pointStartMs: 11_000, pointEndMs: 14_000, finalCard: false };
  const tick: DirectorEvent = { t: "tick" };
  const T = 50_000; // local clock at the point end

  /** A replay that started at local time T + REPLAY_DELAY_MS. */
  const replaying = (): DirectorState => nextState(live, notableEnd, T);

  it("live goes to replay on a notable point end, starting after the delay", () => {
    const s = replaying();
    expect(s).toEqual({ mode: "replay", fromMs: 10_400, toMs: 14_000, startedAtMs: T + REPLAY_DELAY_MS });
    expect(isPlaying(s, T + REPLAY_DELAY_MS - 1)).toBe(false);
    expect(isPlaying(s, T + REPLAY_DELAY_MS)).toBe(true);
  });

  it("stays live on a point that is not notable", () => {
    expect(nextState(live, { ...notableEnd, notable: false }, T)).toBe(live);
  });

  it("plays the clip at 0.85× speed and ends with it", () => {
    const s = replaying();
    const start = T + REPLAY_DELAY_MS;
    expect(clipTime(s, start)).toBe(10_400);
    expect(clipTime(s, start + 1000)).toBeCloseTo(10_400 + 1000 * REPLAY_SPEED);
    const length = (14_000 - 10_400) / REPLAY_SPEED;
    expect(nextState(s, tick, start + length - 1)).toBe(s);
    expect(nextState(s, tick, start + length)).toEqual(live);
  });

  it("a serve toss cuts it immediately", () => {
    const s = replaying();
    const now = T + REPLAY_DELAY_MS + 500;
    expect(nextState(s, { t: "phase", phase: "serve", tossing: false }, now)).toBe(s);
    expect(nextState(s, { t: "phase", phase: "serve", tossing: true }, now)).toEqual(live);
  });

  it("a toss also cancels a replay that has not started yet", () => {
    expect(nextState(replaying(), { t: "phase", phase: "serve", tossing: true }, T + 100)).toEqual(live);
  });

  it("a skip ends it, and a rally start ends it", () => {
    const now = T + REPLAY_DELAY_MS + 500;
    expect(nextState(replaying(), { t: "skip" }, now)).toEqual(live);
    expect(nextState(replaying(), { t: "phase", phase: "rally", tossing: false }, now)).toEqual(live);
  });

  it("the between phase leaves it running", () => {
    const s = replaying();
    expect(nextState(s, { t: "phase", phase: "between", tossing: false }, T + 10)).toBe(s);
  });

  it("no replay starts over the Final card", () => {
    expect(nextState(live, { ...notableEnd, finalCard: true }, T)).toBe(live);
  });

  it("no replay starts over another replay", () => {
    const s = replaying();
    expect(nextState(s, { ...notableEnd, pointStartMs: 16_000, pointEndMs: 19_000 }, T + 2000)).toBe(s);
  });

  it("skip and tick are no-ops while live", () => {
    expect(nextState(live, { t: "skip" }, T)).toBe(live);
    expect(nextState(live, tick, T)).toBe(live);
  });
});

describe("ReplayRecorder", () => {
  it("keeps 8 s of snapshots and drops older frames", () => {
    const r = new ReplayRecorder();
    for (let t = 0; t <= 10_000; t += 50) r.add(snap(t));
    expect(r.frames[0]!.serverTime).toBe(10_000 - RECORD_MS);
    expect(r.frames[r.frames.length - 1]!.serverTime).toBe(10_000);
    expect(r.newestMs).toBe(10_000);
  });

  it("marks a point start at each serve and summarises the point for its winner", () => {
    const r = new ReplayRecorder();
    expect(r.pointStartMs).toBeNull();
    r.add(snap(1000, { shots: [shot("A1", "serve")] }));
    r.add(snap(1500, { shots: [shot("B1", "drive")] }));
    r.add(snap(2000, { shots: [shot("A2", "smash")] }));
    r.add(snap(2500, { shots: [shot("B2", "lob")] }));
    expect(r.pointStartMs).toBe(1000);
    expect(r.pointSummary("A")).toEqual({ shots: 4, lastWinnerShot: "smash" });
    expect(r.pointSummary("B")).toEqual({ shots: 4, lastWinnerShot: "lob" });
    // A new serve starts a new point.
    r.add(snap(5000, { shots: [shot("B1", "serve")] }));
    expect(r.pointStartMs).toBe(5000);
    expect(r.pointSummary("A")).toEqual({ shots: 1, lastWinnerShot: null });
  });

  it("forgets everything on reset", () => {
    const r = new ReplayRecorder();
    r.add(snap(1000, { shots: [shot("A1", "serve")] }));
    r.reset();
    expect(r.frames).toHaveLength(0);
    expect(r.newestMs).toBeNull();
    expect(r.pointStartMs).toBeNull();
  });
});

describe("ReplayPlayer", () => {
  it("interpolates recorded positions and hands each recorded event over once", () => {
    const r = new ReplayRecorder();
    r.add(snap(1000, { shots: [shot("A1", "serve")] }));
    r.add(snap(1050));
    r.add(snap(1100, { contacts: [{ surface: "floor", pos: { x: 0, y: 0, z: 1 }, speed: 10 }] }));
    const p = new ReplayPlayer(r);
    const seen: number[] = [];
    const onEvents = (t: number) => seen.push(t);
    p.start(1000);
    expect(p.advance(1025, onEvents)).toBe(true);
    expect(p.pose.ball.x).toBeCloseTo(1.025);
    expect(p.pose.count).toBe(1);
    expect(p.pose.players[0]!.slot).toBe("A1");
    expect(p.pose.players[0]!.pos.z).toBeCloseTo(-1.025);
    expect(seen).toEqual([1000]);
    p.advance(1100, onEvents);
    expect(seen).toEqual([1000, 1100]);
    p.advance(1100, onEvents);
    expect(seen).toEqual([1000, 1100]);
  });

  it("reports nothing to show when the clip is not recorded", () => {
    const p = new ReplayPlayer(new ReplayRecorder());
    p.start(0);
    expect(p.advance(10, () => {})).toBe(false);
  });
});

describe("a Bot's toss after a notable point", () => {
  it("comes after the replay of a typical notable clip has ended", () => {
    // A 7-shot rally: served at 10 s, over at 16.2 s (server time). The point end reaches the
    // client at local T; the server holds a Bot's toss until replayLengthMs after the point end.
    const T = 50_000;
    const pointStartMs = 10_000;
    const pointEndMs = 16_200;
    const botToss = T + replayLengthMs(pointStartMs, pointEndMs);
    let s: DirectorState = { mode: "live" };
    s = nextState(s, { t: "pointEnd", notable: true, pointStartMs, pointEndMs, finalCard: false }, T);
    expect(isPlaying(s, T + REPLAY_DELAY_MS)).toBe(true);
    // Still playing just before the toss, and over by the tick at the toss: the clip reached its end.
    expect(nextState(s, { t: "tick" }, botToss - 20).mode).toBe("replay");
    expect(nextState(s, { t: "tick" }, botToss).mode).toBe("live");
    if (s.mode === "replay") expect(clipTime(s, botToss)).toBeCloseTo(pointEndMs);
  });
});

describe("finalDue: the Final card's timing", () => {
  it("opens FINAL_DELAY_MS after the match ends when there is no replay", () => {
    const T = 1_000;
    const dueAt = T + FINAL_DELAY_MS;
    expect(finalDue(dueAt, dueAt - 1, true)).toBe(false);
    expect(finalDue(dueAt, dueAt, true)).toBe(true);
    expect(finalDue(null, dueAt, true)).toBe(false);
  });

  it("waits for the match point's replay to end, then opens", () => {
    const T = 1_000;
    const dueAt = T + FINAL_DELAY_MS;
    let s: DirectorState = { mode: "live" };
    s = nextState(s, { t: "pointEnd", notable: true, pointStartMs: 10_000, pointEndMs: 13_000, finalCard: false }, T);
    const now = dueAt + 100;
    s = nextState(s, { t: "tick" }, now);
    expect(s.mode).toBe("replay");
    expect(finalDue(dueAt, now, s.mode === "live")).toBe(false);
    const end = T + replayLengthMs(10_000, 13_000);
    s = nextState(s, { t: "tick" }, end);
    expect(finalDue(dueAt, end, s.mode === "live")).toBe(true);
  });
});
