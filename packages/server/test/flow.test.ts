import { describe, expect, it } from "vitest";
import {
  TICK_MS,
  TICK_RATE,
  type MatchMsg,
  type ServerMessage,
  type ShotEvent,
  type SnapshotMsg,
  type Team,
} from "@padel/shared";
import { Room } from "../src/room.js";
import { fakeClient, sendInput, stepUntil } from "./fakes.js";

const SEED = 11;
/** Long physics runs (thousands of steps) get room on a loaded CI machine. */
const LONG_TEST_MS = 30_000;

const matches = (msgs: readonly ServerMessage[]) => msgs.filter((m): m is MatchMsg => m.t === "match");
const shotsIn = (msgs: readonly ServerMessage[]): ShotEvent[] =>
  msgs.filter((m): m is SnapshotMsg => m.t === "snapshot").flatMap((s) => s.shots ?? []);
const teamOfSlot = (slot: string): Team => (slot.startsWith("A") ? "A" : "B");
const POINT_ORDER = ["0", "15", "30", "40"];
const scoreOf = (m: MatchMsg, team: Team) =>
  (team === "A" ? m.gamesA : m.gamesB) * 100 + POINT_ORDER.indexOf(team === "A" ? m.pointA : m.pointB);

/** Four seeded bots watched by a spectator. */
async function botRoom(seed = SEED) {
  const room = await Room.create({ seed });
  const w = fakeClient("w1");
  room.addClient(w.client);
  room.debugAddBots(4);
  const match = () => w.last("match")!;
  return { room, w, match };
}

/** Humans in the given seats order (A1, B1, A2, B2), the rest filled with bots. */
async function mixedRoom(humans: string[], bots: number) {
  const room = await Room.create({ seed: SEED });
  const clients = humans.map((id) => {
    const c = fakeClient(id);
    room.addClient(c.client);
    room.claimSlot(id, id);
    return c;
  });
  room.debugAddBots(bots);
  room.step();
  return { room, clients };
}

describe("structured match events", () => {
  it("a bot point carries eventKind and the winning eventTeam, with English copy", async () => {
    const { room, w, match } = await botRoom();
    room.step();
    expect(match().eventKind).toBe("start");
    expect(match().event).toBe("MATCH");
    expect(match().eventTeam).toBeNull();

    const won = (m: MatchMsg) => m.eventKind === "point" || m.eventKind === "game";
    expect(stepUntil(room, () => won(match()), 90 * TICK_RATE)).not.toBeNull();
    const all = matches(w.messages());
    const end = all[all.length - 1]!;
    const before = [...all].reverse().find((m) => m.phase === "serve")!;
    const winner: Team = scoreOf(end, "A") > scoreOf(before, "A") ? "A" : "B";
    expect(end.eventTeam).toBe(winner);
    expect(end.event).toBe(`${end.eventKind === "point" ? "POINT" : "GAME"} — ${winner === "A" ? "AZUL" : "ROJO"}`);
    expect(end.stats).toBeNull();
    room.stop();
  }, LONG_TEST_MS);

  it("a first Fault is FALTA with no team; a double fault gives the point to the receivers", async () => {
    // A1 is a human who serves first and lets both tosses fall.
    const { room, clients } = await mixedRoom(["p1"], 1);
    const p = clients[0]!;
    const match = () => p.last("match")!;
    sendInput(room, "p1", { serve: true });
    expect(stepUntil(room, () => match().eventKind === "fault", 120)).not.toBeNull();
    expect(match().event).toBe("FAULT");
    expect(match().eventTeam).toBeNull();
    expect(stepUntil(room, () => match().phase === "serve", 200)).not.toBeNull();
    sendInput(room, "p1", { serve: true });
    expect(stepUntil(room, () => match().eventTeam !== null, 120)).not.toBeNull();
    expect(match().eventKind).toBe("fault");
    expect(match().event).toBe("DOUBLE FAULT");
    expect(match().eventTeam).toBe("B");
    expect(match().pointB).toBe("15");
    room.stop();
  });
});

describe("match stats", () => {
  it("count each team's shots, perfect shots and smashes, and the longest rally", async () => {
    const { room, w, match } = await botRoom();
    const steps = 90 * TICK_RATE;
    for (let i = 0; i < steps; i++) room.step();
    // End the match at a point break, so no rally is under way (bot rallies can run past a minute).
    const waited = stepUntil(room, () => match().phase === "between", 180 * TICK_RATE);
    expect(waited).not.toBeNull();
    expect(matches(w.messages()).every((m) => m.stats === null)).toBe(true);
    room.debugEndMatch("A");
    for (let i = 0; i < 4; i++) room.step(); // flush the last snapshot's shots
    const end = match();
    expect(end.phase).toBe("over");
    expect(end.eventKind).toBe("set");
    expect(end.event).toBe("SET & MATCH — AZUL");
    const stats = end.stats!;
    expect(stats).not.toBeNull();

    const shots = shotsIn(w.messages());
    for (const team of ["A", "B"] as const) {
      const mine = shots.filter((s) => teamOfSlot(s.slot) === team);
      expect(stats[team].shots).toBe(mine.length);
      expect(stats[team].perfect).toBe(mine.filter((s) => s.timing === "perfect").length);
      expect(stats[team].smashes).toBe(mine.filter((s) => s.kind === "smash").length);
    }
    expect(stats.A.shots + stats.B.shots).toBeGreaterThan(20);

    let rally = 0;
    let longest = 0;
    for (const s of shots) {
      rally = s.kind === "serve" ? 1 : rally + 1;
      longest = Math.max(longest, rally);
    }
    expect(stats.longestRally).toBe(longest);
    expect(stats.longestRally).toBeGreaterThan(1);

    // Points: each point break names its winner once (debugEndMatch counts as one more for A).
    const ends = matches(w.messages()).filter(
      (m, i, all) => m.eventTeam !== null && (m.phase === "between" || m.phase === "over") && all[i - 1]?.phase !== m.phase,
    );
    expect(stats.A.points).toBe(ends.filter((m) => m.eventTeam === "A").length);
    expect(stats.B.points).toBe(ends.filter((m) => m.eventTeam === "B").length);

    // The duration stops at the end of the match.
    const simulatedS = ((steps + waited! + 4) * TICK_MS) / 1000;
    expect(stats.durationS).toBeGreaterThan(80);
    expect(stats.durationS).toBeLessThanOrEqual(Math.ceil(simulatedS));
    for (let i = 0; i < 2 * TICK_RATE; i++) room.step();
    expect(room.matchMessage().stats!.durationS).toBe(stats.durationS);
    room.stop();
  }, LONG_TEST_MS);
});

describe("rematch vote", () => {
  it("opens when the match ends; when every seated human accepts, the match restarts", async () => {
    const { room, clients } = await mixedRoom(["p1", "p2"], 2);
    const [p1] = clients as [ReturnType<typeof fakeClient>, ReturnType<typeof fakeClient>];
    room.debugEndMatch("B");
    room.step();
    expect(p1.last("match")).toMatchObject({ phase: "over", winner: "B", eventKind: "set", eventTeam: "B" });
    expect(p1.last("match")!.event).toBe("SET & MATCH — ROJO");
    // Bots don't vote: two humans are needed, not four seats.
    expect(p1.last("vote")).toMatchObject({
      active: true,
      kind: "rematch",
      initiator: "MEUSS PADEL CLUB",
      accepted: 0,
      needed: 2,
    });

    room.requestResetVote("p1");
    expect(p1.last("vote")).toMatchObject({ active: true, kind: "rematch", accepted: 1, needed: 2 });
    expect(p1.last("match")!.phase).toBe("over");

    room.requestResetVote("p2");
    expect(p1.last("vote")!.active).toBe(false);
    expect(p1.last("match")).toMatchObject({ phase: "serve", gamesA: 0, gamesB: 0, eventKind: "reset", winner: null, stats: null });
    expect(p1.last("match")!.event).toBe("RESET");
    room.stop();
  });

  it("counts only the humans still seated when one leaves", async () => {
    const { room, clients } = await mixedRoom(["p1", "p2"], 2);
    const p1 = clients[0]!;
    room.debugEndMatch("A");
    room.step();
    room.requestResetVote("p1");
    expect(p1.last("vote")).toMatchObject({ kind: "rematch", accepted: 1, needed: 2 });
    room.removeClient("p2");
    // p1 was the last seated human still to accept: the rematch passes.
    expect(p1.last("vote")!.active).toBe(false);
    expect(p1.last("match")!.phase).toBe("serve");
    room.stop();
  });

  it("is not opened again for the same match", async () => {
    const { room, clients } = await mixedRoom(["p1"], 3);
    const p1 = clients[0]!;
    room.debugEndMatch("A");
    room.step();
    room.declineVote("p1");
    for (let i = 0; i < 30; i++) room.step();
    expect(p1.last("vote")!.active).toBe(false);
    expect(p1.last("match")!.phase).toBe("over");
    room.stop();
  });
});

describe("take seat", () => {
  it("replaces a bot at once between points, where the bot stood", async () => {
    const { room, w, match } = await botRoom();
    const s = fakeClient("s1");
    room.addClient(s.client);
    expect(room.claimSlot("s1", "s1")).toBeNull();
    expect(stepUntil(room, () => match().phase === "between", 90 * TICK_RATE)).not.toBeNull();
    // Take the seat right after a snapshot, so it shows where the bot stands now.
    const snaps = () => w.messages().filter((m) => m.t === "snapshot").length;
    const n = snaps();
    stepUntil(room, () => snaps() > n, 10);
    const botAt = w.last("snapshot")!.players.find((p) => p.slot === "A1")!.pos;

    expect(room.takeSeat("s1")).toBe(true);
    expect(s.last("welcome")).toMatchObject({ role: "player", slot: "A1", team: "A" });
    const roster = w.last("roster")!;
    expect(roster.players).toHaveLength(4);
    expect(roster.players.find((p) => p.slot === "A1")).toMatchObject({ id: "s1", isBot: false });
    expect(roster.players.filter((p) => p.isBot)).toHaveLength(3);
    expect(roster.spectatorCount).toBe(1);

    const m = snaps();
    stepUntil(room, () => snaps() > m, 10);
    const humanAt = w.last("snapshot")!.players.find((p) => p.slot === "A1")!.pos;
    expect(Math.hypot(humanAt.x - botAt.x, humanAt.z - botAt.z)).toBeLessThan(0.01);
    room.stop();
  }, LONG_TEST_MS);

  it("prefers a free seat, then a bot on the team with fewer humans", async () => {
    // Humans in A1 and B1 (rotation order), a bot in A2: B2 is free.
    const { room } = await mixedRoom(["p1", "p2"], 1);
    const s1 = fakeClient("s1");
    const s2 = fakeClient("s2");
    room.addClient(s1.client);
    room.addClient(s2.client);
    expect(room.takeSeat("s1")).toBe(true);
    expect(s1.last("welcome")!.slot).toBe("B2");
    expect(room.takeSeat("s2")).toBe(true);
    expect(s2.last("welcome")!.slot).toBe("A2");
    room.stop();

    // Bots in A1, B1 and B2, a human in A2: Rojo has fewer humans, so B1 goes before A1.
    const room2 = await Room.create({ seed: SEED });
    room2.debugAddBots(2);
    const p = fakeClient("p1");
    room2.addClient(p.client);
    room2.claimSlot("p1", "p1");
    room2.debugAddBots(1);
    const t1 = fakeClient("t1");
    const t2 = fakeClient("t2");
    room2.addClient(t1.client);
    room2.addClient(t2.client);
    expect(room2.takeSeat("t1")).toBe(true);
    expect(t1.last("welcome")!.slot).toBe("B1");
    // One human a side now: seat order decides.
    expect(room2.takeSeat("t2")).toBe(true);
    expect(t2.last("welcome")!.slot).toBe("A1");
    room2.stop();
  });

  it("during a rally waits for the point to end; a seat taken first drops the later request", async () => {
    // A bot in A1 serves; three idle humans fill B1, A2 and B2.
    const room = await Room.create({ seed: SEED });
    room.debugAddBots(1);
    const humans = ["p1", "p2", "p3"].map((id) => {
      const c = fakeClient(id);
      room.addClient(c.client);
      room.claimSlot(id, id);
      return c;
    });
    const p1 = humans[0]!;
    const s1 = fakeClient("s1");
    const s2 = fakeClient("s2");
    room.addClient(s1.client);
    room.addClient(s2.client);
    const match = () => p1.last("match")!;
    expect(p1.last("roster")!.seatOpen).toBe(true);

    expect(stepUntil(room, () => match().phase === "rally", 10 * TICK_RATE)).not.toBeNull();
    expect(room.takeSeat("s1")).toBe(true);
    expect(room.takeSeat("s2")).toBe(true);
    let seatedMidRally = false;
    const seated = () => p1.last("roster")!.players.some((p) => p.id === "s1");
    stepUntil(
      room,
      () => {
        if (match().phase === "rally" && seated()) seatedMidRally = true;
        return seated();
      },
      20 * TICK_RATE,
    );
    expect(seatedMidRally).toBe(false);
    expect(seated()).toBe(true);
    expect(match().phase).not.toBe("rally");
    expect(s1.last("welcome")).toMatchObject({ role: "player", slot: "A1" });
    // s1 took the only open seat first: s2's request is dropped, not kept for later.
    expect(s2.last("welcome")).toBeNull();
    expect(p1.last("roster")!.seatOpen).toBe(false);
    room.removeClient("p3");
    for (let i = 0; i < 30; i++) room.step();
    expect(p1.last("roster")!.players.some((p) => p.id === "s2")).toBe(false);
    expect(p1.last("roster")!.seatOpen).toBe(true);
    room.stop();
  }, LONG_TEST_MS);

  it("is refused for a seated player and for a connection the room does not know", async () => {
    const { room } = await mixedRoom(["p1"], 0);
    expect(room.takeSeat("p1")).toBe(false);
    expect(room.takeSeat("ghost")).toBe(false);
    room.stop();
  });
});

describe("seatOpen", () => {
  it("is true while a seat is free or held by a bot", async () => {
    const { room, clients } = await mixedRoom(["p1", "p2", "p3", "p4"], 0);
    const p1 = clients[0]!;
    expect(p1.last("roster")!.seatOpen).toBe(false);
    room.removeClient("p4");
    expect(p1.last("roster")!.seatOpen).toBe(true);
    expect(room.addBot("p1")).toBe(true);
    expect(p1.last("roster")!.seatOpen).toBe(true);
    const s = fakeClient("s1");
    room.addClient(s.client);
    expect(room.takeSeat("s1")).toBe(true);
    expect(p1.last("roster")!.seatOpen).toBe(false);
    room.stop();
  });
});

describe("skip replay", () => {
  it("is ignored from a spectator, broadcast from a player, at most once a second", async () => {
    const { room, clients } = await mixedRoom(["p1"], 3);
    const p1 = clients[0]!;
    const s = fakeClient("s1");
    room.addClient(s.client);
    const skips = (c: ReturnType<typeof fakeClient>) => c.messages().filter((m) => m.t === "replayskip").length;

    expect(room.skipReplay("s1")).toBe(false);
    expect(skips(s)).toBe(0);
    expect(room.skipReplay("p1")).toBe(true);
    expect(skips(s)).toBe(1);
    expect(skips(p1)).toBe(1);
    expect(room.skipReplay("p1")).toBe(false);
    expect(skips(s)).toBe(1);
    room.stop();
  });
});
