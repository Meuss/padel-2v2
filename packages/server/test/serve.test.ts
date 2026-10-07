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
import { Room } from "../src/room.js";
import { fakeClient, sendInput, stepUntil } from "./fakes.js";

/**
 * One human (A1, serves first) against one bot (B1), so the match leaves warm-up. With
 * `idleReceiver`, B1 is a second human who never moves or swings instead, so nobody can
 * volley the serve before it lands.
 */
async function humanVsBot({ idleReceiver = false } = {}) {
  const room = await Room.create();
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

const isFault = (m: MatchMsg) => /fault/i.test(m.event ?? "") || /fault/i.test(m.reason ?? "");

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
    // With the aim point |z| + 4 m along the aim (≈ 4 m past the net) and TOSS.depthPerSecond = 14,
    // apex + 0.3 s only adds 2.8 m and still lands in; apex + 0.4 s (before TOSS.expireS) goes long.
    const lateTicks = Math.round((tossApex() + 0.4) * TICK_RATE);
    expect(lateTicks / TICK_RATE).toBeLessThan(TOSS.expireS);
    tossAndStrike(room, lateTicks, aimAt(g.from, g.centre));
    expect(match().phase).toBe("rally");
    expect(stepUntil(room, () => match().event === "Fault — second serve", 120)).not.toBeNull();
    expect(match().reason).toMatch(/out|long/i);
    room.stop();
  });

  it("no strike before the toss expires: Fault — Missed the toss", async () => {
    const { room, match } = await humanVsBot();
    sendInput(room, "p1", { serve: true });
    room.step();
    expect(match().tossing).toBe(true);
    const steps = stepUntil(room, () => match().event === "Fault — second serve", 120);
    expect(steps).not.toBeNull();
    expect(steps! / TICK_RATE).toBeGreaterThanOrEqual(TOSS.expireS - 1 / TICK_RATE);
    expect(match().reason).toBe("Missed the toss");
    expect(match().tossing).toBe(false);
    room.stop();
  });

  it("toss state resets when the next serve is set up", async () => {
    const { room, p, match } = await humanVsBot();
    sendInput(room, "p1", { serve: true });
    room.step();
    stepUntil(room, () => match().event === "Fault — second serve", 120);
    expect(match().tossing).toBe(false);
    // The second serve is set up after the pause.
    expect(stepUntil(room, () => match().phase === "serve", 200)).not.toBeNull();
    expect(match().tossing).toBe(false);
    expect(match().awaitingServe).toBe(true);
    // A click without a new toss does nothing.
    const g = serveGeometry(p);
    sendInput(room, "p1", { shot: "drive", aim: aimAt(g.from, g.centre) });
    room.step();
    room.step();
    expect(match().phase).toBe("serve");
    room.stop();
  });

  it("a Bot server never faults across 5 points", async () => {
    const room = await Room.create();
    const host = fakeClient("p1");
    const watcher = fakeClient("w1");
    room.addClient(host.client);
    room.claimSlot("p1", "Ana"); // A1
    room.addBot("p1"); // B1
    room.addBot("p1"); // A2
    room.addClient(watcher.client);
    room.removeClient("p1"); // only bots left: A2 serves first
    room.step();
    const match = () => watcher.last("match")!;
    expect(match().serverSlot).toBe("A2");

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
  });
});
