import { describe, expect, it } from "vitest";
import {
  SERVICE_LINE_DIST,
  TICK_RATE,
  TOSS,
  tossApex,
  type MatchMsg,
  type ServerMessage,
  type Vec2,
} from "@padel/shared";
import { MatchEngine } from "../src/match.js";
import { Room } from "../src/room.js";
import { fakeClient, sendInput, stepUntil } from "./fakes.js";

/** Every room is seeded, so the bots' decisions (and so these physics runs) are reproducible. */
const SEED = 7;
/** Long physics runs (thousands of steps) get room on a loaded CI machine. */
const LONG_TEST_MS = 30_000;

/**
 * One human (A1, serves first) against one bot (B1), so the match leaves warm-up. With
 * `idleReceiver`, B1 is a second human who never moves or swings instead, so nobody can
 * volley the serve before it lands.
 */
async function humanVsBot({ idleReceiver = false } = {}) {
  const room = await Room.create({ seed: SEED });
  const p = fakeClient("p1");
  room.addClient(p.client);
  room.claimSlot("p1", "Ana");
  if (idleReceiver) {
    const r = fakeClient("p2");
    room.addClient(r.client);
    room.claimSlot("p2", "Bea");
  } else {
    room.addBot("p1");
  }
  stepUntil(room, () => p.last("snapshot") !== null, 3);
  const match = () => p.last("match")!;
  return { room, p, match };
}

function matchesSince(msgs: ServerMessage[], from: number): MatchMsg[] {
  return msgs.slice(from).filter((m): m is MatchMsg => m.t === "match");
}

/** The server's position and the centre of the diagonal box it must serve into. */
function serveGeometry(p: ReturnType<typeof fakeClient>, depth = SERVICE_LINE_DIST / 2) {
  const m = p.last("match")!;
  const me = p.last("snapshot")!.players.find((s) => s.slot === m.serverSlot)!;
  const from = { x: me.pos.x, z: me.pos.z };
  const targetSide = -Math.sign(from.z);
  const targetXSign = -Math.sign(from.x);
  const centre = { x: targetXSign * 2.5, z: targetSide * depth };
  return { from, centre, targetSide, targetXSign };
}

function aimAt(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  return { x: dx / len, z: dz / len };
}

/** Start the toss, wait `ticks` ticks after it starts, then strike with a Drive aimed at `aim`. */
function tossAndStrike(room: Room, ticks: number, aim: Vec2) {
  sendInput(room, "p1", { serve: true, aim });
  room.step(); // the toss starts on this tick
  for (let i = 0; i < ticks - 1; i++) {
    sendInput(room, "p1", { aim });
    room.step();
  }
  sendInput(room, "p1", { shot: "drive", aim });
  room.step(); // struck `ticks` ticks after the toss started
}

const isFault = (m: MatchMsg) => m.eventKind === "fault";

describe("aimed serve with a toss", () => {
  it("a strike at the apex starts a rally that bounces in the box, with no Fault", async () => {
    const { room, p, match } = await humanVsBot();
    expect(match().serverSlot).toBe("A1");
    expect(match().tossing).toBe(false);
    const g = serveGeometry(p);
    const aim = aimAt(g.from, g.centre);

    sendInput(room, "p1", { serve: true, aim });
    room.step();
    expect(match().tossing).toBe(true);
    expect(match().phase).toBe("serve");

    const before = p.messages().length;
    const apexTicks = Math.round(tossApex() * TICK_RATE);
    for (let i = 0; i < apexTicks - 1; i++) {
      sendInput(room, "p1", { aim });
      room.step();
    }
    sendInput(room, "p1", { shot: "drive", aim });
    expect(stepUntil(room, () => match().phase === "rally", 90)).not.toBeNull();
    expect(match().tossing).toBe(false);

    // Watch the snapshots for the first floor bounce (vertical velocity flips up near the floor).
    let bounce: Vec2 | null = null;
    let prevVy = 0;
    let lastTick = -1;
    for (let i = 0; i < 120; i++) {
      room.step();
      const s = p.last("snapshot")!;
      if (s.tick === lastTick) continue;
      lastTick = s.tick;
      if (!bounce && prevVy < 0 && s.ball.vel.y > 0 && s.ball.pos.y < 0.4) {
        bounce = { x: s.ball.pos.x, z: s.ball.pos.z };
      }
      prevVy = s.ball.vel.y;
    }
    expect(bounce).not.toBeNull();
    expect(Math.sign(bounce!.z)).toBe(g.targetSide);
    expect(Math.sign(bounce!.x)).toBe(g.targetXSign);
    expect(Math.abs(bounce!.z)).toBeLessThanOrEqual(SERVICE_LINE_DIST);
    expect(matchesSince(p.messages(), before).filter(isFault)).toEqual([]);
    room.stop();
  });

  it("a late strike goes long: Fault — second serve", async () => {
    // A bot receiver would volley a long serve back before it lands, so B1 stays idle.
    const { room, p, match } = await humanVsBot({ idleReceiver: true });
    const g = serveGeometry(p);
    // The aim point lies |z| + TOSS.aimBeyondM (6 m) along the aim, deep in the box; at
    // TOSS.depthPerSecond = 18, apex + 0.3 s adds 3.6 m of depth and lands past the service line.
    const lateTicks = Math.round((tossApex() + 0.3) * TICK_RATE);
    expect(lateTicks / TICK_RATE).toBeLessThan(TOSS.expireS);
    tossAndStrike(room, lateTicks, aimAt(g.from, g.centre));
    expect(match().phase).toBe("rally");
    expect(stepUntil(room, () => match().eventKind === "fault", 120)).not.toBeNull();
    expect(match().reason).toMatch(/out|long/i);
    room.stop();
  });

  it("no strike before the toss expires: Fault — MISSED THE TOSS", async () => {
    const { room, match } = await humanVsBot();
    sendInput(room, "p1", { serve: true });
    room.step();
    expect(match().tossing).toBe(true);
    const steps = stepUntil(room, () => match().eventKind === "fault", 120);
    expect(steps).not.toBeNull();
    expect(steps! / TICK_RATE).toBeGreaterThanOrEqual(TOSS.expireS - 1 / TICK_RATE);
    expect(match().reason).toBe("MISSED THE TOSS");
    expect(match().tossing).toBe(false);
    room.stop();
  });

  it("after a Fault, a click without a new toss does nothing", async () => {
    const { room, p, match } = await humanVsBot();
    sendInput(room, "p1", { serve: true });
    room.step();
    stepUntil(room, () => match().eventKind === "fault", 120);
    expect(match().tossing).toBe(false);
    // The second serve is set up after the pause.
    expect(stepUntil(room, () => match().phase === "serve", 200)).not.toBeNull();
    expect(match().tossing).toBe(false);
    expect(match().awaitingServe).toBe(true);
    const g = serveGeometry(p);
    sendInput(room, "p1", { shot: "drive", aim: aimAt(g.from, g.centre) });
    room.step();
    room.step();
    expect(match().phase).toBe("serve");
    expect(match().tossing).toBe(false);
    room.stop();
  });

  it("a receiver's click during the serve does not swing on the strike tick", async () => {
    const { room, p, match } = await humanVsBot({ idleReceiver: true });
    const g = serveGeometry(p);
    const aim = aimAt(g.from, g.centre);
    sendInput(room, "p1", { serve: true, aim });
    room.step();
    sendInput(room, "p2", { shot: "drive" }); // the receiver clicks while the toss is up
    const apexTicks = Math.round(tossApex() * TICK_RATE);
    for (let i = 0; i < apexTicks - 1; i++) {
      sendInput(room, "p1", { aim });
      room.step();
    }
    const from = p.messages().length;
    sendInput(room, "p1", { shot: "drive", aim });
    room.step(); // the strike tick
    expect(match().phase).toBe("rally");
    // Now put the ball right at the receiver: a fresh click must connect. Had the early
    // click whiffed on the strike tick, the swing cooldown would still block this one.
    const b1 = p.last("snapshot")!.players.find((s) => s.slot === "B1")!.pos;
    room.debugPlaceBall({ x: b1.x + 0.5, y: 1, z: b1.z }, { x: 0, y: 0, z: 0 });
    sendInput(room, "p2", { shot: "drive" });
    for (let i = 0; i < 4; i++) room.step();
    const shots = p
      .messages()
      .slice(from)
      .flatMap((m) => (m.t === "snapshot" ? (m.shots ?? []) : []));
    expect(shots.map((s) => `${s.slot}:${s.kind}`)).toEqual(["A1:serve", "B1:drive"]);
    room.stop();
  });

  it("the server leaving mid-toss sets up a fresh serve for the new server", async () => {
    // Three humans (A1, B1, A2), so nobody tosses on their own.
    const room = await Room.create({ seed: SEED });
    const clients = ["p1", "p2", "p3"].map(fakeClient);
    for (const c of clients) {
      room.addClient(c.client);
      room.claimSlot(c.client.id, c.client.id);
    }
    const watcher = clients[1]!;
    room.step();
    expect(watcher.last("match")!.serverSlot).toBe("A1");
    sendInput(room, "p1", { serve: true });
    room.step();
    expect(watcher.last("match")!.tossing).toBe(true);

    const from = watcher.messages().length;
    room.removeClient("p1");
    room.step();
    const next = matchesSince(watcher.messages(), from)[0];
    expect(next).toBeDefined();
    expect(next!.serverSlot).toBe("A2");
    expect(next!.phase).toBe("serve");
    expect(next!.tossing).toBe(false);
    expect(next!.awaitingServe).toBe(true);
    room.stop();
  });

  it("a strike is judged at the client's view: clicking at the apex it sees is perfect", async () => {
    // The click reaches the server 150 ms after the apex, but the client was rendering the apex.
    for (const rewind of [true, false]) {
      const { room, p, match } = await humanVsBot({ idleReceiver: true });
      const g = serveGeometry(p);
      const aim = aimAt(g.from, g.centre);
      const tossStart = room.serverTime; // the toss starts on the next step, at this time
      sendInput(room, "p1", { serve: true, aim });
      room.step();
      const apex = tossStart + tossApex() * 1000;
      while (room.serverTime < apex + 150 - 1) {
        sendInput(room, "p1", { aim });
        room.step();
      }
      const from = p.messages().length;
      sendInput(room, "p1", { shot: "drive", aim, view: rewind ? apex : room.serverTime });
      room.step();
      expect(match().phase).toBe("rally");
      for (let i = 0; i < 3; i++) room.step();
      const shots = p
        .messages()
        .slice(from)
        .flatMap((m) => (m.t === "snapshot" ? (m.shots ?? []) : []));
      expect(shots).toEqual([
        { slot: "A1", kind: "serve", timing: rewind ? "perfect" : "late", pos: expect.any(Object) },
      ]);
      room.stop();
    }
  });

  it("a Bot server never faults across 5 points", async () => {
    const room = await Room.create({ seed: SEED });
    const watcher = fakeClient("w1");
    room.addClient(watcher.client);
    room.debugAddBots(3); // A1, B1, A2: a bot serves first
    room.step();
    const match = () => watcher.last("match")!;
    expect(match().serverSlot).toBe("A1");

    let points = 0;
    let wasBetween = false;
    let tossed = false;
    const steps = stepUntil(
      room,
      () => {
        const m = match();
        if (m.tossing) tossed = true;
        const between = m.phase === "between" || m.phase === "over";
        if (between && !wasBetween) points++;
        wasBetween = between;
        return points >= 5;
      },
      60 * TICK_RATE * 5,
    );
    expect(steps).not.toBeNull();
    expect(tossed).toBe(true);
    expect(matchesSince(watcher.messages(), 0).filter(isFault)).toEqual([]);
    room.stop();
  }, LONG_TEST_MS);
});

describe("a new server after a Fault", () => {
  /** Ticks the engine (ball parked, no contacts) until `done`, from `now`; returns the time reached. */
  function tickUntil(engine: MatchEngine, now: number, done: () => boolean): number {
    for (let i = 0; i < 60 * 10 && !done(); i++) {
      now += 1000 / TICK_RATE;
      engine.tick(now, { x: 0, y: 1.2, z: 0 }, 0, []);
    }
    expect(done()).toBe(true);
    return now;
  }

  it("starts on a first serve when the server leaves during the pause after a first-serve Fault", () => {
    const engine = new MatchEngine();
    engine.setRoster(
      [
        { slot: "A1", team: "A" },
        { slot: "A2", team: "A" },
        { slot: "B1", team: "B" },
      ],
      0,
    );
    expect(engine.toMessage().serverSlot).toBe("A1");
    expect(engine.startToss("A1", 0)).toBe(true);
    let now = tickUntil(engine, 0, () => engine.phase === "between");
    expect(engine.toMessage().eventKind).toBe("fault"); // A1 missed the toss: first-serve Fault
    // A1 leaves during the pause: A2 serves instead.
    engine.setRoster(
      [
        { slot: "A2", team: "A" },
        { slot: "B1", team: "B" },
      ],
      now,
    );
    now = tickUntil(engine, now, () => engine.phase === "serve");
    expect(engine.toMessage().serverSlot).toBe("A2");
    // A2's miss is its first Fault, not a double fault: no point to B.
    expect(engine.startToss("A2", now)).toBe(true);
    tickUntil(engine, now, () => engine.phase === "between");
    const m = engine.toMessage();
    expect(m.eventKind).toBe("fault");
    expect(m.event).toBe("FAULT");
    expect(m.pointB).toBe("0");
  });
});
