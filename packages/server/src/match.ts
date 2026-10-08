/**
 * Authoritative padel match engine: scoring, serve flow (with validation,
 * faults, lets and double-faults), side changes, and rally adjudication. It is
 * fed the ball position and the surfaces it touched each tick (from
 * PhysicsWorld) plus hit/serve events from the room, and decides when points end
 * and why.
 *
 * A serve is a toss (`startToss`, Space) followed by a strike (`strikeServe`, a
 * click). How close the strike is to the top of the toss sets its Timing, which
 * shifts where the serve lands; the landing itself is judged by the physics, so
 * every Fault comes from what happened on court.
 *
 * When a point is lost it records a `reason` and a `highlight` (the offending
 * bounces / net or wall contact / exit point / player, at their true positions) so the
 * client can show what went wrong.
 */
import {
  COURT,
  MATCH,
  SERVE,
  SERVICE_LINE_DIST,
  TOSS,
  leftCage,
  netHeightAt,
  serveTarget,
  serveTiming,
  tossOffset,
  type FaultHighlight,
  type MatchEventKind,
  type MatchMsg,
  type MatchPhase,
  type ServiceBox,
  type Slot,
  type Team,
  type Timing,
  type Vec2,
  type Vec3,
} from "@padel/shared";
import type { ContactKind } from "./world.js";

/** A ball contact as the engine reads it: what was touched, and the ball's centre then. */
export interface EngineContact {
  kind: ContactKind;
  pos: Vec3;
}

const HALF_W = COURT.width / 2;
const HALF_L = COURT.length / 2;

export interface RosterPlayer {
  slot: Slot;
  team: Team;
}

export interface ServeLaunch {
  from: Vec3;
  to: Vec3;
}

export interface EngineAction {
  hold: Vec3 | null;
}

/** Team names in broadcast copy. */
const TEAM_CALL: Record<Team, string> = { A: "AZUL", B: "ROJO" };
const other = (t: Team): Team => (t === "A" ? "B" : "A");
const sign = (z: number): -1 | 1 => (z < 0 ? -1 : 1);
const copy = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
/** A cage panel's name in broadcast copy. */
const WALL_CALL = { glass: "GLASS", mesh: "FENCE" } as const;
const isWall = (kind: ContactKind): kind is "glass" | "mesh" => kind === "glass" || kind === "mesh";

export class MatchEngine {
  phase: MatchPhase = "warmup";
  private players: RosterPlayer[] = [];
  private teamSide: Record<Team, -1 | 1> = { A: -1, B: 1 };

  // Scoring.
  private ptA = 0;
  private ptB = 0;
  private gamesA = 0;
  private gamesB = 0;
  private tiebreak = false;
  private tbA = 0;
  private tbB = 0;
  private winner: Team | null = null;

  // Serve / game setup.
  private gameIndex = 0;
  private pointsInGame = 0;
  private serverSlot: Slot | null = null;
  private receiverSlot: Slot | null = null;
  private serveXSign: -1 | 1 = 1;
  private serveSide: -1 | 1 = -1;
  private targetSide: -1 | 1 = 1;
  private targetXSign: -1 | 1 = -1;
  private awaitingServe = false;
  private tossing = false;
  private tossStartedAt = 0;
  private serverPos = { x: 0, z: 0 };
  private receiverPos = { x: 0, z: 0 };
  private holdPos: Vec3 = { x: 0, y: SERVE.height, z: 0 };
  private targetPoint: Vec3 = { x: 0, y: 0, z: 0 };
  private setupId = 0;
  private serveAttempt: 1 | 2 = 1;
  private replayServe = false;
  private replayAttempt: 1 | 2 = 1;

  // Between-point timing & flash text.
  private betweenUntil = 0;
  private gameJustEnded = false;
  private event: string | null = null;
  private eventKind: MatchEventKind | null = null;
  private eventTeam: Team | null = null;
  /** Bumped when a new match starts (first start or a reset). */
  private matchId = 0;
  /** The team awarded the last point, until the room takes it. */
  private pointWinner: Team | null = null;
  private reason: string | null = null;
  private highlight: FaultHighlight | null = null;
  private dirty = true;

  // Rally tracking (since the last hit).
  private hitterTeam: Team | null = null;
  private hitterSide: -1 | 1 = -1;
  private crossed = false;
  private bouncedTarget = false;
  private bounceCount = 0;
  private stallSince = 0;
  /** Where the ball first bounced on the target side since the last hit (the serve's bounce included). */
  private firstBounce: Vec3 | null = null;
  /** The latest floor contact since the last hit. */
  private lastBounce: Vec3 | null = null;
  /** The first net contact since the last hit. */
  private netContact: Vec3 | null = null;
  // Serve-in-flight tracking.
  private isServe = false;
  private serveNetTouched = false;

  // ── Roster / lifecycle ─────────────────────────────────────────────────────

  /** `now` is the room's simulation clock (ms), like every `now` the engine is given. */
  setRoster(players: RosterPlayer[], now: number): void {
    this.players = players;
    const ready = this.teamPlayers("A").length > 0 && this.teamPlayers("B").length > 0;
    if (!ready) {
      if (this.phase !== "warmup") this.reset();
      return;
    }
    if (this.phase === "warmup") this.startMatch(now);
    // The server left. Over: nothing to set up (a rematch picks the server). Between points: the
    // pause runs on, and `advance` sets up with whoever serves now. Otherwise set up again at once.
    else if (this.phase !== "over" && this.phase !== "between" && !this.players.some((p) => p.slot === this.serverSlot)) {
      this.setupServe(now, 1);
    }
  }

  private reset(): void {
    this.phase = "warmup";
    this.ptA = this.ptB = this.gamesA = this.gamesB = 0;
    this.tbA = this.tbB = 0;
    this.tiebreak = false;
    this.winner = null;
    this.gameIndex = 0;
    this.pointsInGame = 0;
    this.serverSlot = this.receiverSlot = null;
    this.awaitingServe = false;
    this.tossing = false;
    this.setEvent(null, null);
    this.reason = null;
    this.highlight = null;
    this.pointWinner = null;
    this.teamSide = { A: -1, B: 1 };
    this.dirty = true;
  }

  private startMatch(now: number): void {
    this.reset();
    this.matchId++;
    this.setEvent("start", null);
    this.newGame(now);
  }

  /** Reset the score and restart the set (used by a passed reset vote). */
  resetMatch(now: number): void {
    const ready = this.teamPlayers("A").length > 0 && this.teamPlayers("B").length > 0;
    this.reset();
    if (ready) {
      this.matchId++;
      this.setEvent("reset", null);
      this.newGame(now);
    }
  }

  /** Test only: award `winner` points until they take the set, and end the match. */
  debugEndMatch(winner: Team): void {
    if (this.phase === "warmup" || this.phase === "over") return;
    while (!this.winner) this.awardPoint(winner);
    this.isServe = false;
    this.tossing = false;
    this.awaitingServe = false;
    this.reason = null;
    this.highlight = null;
    this.phase = "over";
    this.dirty = true;
  }

  // ── Queries used by the room ───────────────────────────────────────────────

  sideOf(team: Team): -1 | 1 {
    return this.teamSide[team];
  }

  consumeDirty(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    return true;
  }

  get currentServer(): Slot | null {
    return this.phase === "serve" ? this.serverSlot : null;
  }

  serverStand(): { slot: Slot; x: number; z: number } | null {
    if (this.phase !== "serve" || !this.serverSlot) return null;
    return { slot: this.serverSlot, x: this.serverPos.x, z: this.serverPos.z };
  }

  receiverStand(): { slot: Slot; x: number; z: number } | null {
    if (this.phase !== "serve" || !this.receiverSlot) return null;
    return { slot: this.receiverSlot, x: this.receiverPos.x, z: this.receiverPos.z };
  }

  get currentSetupId(): number {
    return this.setupId;
  }

  /** Changes whenever a new match starts: the room keeps one stats tracker per match. */
  get currentMatchId(): number {
    return this.matchId;
  }

  /** The team awarded a point since the last call, if any (each point is returned once). */
  takePointWinner(): Team | null {
    const w = this.pointWinner;
    this.pointWinner = null;
    return w;
  }

  /** Seconds since the toss started, or null when no toss is in the air. */
  tossElapsed(now: number): number | null {
    return this.tossing ? (now - this.tossStartedAt) / 1000 : null;
  }

  /** The diagonal box the current serve must land in (null outside the serve phase). */
  serviceBox(): ServiceBox | null {
    if (this.phase !== "serve" || !this.serverSlot) return null;
    return this.serviceBoxFor();
  }

  /** The box of the serve set up last, whatever the phase. */
  private serviceBoxFor(): ServiceBox {
    return {
      xMin: this.targetXSign > 0 ? 0 : -HALF_W,
      xMax: this.targetXSign > 0 ? HALF_W : 0,
      zNear: 0,
      zFar: SERVICE_LINE_DIST,
      side: this.targetSide,
    };
  }

  // ── Events from the room ───────────────────────────────────────────────────

  /** The server tosses the ball (Space). Only valid while awaiting the serve. */
  startToss(slot: Slot, now: number): boolean {
    if (this.phase !== "serve" || !this.awaitingServe || this.tossing) return false;
    if (slot !== this.serverSlot) return false;
    this.tossing = true;
    this.tossStartedAt = now;
    this.dirty = true;
    return true;
  }

  /**
   * The server strikes the toss. `aimPoint` is where they aim on the ground; the
   * strike time relative to the top of the toss sets the Timing and how far the
   * landing drifts long (late) or short (early). `now` is when the strike happened (the
   * room rewinds a human's click to the moment they saw); a time before the toss counts
   * as its start. Null if no toss is in the air.
   */
  strikeServe(
    slot: Slot,
    now: number,
    aimPoint: Vec2,
  ): { launch: ServeLaunch; timing: Timing } | null {
    if (this.phase !== "serve" || !this.tossing || slot !== this.serverSlot) return null;
    const t = Math.max(0, (now - this.tossStartedAt) / 1000);
    if (t > TOSS.expireS) return null; // too late: tick() calls it a missed toss
    const box = this.serviceBox()!;
    const timing = serveTiming(t);
    const target = serveTarget(aimPoint, box, t);
    const from = this.tossPosition(t);
    this.targetPoint = { x: target.x, y: 0, z: target.z };
    this.tossing = false;
    this.awaitingServe = false;
    this.phase = "rally";
    const serverTeam = this.teamOf(slot)!;
    this.hitterTeam = serverTeam;
    this.hitterSide = this.teamSide[serverTeam];
    this.crossed = false;
    this.bouncedTarget = false;
    this.bounceCount = 0;
    this.stallSince = 0;
    this.forgetContacts();
    this.isServe = true;
    this.serveNetTouched = false;
    this.setEvent(null, null);
    this.dirty = true;
    return { launch: { from, to: { ...this.targetPoint } }, timing };
  }

  private tossPosition(t: number): Vec3 {
    return { x: this.holdPos.x, y: this.holdPos.y + tossOffset(t), z: this.holdPos.z };
  }

  /** Register a swing connecting with the ball. Returns whether the hit is
   *  legal (and should move the ball); an illegal hit may end the point. */
  hit(slot: Slot, team: Team, now: number): boolean {
    if (this.phase !== "rally") return false;
    if (this.isServe) {
      // The serving side cannot strike its own serve; the receiving side
      // volleying it is treated as a normal return.
      if (team === this.hitterTeam) return false;
    } else if (this.hitterTeam !== null && team === this.hitterTeam) {
      // One side may not touch the ball twice in a row.
      this.endPoint(now, other(team), "DOUBLE HIT", {
        kind: "player",
        slot,
      });
      return false;
    }
    this.hitterTeam = team;
    this.hitterSide = this.teamSide[team];
    this.isServe = false;
    this.crossed = false;
    this.bouncedTarget = false;
    this.bounceCount = 0;
    this.stallSince = 0;
    this.forgetContacts();
    return true;
  }

  private forgetContacts(): void {
    this.firstBounce = null;
    this.lastBounce = null;
    this.netContact = null;
  }

  /** Record a contact's position for the fault highlight. */
  private note(c: EngineContact): void {
    if (c.kind === "floor") this.lastBounce = copy(c.pos);
    else if (c.kind === "net" && !this.netContact) this.netContact = copy(c.pos);
  }

  /** The net contact, or (never touched) the point on the net top in line with the ball. */
  private netPoint(ball: Vec3): Vec3 {
    return this.netContact ? copy(this.netContact) : { x: ball.x, y: netHeightAt(ball.x), z: 0 };
  }

  /** A double bounce's points: the first bounce on the target side (if any), then `second`. */
  private doubleBounce(second: Vec3): FaultHighlight {
    const points = this.firstBounce ? [copy(this.firstBounce), copy(second)] : [copy(second)];
    return { kind: "ground", surface: "floor", points };
  }

  /** Out over the cage: the exit point, then the last bounce if there was one. */
  private outOver(ball: Vec3): FaultHighlight {
    return { kind: "out", points: this.lastBounce ? [copy(ball), copy(this.lastBounce)] : [copy(ball)] };
  }

  // ── Per-tick adjudication ──────────────────────────────────────────────────

  /** `contacts` are the surfaces the ball started touching this tick, with its centre then. */
  tick(now: number, ball: Vec3, speed: number, contacts: readonly EngineContact[]): EngineAction {
    switch (this.phase) {
      case "warmup":
        return { hold: null };
      case "serve": {
        if (!this.tossing) return { hold: { ...this.holdPos } };
        const t = (now - this.tossStartedAt) / 1000;
        const pos = this.tossPosition(t);
        if (t > TOSS.expireS) {
          return this.serveFault(now, "MISSED THE TOSS", { kind: "player", slot: this.serverSlot!, points: [pos] });
        }
        return { hold: pos };
      }
      case "over":
        return { hold: { x: 0, y: 1.2, z: 0 } };
      case "between":
        if (now >= this.betweenUntil) this.advance(now);
        return { hold: this.awaitingServe ? { ...this.holdPos } : { x: 0, y: 1.2, z: 0 } };
      case "rally":
        return this.isServe
          ? this.serveTick(now, ball, contacts)
          : this.rallyTick(now, ball, speed, contacts);
    }
  }

  private get targetSideNow(): -1 | 1 {
    return (-this.hitterSide) as -1 | 1;
  }

  private serveTick(now: number, ball: Vec3, contacts: readonly EngineContact[]): EngineAction {
    for (const c of contacts) {
      const kind = c.kind;
      this.note(c);
      const at = c.pos;
      if (kind === "net") {
        this.serveNetTouched = true;
      } else if (isWall(kind)) {
        // Touched a wall before bouncing in the box — fault.
        return this.serveFault(now, `SERVE HIT THE ${WALL_CALL[kind]} FIRST`, {
          kind: "wall",
          surface: kind,
          points: [copy(at)],
        });
      } else if (kind === "floor") {
        const inBox =
          sign(at.z) === this.targetSide &&
          Math.abs(at.z) > 0.1 &&
          Math.abs(at.z) <= SERVICE_LINE_DIST &&
          sign(at.x) === this.targetXSign &&
          Math.abs(at.x) <= HALF_W;
        if (!inBox) {
          // Off the net cord and back on the server's side: the net is what went wrong.
          if (this.serveNetTouched && sign(at.z) !== this.targetSide) {
            return this.serveFault(now, "SERVE INTO THE NET", {
              kind: "net",
              surface: "net",
              points: [this.netPoint(at)],
            });
          }
          return this.serveFault(now, "SERVE OUT — WRONG BOX", { kind: "out", surface: "floor", points: [copy(at)] });
        }
        if (this.serveNetTouched) {
          return this.serveLet(now); // net cord into the box → replay
        }
        // Good serve — the rally is live; this counts as the first bounce.
        this.isServe = false;
        this.crossed = true;
        this.bouncedTarget = true;
        this.bounceCount = 1;
        this.firstBounce = copy(at);
        return { hold: null };
      }
    }
    // Left the cage before bouncing — fault.
    if (leftCage(ball)) {
      return this.serveFault(now, "SERVE LONG", { kind: "out", points: [copy(ball)] });
    }
    return { hold: null };
  }

  private serveFault(now: number, why: string, fault: FaultHighlight): EngineAction {
    const highlight: FaultHighlight = { ...fault, box: this.serviceBoxFor() };
    this.isServe = false;
    this.tossing = false;
    this.awaitingServe = false;
    if (this.serveAttempt === 1) {
      this.replayServe = true;
      this.replayAttempt = 2;
      this.phase = "between";
      this.betweenUntil = now + 1300;
      this.setEvent("fault", null);
      this.reason = why;
      this.highlight = highlight;
      this.dirty = true;
      return { hold: { x: 0, y: 1.2, z: 0 } };
    }
    const pointTo = other(this.teamOf(this.serverSlot!)!);
    const action = this.endPoint(now, pointTo, why, highlight);
    // A game or set it decides is called as such; a plain point is called as the double fault.
    if (this.eventKind === "point") this.setEvent("fault", pointTo, "DOUBLE FAULT");
    return action;
  }

  private serveLet(now: number): EngineAction {
    this.isServe = false;
    this.replayServe = true;
    this.replayAttempt = this.serveAttempt; // a let does not use up a serve
    this.phase = "between";
    this.betweenUntil = now + 1300;
    this.setEvent("let", null);
    this.reason = null;
    this.highlight = null;
    this.dirty = true;
    return { hold: { x: 0, y: 1.2, z: 0 } };
  }

  private rallyTick(
    now: number,
    ball: Vec3,
    speed: number,
    contacts: readonly EngineContact[],
  ): EngineAction {
    const target = this.targetSideNow;
    if (!this.crossed && sign(ball.z) === target && Math.abs(ball.z) > 0.3) {
      this.crossed = true;
    }

    for (const c of contacts) {
      const kind = c.kind;
      const s = sign(c.pos.z);
      this.note(c);
      if (kind === "floor") {
        if (s === target && this.crossed) {
          this.bounceCount++;
          this.bouncedTarget = true;
          this.stallSince = 0;
          if (this.bounceCount >= 2) {
            return this.endPoint(now, this.hitterTeam!, "DOUBLE BOUNCE", this.doubleBounce(c.pos));
          }
          this.firstBounce = copy(c.pos);
        } else if (s === this.hitterSide) {
          if (!this.crossed) {
            return this.endPoint(now, other(this.hitterTeam!), "INTO THE NET", {
              kind: "net",
              surface: "net",
              points: [this.netPoint(c.pos)],
            });
          }
          // Over to the receivers and back again: they never returned it.
          return this.endPoint(now, this.hitterTeam!, "NOT RETURNED", this.doubleBounce(c.pos));
        }
      } else if (isWall(kind)) {
        if (s === target && this.crossed && !this.bouncedTarget) {
          return this.endPoint(
            now,
            other(this.hitterTeam!),
            `HIT THE ${WALL_CALL[kind]} ON THE FULL`,
            { kind: "wall", surface: kind, points: [copy(c.pos)] },
          );
        }
      }
    }

    if (leftCage(ball)) {
      return this.bouncedTarget
        ? this.endPoint(now, this.hitterTeam!, "OUT OFF THE BOUNCE", this.outOver(ball))
        : this.endPoint(now, other(this.hitterTeam!), "OUT — OVER THE CAGE", this.outOver(ball));
    }

    if (speed < 0.6 && ball.y < 0.25) {
      if (this.stallSince === 0) this.stallSince = now;
      else if (now - this.stallSince > 1500) {
        return this.bouncedTarget
          ? this.endPoint(now, this.hitterTeam!, "DOUBLE BOUNCE", this.doubleBounce(ball))
          : this.endPoint(now, other(this.hitterTeam!), "SHORT — DIDN'T CROSS", {
              kind: "net",
              surface: "net",
              points: [this.netPoint(ball)],
            });
      }
    } else {
      this.stallSince = 0;
    }

    return { hold: null };
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  private endPoint(
    now: number,
    winnerTeam: Team,
    reason: string,
    highlight: FaultHighlight,
  ): EngineAction {
    this.isServe = false;
    this.reason = reason;
    this.highlight = highlight;
    this.awardPoint(winnerTeam);
    if (this.winner) {
      this.phase = "over";
    } else {
      this.phase = "between";
      this.betweenUntil = now + MATCH.betweenPointMs;
    }
    this.dirty = true;
    return { hold: { x: 0, y: 1.2, z: 0 } };
  }

  private awardPoint(w: Team): void {
    this.pointWinner = w;
    this.setEvent("point", w);
    if (this.tiebreak) {
      if (w === "A") this.tbA++;
      else this.tbB++;
      const top = Math.max(this.tbA, this.tbB);
      if (top >= MATCH.tiebreakTo && Math.abs(this.tbA - this.tbB) >= 2) {
        if (w === "A") this.gamesA++;
        else this.gamesB++;
        this.winSet(w);
      }
      return;
    }
    const pt = w === "A" ? this.ptA : this.ptB;
    if (pt >= 3) {
      this.winGame(w);
      return;
    }
    if (w === "A") this.ptA++;
    else this.ptB++;
  }

  private winGame(w: Team): void {
    if (w === "A") this.gamesA++;
    else this.gamesB++;
    this.ptA = this.ptB = 0;
    this.gameJustEnded = true;
    this.setEvent("game", w);
    const wg = w === "A" ? this.gamesA : this.gamesB;
    const og = w === "A" ? this.gamesB : this.gamesA;
    if (wg >= MATCH.gamesToWinSet && wg - og >= MATCH.setWinBy) {
      this.winSet(w);
    } else if (this.gamesA === MATCH.tiebreakAt && this.gamesB === MATCH.tiebreakAt) {
      this.tiebreak = true;
      this.tbA = this.tbB = 0;
    }
  }

  private winSet(w: Team): void {
    this.winner = w;
    this.setEvent("set", w);
  }

  /** Set the match event: its kind, the team it went to, and its broadcast text (from the kind unless given). */
  private setEvent(kind: MatchEventKind | null, team: Team | null, text?: string): void {
    this.eventKind = kind;
    this.eventTeam = team;
    this.event = kind === null ? null : (text ?? eventText(kind, team));
  }

  // ── Serve / game setup ─────────────────────────────────────────────────────

  private advance(now: number): void {
    if (this.replayServe) {
      this.replayServe = false;
      this.setupServe(now, this.replayAttempt);
      return;
    }
    if (this.gameJustEnded) {
      this.gameJustEnded = false;
      this.gameIndex++;
      if ((this.gamesA + this.gamesB) % 2 === 1) {
        const a = this.teamSide.A;
        this.teamSide.A = this.teamSide.B;
        this.teamSide.B = a;
      }
      this.newGame(now);
    } else {
      this.pointsInGame++;
      this.setupServe(now, 1);
    }
  }

  private newGame(now: number): void {
    const rotation = this.serveRotation();
    this.serverSlot = rotation.length ? rotation[this.gameIndex % rotation.length]! : null;
    this.pointsInGame = 0;
    this.setupServe(now, 1);
  }

  private setupServe(_now: number, attempt: 1 | 2): void {
    const rotation = this.serveRotation();
    if (!this.serverSlot || !this.players.some((p) => p.slot === this.serverSlot)) {
      this.serverSlot = rotation.length ? rotation[0]! : null;
      attempt = 1; // a new server starts on a first serve, whatever the last one had used up
    }
    if (!this.serverSlot) {
      this.phase = "warmup";
      this.dirty = true;
      return;
    }
    const serverTeam = this.teamOf(this.serverSlot)!;
    this.serveSide = this.teamSide[serverTeam];
    // Deuce court = server's right (xSign === serverSide); alternate each point.
    this.serveXSign = (
      this.pointsInGame % 2 === 0 ? this.serveSide : -this.serveSide
    ) as -1 | 1;
    this.targetSide = (-this.serveSide) as -1 | 1;
    this.targetXSign = (-this.serveXSign) as -1 | 1;
    this.serveAttempt = attempt;

    this.serverPos = { x: this.serveXSign * 2.5, z: this.serveSide * (HALF_L - 0.8) };
    this.holdPos = { x: this.serverPos.x, y: SERVE.height, z: this.serverPos.z };

    this.receiverPos = {
      x: this.targetXSign * 2.5,
      z: this.targetSide * (SERVICE_LINE_DIST - 0.4),
    };
    const opponents = this.players.filter((p) => p.team !== serverTeam);
    this.receiverSlot = opponents.length
      ? opponents[(this.serveXSign > 0 ? 0 : 1) % opponents.length]!.slot
      : null;

    this.phase = "serve";
    this.awaitingServe = true;
    this.tossing = false;
    this.tossStartedAt = 0;
    this.isServe = false;
    this.crossed = false;
    this.bouncedTarget = false;
    this.bounceCount = 0;
    this.reason = null;
    this.highlight = null;
    this.setupId++;
    this.dirty = true;
  }

  private serveRotation(): Slot[] {
    const a = this.teamPlayers("A");
    const b = this.teamPlayers("B");
    const rot: Slot[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) rot.push(a[i]!.slot);
      if (b[i]) rot.push(b[i]!.slot);
    }
    return rot;
  }

  private teamPlayers(team: Team): RosterPlayer[] {
    return this.players.filter((p) => p.team === team);
  }

  private teamOf(slot: Slot): Team | null {
    return this.players.find((p) => p.slot === slot)?.team ?? null;
  }

  // ── Outbound message ───────────────────────────────────────────────────────

  toMessage(): MatchMsg {
    const label = (n: number) => ["0", "15", "30", "40"][n] ?? "40";
    const serverTeam = this.serverSlot ? this.teamOf(this.serverSlot) : null;
    const serverSide = serverTeam ? this.teamSide[serverTeam] : null;
    return {
      t: "match",
      phase: this.phase,
      pointA: this.tiebreak ? String(this.tbA) : label(this.ptA),
      pointB: this.tiebreak ? String(this.tbB) : label(this.ptB),
      gamesA: this.gamesA,
      gamesB: this.gamesB,
      tiebreak: this.tiebreak,
      sideA: this.teamSide.A,
      serverSlot: this.serverSlot,
      serveBox:
        serverSide === null ? null : this.serveXSign === serverSide ? "deuce" : "ad",
      awaitingServe: this.awaitingServe,
      tossing: this.tossing,
      event: this.event,
      eventKind: this.eventKind,
      eventTeam: this.eventTeam,
      reason: this.reason,
      highlight: this.highlight,
      winner: this.winner,
      stats: null, // the room fills it in when the match is over
    };
  }
}

/** Broadcast copy for a match event. */
function eventText(kind: MatchEventKind, team: Team | null): string {
  const to = team ? ` — ${TEAM_CALL[team]}` : "";
  switch (kind) {
    case "point":
      return `POINT${to}`;
    case "game":
      return `GAME${to}`;
    case "set":
      return `SET & MATCH${to}`;
    case "fault":
      return "FAULT";
    case "let":
      return "LET";
    case "start":
      return "MATCH";
    case "reset":
      return "RESET";
  }
}
