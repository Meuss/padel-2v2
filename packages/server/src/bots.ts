/**
 * Bot decisions: where each Bot moves, when it swings, which Shot it asks for, where it aims,
 * and when it serves. The room calls `updateBots` once per tick, before integrating movement;
 * a Bot writes its `input` and `shotRequested` exactly as a human's inputs would arrive, and
 * the room resolves them like any other swing.
 */
import {
  BALL,
  BOT,
  COURT,
  PLAYER,
  SHOT,
  TICK_DT,
  stepPlayer,
  swingConnects,
  resolveKind,
  timeToClosest,
  tossApex,
  type InputMsg,
  type Slot,
  type Team,
  type Vec2,
  type Vec3,
} from "@padel/shared";
import type { MatchEngine } from "./match.js";
import type { Rng } from "./rng.js";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The part of a seated player that bot decisions read and write. */
export interface BotSeat {
  readonly slot: Slot;
  readonly team: Team;
  side: -1 | 1;
  pos: { x: number; z: number };
  isBot: boolean;
  input: InputMsg | null;
  shotRequested: "drive" | "lob" | null;
  serveReadyAt: number;
  botArmed: boolean; // ready to take one swing (re-armed when the ball leaves reach)
  /** This approach's swing point, as a time-to-closest (s): 0 is perfect; rolled once per approach. */
  botSwingAtS: number | null;
}

/** What the bots see of the room this tick. */
export interface BotContext<S extends BotSeat> {
  /** Every seated player (humans too), in seat order. */
  seats: readonly S[];
  ball: { pos: Vec3; vel: Vec3 };
  /** The team that last struck the ball: bots never swing at their own team's ball. */
  lastHitTeam: Team | null;
  match: Pick<MatchEngine, "phase" | "currentServer" | "tossElapsed" | "startToss" | "serviceBox">;
  /** Seeded, so a seeded room replays the same match. */
  rng: Rng;
  /** Strike the toss now, aimed at a ground point. */
  strikeServe(seat: S, now: number, aimPoint: Vec2): void;
}

/**
 * Drive AI bots: hold a back-court lane, step to the ball only when it's a genuine incoming
 * ball in their half, and serve on their turn. A bot swings once per approach, when the
 * ball's time to closest approach reaches the swing point rolled for that approach: the
 * centre of the perfect window, or (BOT.offTimingChance) one window early or late.
 */
export function updateBots<S extends BotSeat>(ctx: BotContext<S>, now: number): void {
  const { match, seats } = ctx;
  const phase = match.phase;
  const server = match.currentServer;
  const { pos: ball, vel } = ctx.ball;
  const halfL = COURT.length / 2;
  const unit = (v: number) => clamp(v, -1, 1);
  /** Teams with a bot swinging this tick: two teammates on one tick would be a double hit. */
  const swinging = new Set<Team>();
  for (const ps of seats) {
    if (!ps.isBot) continue;
    const s = ps.side;
    const laneX = ps.slot.endsWith("1") ? -2.5 : 2.5; // left vs right lane
    const backZ = s * (halfL - 1.8); // home: near our own baseline
    const teammates = seats.filter((p) => p.team === ps.team).length;
    const laneOk = teammates <= 1 ? true : laneX < 0 ? ball.x <= 0.3 : ball.x >= -0.3;
    const onOurSide = Math.sign(ball.z) === s;
    const incoming = Math.sign(vel.z) === s; // ball travelling toward our court
    const near = Math.hypot(ball.x - ps.pos.x, ball.z - ps.pos.z) < 3;
    const chase = onOurSide && laneOk && (incoming || near);
    // Target: the ball if it's ours to take, otherwise our back-court lane spot.
    const tx = chase ? ball.x : laneX;
    const tz = chase ? ball.z : backZ;
    const input: InputMsg = {
      t: "input",
      seq: 0,
      ts: now,
      move: { x: unit((tx - ps.pos.x) * s), z: unit(-(tz - ps.pos.z) * s) },
      aim: { x: unit(-ps.pos.x * 0.15), z: -s },
      shot: null,
      view: now, // bots see the present
      serve: false,
    };
    ps.input = input;
    // Only a ball on our side that the other team struck last is ours to swing at.
    if (phase === "rally" && onOurSide && ctx.lastHitTeam !== ps.team) {
      // Judge from where the bot will stand when the swing resolves: after this tick's move.
      const at = stepPlayer(ps.pos, input.move, s, TICK_DT);
      const racket = { x: at.x, y: PLAYER.racketHeight, z: at.z };
      const inReach = swingConnects(racket.x, racket.y, racket.z, ball, PLAYER.reach + BALL.radius);
      if (!inReach) {
        ps.botArmed = true;
        ps.botSwingAtS = null;
      } else if (ps.botArmed && !swinging.has(ps.team)) {
        ps.botSwingAtS ??= rollSwingAt(ctx.rng);
        const rel = { x: ball.x - racket.x, y: ball.y - racket.y, z: ball.z - racket.z };
        // A high ball in reach is smashed at once, whatever the timing roll.
        const smashable = ball.y > SHOT.smashHeight;
        if (smashable || timeToClosest(rel, vel) <= ps.botSwingAtS) {
          const shot = chooseBotShot(ps, seats, ctx.rng);
          ps.shotRequested = shot;
          // The room resolves the kind from this same ball (bots see the present).
          const smash = resolveKind(shot, ball.y, Math.abs(ball.z)) === "smash";
          input.aim = botAim(ps, at, seats, smash);
          ps.botArmed = false;
          ps.botSwingAtS = null;
          swinging.add(ps.team);
        }
      }
    } else {
      ps.botArmed = true;
      ps.botSwingAtS = null;
    }
    if (phase === "serve" && server === ps.slot) {
      const t = match.tossElapsed(now);
      if (t !== null) {
        // Strike on the first tick at or past the top of the toss: perfect Timing.
        if (t >= tossApex()) ctx.strikeServe(ps, now, boxCentre(match));
      } else if (ps.serveReadyAt === 0) ps.serveReadyAt = now + 700;
      else if (now >= ps.serveReadyAt) match.startToss(ps.slot, now);
    } else {
      ps.serveReadyAt = 0;
    }
  }
}

/** A bot's swing point (time to closest, s): perfect, or one window early or late. */
function rollSwingAt(rng: Rng): number {
  if (rng() >= BOT.offTimingChance) return 0;
  const offset = BOT.offTimingWindows * SHOT.perfectWindowS;
  return rng() < BOT.earlyShare ? offset : -offset;
}

/** Lob when both opponents are at the net (or now and then); otherwise Drive. High balls become Smashes. */
function chooseBotShot(ps: BotSeat, seats: readonly BotSeat[], rng: Rng): "drive" | "lob" {
  const opponents = seats.filter((p) => p.team !== ps.team);
  const atNet = opponents.length > 0 && opponents.every((p) => Math.abs(p.pos.z) < BOT.netZoneM);
  return atNet || rng() < BOT.lobChance ? "lob" : "drive";
}

/**
 * Aim into the opposite half, toward the open side: away from the nearest opponent's x. A Smash
 * keeps to the middle (|x| <= BOT.smashMaxX), so a fast flat ball doesn't reach the side glass on the full.
 */
function botAim(ps: BotSeat, from: Vec2, seats: readonly BotSeat[], smash: boolean): Vec2 {
  let nearest: BotSeat | null = null;
  let best = Infinity;
  for (const p of seats) {
    if (p.team === ps.team) continue;
    const d = Math.hypot(p.pos.x - from.x, p.pos.z - from.z);
    if (d < best) {
      best = d;
      nearest = p;
    }
  }
  const maxX = smash ? BOT.smashMaxX : BOT.aimMaxX;
  const targetX = nearest === null ? 0 : nearest.pos.x >= 0 ? -maxX : maxX;
  const targetZ = -ps.side * COURT.length * BOT.aimDepthFrac;
  const dx = targetX - from.x;
  const dz = targetZ - from.z;
  const len = Math.hypot(dx, dz);
  return { x: dx / len, z: dz / len };
}

function boxCentre(match: Pick<MatchEngine, "serviceBox">): Vec2 {
  const box = match.serviceBox();
  if (!box) return { x: 0, z: 0 };
  return { x: (box.xMin + box.xMax) / 2, z: (box.side * (box.zNear + box.zFar)) / 2 };
}
