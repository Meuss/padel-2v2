/**
 * Authoritative padel match engine: scoring, serve flow (with validation,
 * faults, lets and double-faults), side changes, and rally adjudication. It is
 * fed the ball position and the surfaces it touched each tick (from
 * PhysicsWorld) plus hit/serve events from the room, and decides when points end
 * and why.
 *
 * When a point is lost it records a `reason` and a `highlight` (the offending
 * bounce / wall contact / player) so the client can show what went wrong.
 */
import {
  COURT,
  MATCH,
  SERVE,
  SERVICE_LINE_DIST,
  type FaultHighlight,
  type MatchMsg,
  type MatchPhase,
  type Slot,
  type Team,
  type Vec3,
} from "@padel/shared";
import type { ContactKind } from "./world.js";

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

const TEAM_NAME: Record<Team, string> = { A: "Blue", B: "Red" };
const other = (t: Team): Team => (t === "A" ? "B" : "A");
const sign = (z: number): -1 | 1 => (z < 0 ? -1 : 1);
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

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
  // Serve-in-flight tracking.
  private isServe = false;
  private serveNetTouched = false;

  // ── Roster / lifecycle ─────────────────────────────────────────────────────

  setRoster(players: RosterPlayer[]): void {
    this.players = players;
    const ready = this.teamPlayers("A").length > 0 && this.teamPlayers("B").length > 0;
    if (!ready) {
      if (this.phase !== "warmup") this.reset();
      return;
    }
    if (this.phase === "warmup") this.startMatch();
    else if (!this.players.some((p) => p.slot === this.serverSlot)) {
      this.setupServe(performance.now(), 1);
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
    this.event = this.reason = null;
    this.highlight = null;
    this.teamSide = { A: -1, B: 1 };
    this.dirty = true;
  }

  private startMatch(): void {
    this.reset();
    this.event = "Match start";
    this.newGame(performance.now());
  }

  /** Reset the score and restart the set (used by a passed reset vote). */
  resetMatch(): void {
    const ready = this.teamPlayers("A").length > 0 && this.teamPlayers("B").length > 0;
    this.reset();
    if (ready) {
      this.event = "Set reset";
      this.newGame(performance.now());
    }
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

  // ── Events from the room ───────────────────────────────────────────────────

  serve(slot: Slot): ServeLaunch | null {
    if (this.phase !== "serve" || !this.awaitingServe || slot !== this.serverSlot) {
      return null;
    }
    this.awaitingServe = false;
    this.phase = "rally";
    const serverTeam = this.teamOf(slot)!;
    this.hitterTeam = serverTeam;
    this.hitterSide = this.teamSide[serverTeam];
    this.crossed = false;
    this.bouncedTarget = false;
    this.bounceCount = 0;
    this.stallSince = 0;
    this.isServe = true;
    this.serveNetTouched = false;
    this.event = null;
    this.dirty = true;
    return { from: { ...this.holdPos }, to: { ...this.targetPoint } };
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
      this.endPoint(now, other(team), "Double hit — one side touched the ball twice", {
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
    return true;
  }

  // ── Per-tick adjudication ──────────────────────────────────────────────────

  tick(now: number, ball: Vec3, speed: number, contacts: ContactKind[]): EngineAction {
    switch (this.phase) {
      case "warmup":
        return { hold: null };
      case "serve":
        return { hold: { ...this.holdPos } };
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

  private serveTick(now: number, ball: Vec3, contacts: ContactKind[]): EngineAction {
    for (const kind of contacts) {
      if (kind === "net") {
        this.serveNetTouched = true;
      } else if (kind === "wall") {
        // Touched a wall before bouncing in the box — fault.
        return this.serveFault(now, ball, "Serve hit the wall before bouncing");
      } else if (kind === "floor") {
        const inBox =
          sign(ball.z) === this.targetSide &&
          Math.abs(ball.z) > 0.1 &&
          Math.abs(ball.z) <= SERVICE_LINE_DIST &&
          sign(ball.x) === this.targetXSign &&
          Math.abs(ball.x) <= HALF_W;
        if (!inBox) {
          return this.serveFault(now, ball, "Serve out — must land in the diagonal box");
        }
        if (this.serveNetTouched) {
          return this.serveLet(now); // net cord into the box → replay
        }
        // Good serve — the rally is live; this counts as the first bounce.
        this.isServe = false;
        this.crossed = true;
        this.bouncedTarget = true;
        this.bounceCount = 1;
        return { hold: null };
      }
    }
    // Left the cage before bouncing — fault.
    if (Math.abs(ball.x) > HALF_W + 0.3 || Math.abs(ball.z) > HALF_L + 0.3) {
      return this.serveFault(now, ball, "Serve out — long");
    }
    return { hold: null };
  }

  private serveFault(now: number, ball: Vec3, why: string): EngineAction {
    this.isServe = false;
    if (this.serveAttempt === 1) {
      this.replayServe = true;
      this.replayAttempt = 2;
      this.phase = "between";
      this.betweenUntil = now + 1300;
      this.event = "Fault — second serve";
      this.reason = why;
      this.highlight = { kind: "out", pos: { ...ball } };
      this.dirty = true;
      return { hold: { x: 0, y: 1.2, z: 0 } };
    }
    return this.endPoint(now, other(this.teamOf(this.serverSlot!)!), `Double fault — ${why}`, {
      kind: "out",
      pos: { ...ball },
    });
  }

  private serveLet(now: number): EngineAction {
    this.isServe = false;
    this.replayServe = true;
    this.replayAttempt = this.serveAttempt; // a let does not use up a serve
    this.phase = "between";
    this.betweenUntil = now + 1300;
    this.event = "Let — replay serve";
    this.reason = null;
    this.highlight = null;
    this.dirty = true;
    return { hold: { x: 0, y: 1.2, z: 0 } };
  }

  private rallyTick(
    now: number,
    ball: Vec3,
    speed: number,
    contacts: ContactKind[],
  ): EngineAction {
    const target = this.targetSideNow;
    if (!this.crossed && sign(ball.z) === target && Math.abs(ball.z) > 0.3) {
      this.crossed = true;
    }

    for (const kind of contacts) {
      const s = sign(ball.z);
      if (kind === "floor") {
        if (s === target && this.crossed) {
          this.bounceCount++;
          this.bouncedTarget = true;
          this.stallSince = 0;
          if (this.bounceCount >= 2) {
            return this.endPoint(now, this.hitterTeam!, "Two bounces — not returned in time", {
              kind: "ground",
              pos: { ...ball },
            });
          }
        } else if (s === this.hitterSide) {
          if (!this.crossed) {
            return this.endPoint(now, other(this.hitterTeam!), "Into the net — didn't clear", {
              kind: "net",
              pos: { x: 0, y: COURT.netHeight, z: 0 },
            });
          }
          return this.endPoint(now, this.hitterTeam!, "Unreturned", {
            kind: "ground",
            pos: { ...ball },
          });
        }
      } else if (kind === "wall") {
        if (s === target && this.crossed && !this.bouncedTarget) {
          return this.endPoint(
            now,
            other(this.hitterTeam!),
            "Hit the wall on the full — must bounce on the floor first",
            { kind: "wall", pos: { ...ball } },
          );
        }
      }
    }

    if (Math.abs(ball.x) > HALF_W + 0.3 || Math.abs(ball.z) > HALF_L + 0.3) {
      return this.bouncedTarget
        ? this.endPoint(now, this.hitterTeam!, "Unreturnable — out off the bounce", {
            kind: "out",
            pos: { ...ball },
          })
        : this.endPoint(now, other(this.hitterTeam!), "Out — over the cage", {
            kind: "out",
            pos: { ...ball },
          });
    }

    if (speed < 0.6 && ball.y < 0.25) {
      if (this.stallSince === 0) this.stallSince = now;
      else if (now - this.stallSince > 1500) {
        return this.bouncedTarget
          ? this.endPoint(now, this.hitterTeam!, "Not returned", {
              kind: "ground",
              pos: { ...ball },
            })
          : this.endPoint(now, other(this.hitterTeam!), "Didn't reach the other side", {
              kind: "net",
              pos: { x: 0, y: COURT.netHeight, z: 0 },
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
    this.event = `Point — ${TEAM_NAME[w]}`;
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
    this.event = `Game — ${TEAM_NAME[w]} (${this.gamesA}-${this.gamesB})`;
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
    this.event = `Set & Match — ${TEAM_NAME[w]}! (${this.gamesA}-${this.gamesB})`;
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

    // Auto-serve aims deep in the box; occasionally (rarely) misses on the
    // first serve so faults exist, almost never on the second (few double faults).
    const faultChance = attempt === 1 ? 0.12 : 0.04;
    if (Math.random() < faultChance) {
      if (Math.random() < 0.5) {
        // Long — past the service line.
        this.targetPoint = {
          x: this.targetXSign * rand(1.0, HALF_W - 1.2),
          y: 0,
          z: this.targetSide * (SERVICE_LINE_DIST + rand(0.5, 1.4)),
        };
      } else {
        // Wide — into the wrong service box.
        this.targetPoint = {
          x: -this.targetXSign * rand(1.0, 3.0),
          y: 0,
          z: this.targetSide * rand(3.5, SERVICE_LINE_DIST - 0.8),
        };
      }
    } else {
      this.targetPoint = {
        x: this.targetXSign * rand(1.0, HALF_W - 1.2),
        y: 0,
        z: this.targetSide * rand(3.5, SERVICE_LINE_DIST - 0.8),
      };
    }

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
      event: this.event,
      reason: this.reason,
      highlight: this.highlight,
      winner: this.winner,
    };
  }
}
