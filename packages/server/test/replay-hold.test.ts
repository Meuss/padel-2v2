import { describe, expect, it } from "vitest";
import { isNotable, replayLengthMs, type MatchMsg, type ShotKind, type Team } from "@padel/shared";
import { Room } from "../src/room.js";
import { fakeClient } from "./fakes.js";

const POINT_ORDER = ["0", "15", "30", "40"];
const scoreOf = (m: MatchMsg, team: Team) =>
  (team === "A" ? m.gamesA : m.gamesB) * 1000 +
  (m.tiebreak ? Number(team === "A" ? m.pointA : m.pointB) : POINT_ORDER.indexOf(team === "A" ? m.pointA : m.pointB));

interface PointSeen {
  notable: boolean;
  /** Server time of the snapshot carrying the serve, as a client's recorder sees it. */
  startMs: number | null;
  endMs: number;
  tossMs: number | null;
}

/** Four seeded bots watched like a client would: each point, whether it is notable, and when the next toss came. */
function watchPoints(room: Room, w: ReturnType<typeof fakeClient>, maxSteps: number, enough: (p: PointSeen[]) => boolean) {
  const points: PointSeen[] = [];
  let read = 0;
  let startMs: number | null = null;
  let shots: { team: Team; kind: ShotKind }[] = [];
  let atServe: MatchMsg | null = null;
  let phase = "";
  let tossing = false;
  for (let i = 0; i < maxSteps && !enough(points); i++) {
    room.step();
    const all = w.messages();
    for (; read < all.length; read++) {
      const m = all[read]!;
      if (m.t === "snapshot") {
        for (const s of m.shots ?? []) {
          if (s.kind === "serve") {
            startMs = m.serverTime;
            shots = [];
          }
          shots.push({ team: s.slot[0] as Team, kind: s.kind });
        }
        continue;
      }
      if (m.t !== "match") continue;
      const ended = (m.phase === "between" || m.phase === "over") && phase !== m.phase;
      if (ended && atServe && m.eventTeam && m.eventKind !== "fault") {
        const winner: Team = scoreOf(m, "A") > scoreOf(atServe, "A") ? "A" : "B";
        let last: ShotKind | null = null;
        for (const s of shots) if (s.team === winner) last = s.kind;
        const notable = isNotable({
          shots: shots.length,
          lastWinnerShot: last,
          goldenPoint: !atServe.tiebreak && atServe.pointA === "40" && atServe.pointB === "40",
          matchPoint: m.phase === "over",
        });
        points.push({ notable, startMs, endMs: room.serverTime, tossMs: null });
      }
      if (m.tossing && !tossing) {
        const open = points.at(-1);
        if (open && open.tossMs === null) open.tossMs = room.serverTime;
      }
      if (m.phase === "serve" && !m.tossing) atServe = m;
      phase = m.phase;
      tossing = m.tossing;
    }
  }
  return points;
}

describe("a Bot holds its toss for the replay", () => {
  it("after a notable point, the Bot tosses only once a client's replay of it is over", async () => {
    const room = await Room.create({ seed: 4 });
    const w = fakeClient("w");
    room.addClient(w.client);
    room.debugAddBots(4);
    const points = watchPoints(room, w, 60 * 60 * 10, (ps) =>
      [true, false].every((n) => ps.some((p) => p.notable === n && p.tossMs !== null)),
    );
    room.stop();
    const notable = points.filter((p) => p.notable && p.tossMs !== null);
    expect(notable.length).toBeGreaterThan(0);
    for (const p of notable) {
      expect(p.tossMs! - p.endMs).toBeGreaterThanOrEqual(replayLengthMs(p.startMs, p.endMs));
    }
    // A plain point keeps the usual pace: no replay to wait for.
    const plain = points.filter((p) => !p.notable && p.tossMs !== null);
    expect(plain.length).toBeGreaterThan(0);
    for (const p of plain) expect(p.tossMs! - p.endMs).toBeLessThan(3500);
  }, 60_000);
});
