/**
 * The single global game room. Owns the physics world, the match engine, the
 * connected clients, and the fixed-timestep loop. Each tick it integrates player
 * movement, resolves swings, steps physics, feeds the match engine, and (at the
 * snapshot rate) broadcasts world + match state.
 *
 * Movement is server-side world-mapped: clients send input in their own frame
 * (strafe / forward) and the room converts it using which half the player
 * currently defends, so controls stay correct through ends-swaps.
 */
import type { WebSocket } from "ws";
import {
  BALL,
  COURT,
  LAG,
  PLAYER,
  REACTIONS,
  SNAPSHOT_RATE,
  SWING,
  TICK_DT,
  TICK_MS,
  TICK_RATE,
  TOSS,
  encode,
  judgeTiming,
  resolveKind,
  shotVelocity,
  stepPlayer,
  swingConnects,
  timeToClosest,
  type ContactEvent,
  type ContactSurface,
  type ReactionMsg,
  type InputMsg,
  type KickedMsg,
  type MatchMsg,
  type PlayerInfo,
  type PlayerState,
  type RosterMsg,
  type ShotEvent,
  type Slot,
  type SnapshotMsg,
  type Team,
  type Vec2,
  type Vec3,
  type VoteMsg,
} from "@padel/shared";
import { updateBots, type BotSeat } from "./bots.js";
import { BallHistory, type BallSample } from "./history.js";
import { MatchEngine } from "./match.js";
import { mulberry32, type Rng } from "./rng.js";
import { PhysicsWorld, type Contact } from "./world.js";

const SLOT_ORDER: Slot[] = ["A1", "B1", "A2", "B2"];
const TEAM_OF: Record<Slot, Team> = { A1: "A", A2: "A", B1: "B", B2: "B" };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isFiniteVec2 = (v: unknown): v is Vec2 =>
  typeof v === "object" && v !== null && isFiniteNumber((v as Vec2).x) && isFiniteNumber((v as Vec2).z);

/**
 * Whether every number the room reads from an input is usable: finite vectors and view (a hostile
 * client can send NaN), and a non-negative safe-integer seq (it is echoed to everyone as `ack`).
 */
function isValidInput(input: InputMsg): boolean {
  return (
    Number.isSafeInteger(input.seq) &&
    input.seq >= 0 &&
    isFiniteVec2(input.move) &&
    isFiniteVec2(input.aim) &&
    isFiniteNumber(input.view)
  );
}

/** What a snapshot reports for a contact: the walls are glass up to COURT.glassHeight, mesh above. */
function contactSurface(c: Contact): ContactSurface {
  if (c.kind !== "wall") return c.kind;
  return c.pos.y <= COURT.glassHeight ? "glass" : "fence";
}

/** Funny bot names — famous folks + Swiss / Lausanne flavour. */
const BOT_NAMES = [
  "Roger Federer", "Stan Wawrinka", "Rafael Nadal", "Novak Djokovic",
  "Donald Trump", "Elon Musk", "Julien Sprunger", "Fribourg-Gottéron",
  "Taylor Swift", "Lionel Messi", "Cristiano Ronaldo", "Mr Bean",
  "Guillaume Tell", "Heidi", "DJ Bobo", "Général Guisan",
  "Papet Vaudois", "Monsieur Léman", "Ouchy Express", "Le LHC",
  "Roger du Flon", "Toblerone",
];

interface PlayerSlot extends BotSeat {
  clientId: string;
  name: string;
  slot: Slot;
  team: Team;
  side: -1 | 1; // which half they currently defend
  pos: { x: number; z: number };
  yaw: number;
  input: InputMsg | null;
  inputQueue: InputMsg[]; // humans: one is consumed per tick, in order
  ack: number | undefined; // seq of the last input applied (humans)
  stepCredit: number; // humans: token bucket limiting inputs consumed per second
  starvedTicks: number; // humans: consecutive ticks that found the input queue empty
  /** Shot requested since the last tick that consumed it (captured on arrival; bots write it). */
  shotRequested: "drive" | "lob" | null;
  /** The `view` time of the input that requested it: the moment the player saw. */
  shotView: number;
  serveRequested: boolean;
  lastSwingMs: number;
  lastReactionMs: number;
}

export interface Client {
  id: string;
  ws: WebSocket;
  name: string;
  lastActivity: number; // Date.now() of the last real user interaction
}

const IDLE_KICK_MS = 60_000;
const VOTE_TIMEOUT_MS = 30_000;
/** Max inputs buffered per player (~133 ms at 60 Hz); older ones are dropped. */
const MAX_QUEUED_INPUTS = 8;
/** Longest backlog (ticks) the loop catches up on in one timer callback. */
const MAX_CATCHUP_STEPS = 5;
/** A queue longer than this is drained two inputs per tick. */
const DRAIN_THRESHOLD = 2;
/** Most step credit a human can bank (also the burst size after a stall). */
const MAX_STEP_CREDIT = 3;
/**
 * Inputs kept when a backlog arrives after a stall; the older surplus is dropped.
 * The client already predicted those steps and replays only inputs past `ack`,
 * so it snaps to the server position instead of the server lagging behind.
 */
export const INPUT_SURPLUS_KEEP = 3;
/**
 * Consecutive ticks without a queued input that count as a stall (100 ms): shorter gaps, such as
 * ordinary Wi-Fi jitter, are absorbed by draining two inputs per tick instead of dropping any.
 */
export const STALL_TICKS = 6;

const TICKS_PER_SNAPSHOT = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE));

export class Room {
  private clients = new Map<string, Client>();
  private slots = new Map<Slot, PlayerSlot>();
  private tick = 0;
  private timer: NodeJS.Timeout | null = null;
  /**
   * Simulation clock (ms): advances exactly TICK_MS per step, so match timings follow the ticks.
   * Anchored at the wall clock so it keeps increasing across server restarts.
   */
  private clock = Date.now();
  /** Recent ball states, so swings are judged against the ball the player saw. */
  private history = new BallHistory();
  /** Bumped whenever the ball's flight changes by fiat: a hit, a serve, a relaunch, a placement. */
  private hitSeq = 0;
  /** Events since the last snapshot, sent with the next one. */
  private pendingShots: ShotEvent[] = [];
  private pendingContacts: ContactEvent[] = [];
  private lastSetupId = -1;
  private warmupIdle = 0;
  private botCounter = 0;
  /** The team that last struck the ball (serve or rally hit): bots never swing at their own team's ball. */
  private lastHitTeam: Team | null = null;
  private vote: { accepted: Set<string>; startedAt: number; initiator: string } | null =
    null;

  private constructor(
    private physics: PhysicsWorld,
    private match: MatchEngine,
    /** Bot decisions only: seeded, so a seeded room replays the same match. */
    private rng: Rng,
  ) {}

  /** `seed` makes bot decisions reproducible (tests); the default is random. */
  static async create(opts: { seed?: number } = {}): Promise<Room> {
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);
    return new Room(await PhysicsWorld.create(), new MatchEngine(), mulberry32(seed));
  }

  start(): void {
    if (this.timer) return;
    // Drift-free: setInterval alone runs slower than TICK_MS, so run however
    // many ticks are due by the wall clock (capped so a stall cannot spiral).
    let last = performance.now();
    let acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += now - last;
      last = now;
      let steps = Math.floor(acc / TICK_MS);
      acc -= steps * TICK_MS;
      if (steps > MAX_CATCHUP_STEPS) {
        steps = MAX_CATCHUP_STEPS;
        acc = 0;
      }
      for (let i = 0; i < steps; i++) this.step();
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The simulation clock (ms): the units of snapshot `serverTime` and of `InputMsg.view`. */
  get serverTime(): number {
    return this.clock;
  }

  /** Test and dev only: teleport the ball and give it a velocity. Counts as a new flight. */
  debugPlaceBall(pos: Vec3, vel: Vec3): void {
    this.physics.placeBall(pos, vel);
    this.hitSeq++;
  }

  addClient(client: Client): void {
    this.clients.set(client.id, client);
    // The spectator count is derived from the connected-client set, so any
    // connection change must rebroadcast the roster — even when no slot moves.
    this.broadcastRoster();
  }

  claimSlot(clientId: string, name: string): PlayerSlot | null {
    return this.fillSlot(clientId, name, false);
  }

  /** Spawn an AI bot into a free seat. Only a seated human may ask. */
  addBot(requesterId: string): boolean {
    if (!this.isSeated(requesterId)) return false;
    return this.spawnBot();
  }

  /** Test only: seat up to `n` bots without a human. */
  debugAddBots(n: number): void {
    for (let i = 0; i < n && this.spawnBot(); i++);
  }

  private spawnBot(): boolean {
    const used = new Set(
      [...this.slots.values()].filter((p) => p.isBot).map((p) => p.name),
    );
    const choices = BOT_NAMES.filter((n) => !used.has(`Bot ${n}`));
    this.botCounter++;
    const name = choices.length
      ? `Bot ${choices[Math.floor(Math.random() * choices.length)]!}`
      : `Bot ${this.botCounter}`;
    const ps = this.fillSlot(`bot-${this.botCounter}`, name, true);
    if (ps) console.log(`[bot] spawned ${ps.name} as ${ps.slot}`);
    return ps !== null;
  }

  /** Remove all AI bots. Only a seated human may ask. */
  clearBots(requesterId: string): boolean {
    if (!this.isSeated(requesterId)) return false;
    let removed = false;
    for (const [slot, ps] of [...this.slots]) {
      if (ps.isBot) {
        this.slots.delete(slot);
        removed = true;
      }
    }
    if (removed) {
      this.syncMatchRoster();
      this.broadcastRoster();
    }
    return removed;
  }

  /** Whether this connection holds a seat (bots never count as requesters). */
  private isSeated(clientId: string): boolean {
    for (const ps of this.slots.values()) {
      if (ps.clientId === clientId && !ps.isBot) return true;
    }
    return false;
  }

  private fillSlot(clientId: string, name: string, isBot: boolean): PlayerSlot | null {
    const free = SLOT_ORDER.find((s) => !this.slots.has(s));
    if (!free) return null;
    const team = TEAM_OF[free];
    const ps: PlayerSlot = {
      clientId,
      name,
      slot: free,
      team,
      side: this.match.sideOf(team),
      pos: this.homePosition(free, this.match.sideOf(team)),
      yaw: this.match.sideOf(team) < 0 ? 0 : Math.PI,
      input: null,
      inputQueue: [],
      ack: undefined,
      stepCredit: 0,
      starvedTicks: 0,
      shotRequested: null,
      shotView: 0,
      serveRequested: false,
      lastSwingMs: 0,
      isBot,
      serveReadyAt: 0,
      botArmed: true,
      botSwingAtS: null,
      lastReactionMs: 0,
    };
    this.slots.set(free, ps);
    this.syncMatchRoster();
    this.broadcastRoster();
    return ps;
  }

  removeClient(id: string): void {
    this.clients.delete(id);
    for (const [slot, ps] of this.slots) {
      if (ps.clientId === id) {
        this.slots.delete(slot);
        this.syncMatchRoster();
        break;
      }
    }
    // Always rebroadcast: removing a spectator changes the count without
    // freeing a slot, and freeing a slot also changes it.
    this.broadcastRoster();
    // Drop them from any active vote and re-check / refresh it.
    if (this.vote) {
      this.vote.accepted.delete(id);
      this.tryPassVote();
      this.broadcastVote();
    }
  }

  handleInput(clientId: string, input: InputMsg): void {
    if (!isValidInput(input)) return;
    for (const ps of this.slots.values()) {
      if (ps.clientId === clientId) {
        ps.inputQueue.push(input);
        if (ps.inputQueue.length > MAX_QUEUED_INPUTS) ps.inputQueue.shift();
        if (input.shot === "drive" || input.shot === "lob") {
          ps.shotRequested = input.shot;
          ps.shotView = input.view;
        }
        if (input.serve) ps.serveRequested = true;
        return;
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  matchMessage(): MatchMsg {
    return this.match.toMessage();
  }

  voteMessage(): VoteMsg {
    const needed = this.humanPlayerIds().length;
    return this.vote
      ? {
          t: "vote",
          active: true,
          initiator: this.vote.initiator,
          accepted: this.vote.accepted.size,
          needed,
        }
      : { t: "vote", active: false, initiator: "", accepted: 0, needed };
  }

  markActivity(id: string): void {
    const c = this.clients.get(id);
    if (c) c.lastActivity = Date.now();
  }

  /** Broadcast an emote reaction from a player (rate-limited). */
  react(clientId: string, id: string): void {
    if (!REACTIONS.includes(id as (typeof REACTIONS)[number])) return;
    const ps = [...this.slots.values()].find((p) => p.clientId === clientId);
    if (!ps) return; // only players (with an avatar) can react
    const now = Date.now();
    if (now - ps.lastReactionMs < 800) return;
    ps.lastReactionMs = now;
    this.sendAll(encode({ t: "reaction", slot: ps.slot, id } satisfies ReactionMsg));
  }

  /** Human (non-bot) players — the only ones who vote. */
  private humanPlayerIds(): string[] {
    return [...this.slots.values()].filter((p) => !p.isBot).map((p) => p.clientId);
  }

  requestResetVote(id: string): void {
    if (!this.humanPlayerIds().includes(id)) return;
    if (!this.vote) {
      this.vote = {
        accepted: new Set([id]),
        startedAt: Date.now(),
        initiator: this.clients.get(id)?.name ?? "Player",
      };
    } else {
      this.vote.accepted.add(id);
    }
    this.tryPassVote();
    this.broadcastVote();
  }

  declineVote(id: string): void {
    if (this.vote && this.humanPlayerIds().includes(id)) {
      this.vote = null;
      this.broadcastVote();
    }
  }

  private tryPassVote(): void {
    if (!this.vote) return;
    const needed = this.humanPlayerIds();
    if (needed.length > 0 && needed.every((pid) => this.vote!.accepted.has(pid))) {
      this.vote = null;
      this.match.resetMatch(this.clock);
      this.broadcastMatch();
    }
  }

  private broadcastVote(): void {
    this.sendAll(encode(this.voteMessage()));
  }

  /** Per-tick session upkeep: vote timeout and idle auto-kick. */
  private maintainSession(): void {
    const now = Date.now();
    if (this.vote && now - this.vote.startedAt > VOTE_TIMEOUT_MS) {
      this.vote = null;
      this.broadcastVote();
    }
    const idle = [...this.clients.values()].filter(
      (c) => now - c.lastActivity > IDLE_KICK_MS,
    );
    for (const c of idle) this.kick(c, "Kicked for inactivity");
  }

  private kick(c: Client, reason: string): void {
    try {
      if (c.ws.readyState === c.ws.OPEN) {
        c.ws.send(encode({ t: "kicked", reason } satisfies KickedMsg));
      }
    } catch {
      /* ignore */
    }
    this.removeClient(c.id);
    try {
      c.ws.close();
    } catch {
      /* ignore */
    }
  }

  private syncMatchRoster(): void {
    this.match.setRoster(
      [...this.slots.values()].map((p) => ({ slot: p.slot, team: p.team })),
      this.clock,
    );
  }

  private homePosition(slot: Slot, side: -1 | 1): { x: number; z: number } {
    const x = slot.endsWith("1") ? -2.5 : 2.5;
    return { x, z: side * COURT.length * 0.25 };
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  /** Advance the room by one fixed tick (called by the loop; public for tests). */
  step(): void {
    const now = this.clock;
    this.clock += TICK_MS;
    // Keep each player's defended side in sync with the match (handles swaps).
    for (const ps of this.slots.values()) ps.side = this.match.sideOf(ps.team);

    updateBots(
      {
        seats: [...this.slots.values()],
        ball: this.physics.ballState(),
        lastHitTeam: this.lastHitTeam,
        match: this.match,
        rng: this.rng,
        strikeServe: (ps, at, aimPoint) => this.strikeServe(ps, at, aimPoint),
      },
      now,
    );
    this.integratePlayers();
    // After integration, so a strike uses the aim of the input applied this tick.
    this.handleServeRequests(now);
    if (this.match.phase === "rally" || this.match.phase === "warmup") {
      this.resolveSwings(now);
    }

    const contacts = this.physics.step();
    for (const c of contacts) {
      this.pendingContacts.push({ surface: contactSurface(c), pos: c.pos, speed: c.speed });
    }
    const action = this.match.tick(
      now,
      this.physics.ballPosition(),
      this.physics.ballSpeed(),
      contacts.map((c) => c.kind),
    );
    if (action.hold) this.holdBall(action.hold);
    if (this.match.phase === "warmup") this.warmupBall(now);
    this.placeServeAvatars();
    // The ball as it is at the end of this tick: the state the snapshot shows at `clock`.
    this.history.push({ time: this.clock, ...this.physics.ballState(), hitSeq: this.hitSeq });

    this.tick++;
    // Match first: a snapshot on an ends-swap tick must be read with the new sides.
    if (this.match.consumeDirty()) this.broadcastMatch();
    if (this.tick % TICKS_PER_SNAPSHOT === 0) this.broadcastSnapshot();
    if (this.tick % 15 === 0) this.maintainSession(); // ~4×/s
  }

  /**
   * Space starts the server's toss; a click while it is in the air strikes it. The strike
   * is timed at the moment the player saw (their `view`), not when the click arrived.
   */
  private handleServeRequests(now: number): void {
    const serving = this.match.phase === "serve";
    const server = this.match.currentServer;
    for (const ps of this.slots.values()) {
      if (ps.isBot || ps.slot !== server) {
        ps.serveRequested = false;
        // A receiver's click before the serve must not swing at it on the strike tick.
        if (serving) ps.shotRequested = null;
        continue;
      }
      if (ps.serveRequested) {
        ps.serveRequested = false;
        // A click from before the toss must not strike it at once.
        if (this.match.startToss(ps.slot, now)) ps.shotRequested = null;
      }
      if (ps.shotRequested && this.match.tossElapsed(now) !== null) {
        ps.shotRequested = null;
        const strikeTime = now - clamp(now - ps.shotView, 0, LAG.maxRewindMs);
        this.strikeServe(ps, strikeTime, this.serveAimPoint(ps));
      }
    }
  }

  /** The ground point along the server's aim, |z| + TOSS.aimBeyondM out: in the opponents' half. */
  private serveAimPoint(ps: PlayerSlot): Vec2 {
    const aim = ps.input?.aim;
    const dir = aim && (aim.x !== 0 || aim.z !== 0) ? aim : { x: 0, z: -ps.side };
    const len = Math.hypot(dir.x, dir.z);
    const reach = Math.abs(ps.pos.z) + TOSS.aimBeyondM;
    return { x: ps.pos.x + (dir.x / len) * reach, z: ps.pos.z + (dir.z / len) * reach };
  }

  /** `strikeTime` is when the strike happened: rewound for humans, the present for bots. */
  private strikeServe(ps: PlayerSlot, strikeTime: number, aimPoint: Vec2): void {
    const struck = this.match.strikeServe(ps.slot, strikeTime, aimPoint);
    if (!struck) return;
    this.physics.launchServe(struck.launch.from, struck.launch.to);
    this.hitSeq++;
    this.lastHitTeam = ps.team;
    this.pendingShots.push({
      slot: ps.slot,
      kind: "serve",
      timing: struck.timing,
      pos: this.physics.ballPosition(),
    });
    ps.botArmed = false; // don't lunge at our own serve
  }

  private integratePlayers(): void {
    const server = this.match.currentServer;
    for (const ps of this.slots.values()) {
      // Humans consume one queued input per tick (two when the queue has
      // backed up) and do NOT move when it is empty. Each input is exactly one
      // stepPlayer call, so the client can replay the same steps. Bots write
      // `ps.input` directly every tick.
      const locked = this.match.phase === "serve" && ps.slot === server;
      if (ps.isBot) {
        const move = ps.input ? ps.input.move : { x: 0, z: 0 };
        this.applyMove(ps, move, locked);
      } else {
        // Token bucket: +1 credit per tick (capped), -1 per consumed input, so a
        // client flooding inputs cannot sustain more than one step per tick.
        ps.stepCredit = Math.min(MAX_STEP_CREDIT, ps.stepCredit + 1);
        // After a stall the backlog is stale: keep only the newest few inputs.
        if (ps.starvedTicks >= STALL_TICKS && ps.inputQueue.length > INPUT_SURPLUS_KEEP) {
          ps.inputQueue.splice(0, ps.inputQueue.length - INPUT_SURPLUS_KEEP);
        }
        let consumed = false;
        for (let k = 0; k < 2 && ps.stepCredit >= 1; k++) {
          if (k === 1 && ps.inputQueue.length <= DRAIN_THRESHOLD) break;
          const next = ps.inputQueue.shift();
          if (!next) break;
          ps.stepCredit -= 1;
          consumed = true;
          ps.input = next;
          ps.ack = next.seq;
          this.applyMove(ps, next.move, locked);
        }
        ps.starvedTicks = consumed ? 0 : ps.starvedTicks + 1;
        if (!consumed) this.applyMove(ps, { x: 0, z: 0 }, locked);
      }
      const aim = ps.input?.aim;
      if (aim && (aim.x !== 0 || aim.z !== 0)) ps.yaw = Math.atan2(aim.x, aim.z);
    }
  }

  /** The serving player is locked at the serve spot until they serve. */
  private applyMove(ps: PlayerSlot, move: Vec2, locked: boolean): void {
    if (locked) return;
    const p = stepPlayer(ps.pos, move, ps.side, TICK_DT);
    ps.pos.x = p.x;
    ps.pos.z = p.z;
  }

  /**
   * Resolve this tick's swings, each judged against the ball as the player saw it: rewound
   * to their `view` (at most LAG.maxRewindMs; bots see the present). A swing at a ball that
   * someone has hit since that moment misses. Reach, Smash height and Timing come from the
   * seen ball; the new velocity goes onto the live one.
   */
  private resolveSwings(now: number): void {
    const inRally = this.match.phase === "rally";
    for (const ps of this.slots.values()) {
      const requested = ps.shotRequested;
      if (requested === null) continue;
      ps.shotRequested = null;
      if (now - ps.lastSwingMs < SWING.cooldownMs) continue;
      ps.lastSwingMs = now;

      const live = this.physics.ballState();
      const present: BallSample = { time: now, ...live, hitSeq: this.hitSeq };
      const rewindMs = ps.isBot ? 0 : clamp(now - ps.shotView, 0, LAG.maxRewindMs);
      const seen = rewindMs > 0 ? (this.history.at(now - rewindMs) ?? present) : present;
      if (seen.hitSeq !== present.hitSeq) continue;

      const racket = { x: ps.pos.x, y: PLAYER.racketHeight, z: ps.pos.z };
      if (!swingConnects(racket.x, racket.y, racket.z, seen.pos, PLAYER.reach + BALL.radius)) {
        continue;
      }
      // In a rally, only a legal hit actually moves the ball (an illegal one —
      // hitting your own serve, or a double touch — must not).
      if (inRally && !this.match.hit(ps.slot, ps.team, now)) continue;

      // Struck on our own side: aim from the contact (a ball reached across the net is at it).
      const ownSide = Math.sign(seen.pos.z) === ps.side;
      const distToNet = ownSide ? Math.abs(seen.pos.z) : 0;
      const kind = resolveKind(requested, seen.pos.y, distToNet);
      const rel = { x: seen.pos.x - racket.x, y: seen.pos.y - racket.y, z: seen.pos.z - racket.z };
      const timing = judgeTiming(timeToClosest(rel, seen.vel));
      const contact = ownSide ? { y: seen.pos.y, distToNet } : undefined;
      const v = shotVelocity(kind, timing, this.shotAim(ps), contact);
      this.physics.setBallVelocity(v.x, v.y, v.z);
      this.hitSeq++;
      if (inRally) this.lastHitTeam = ps.team;
      this.pendingShots.push({ slot: ps.slot, kind, timing, pos: live.pos });
    }
  }

  /** The player's aim as a unit ground direction (straight at the far end if they have none). */
  private shotAim(ps: PlayerSlot): Vec2 {
    const aim = ps.input?.aim;
    const len = aim ? Math.hypot(aim.x, aim.z) : 0;
    return aim && len > 1e-6 ? { x: aim.x / len, z: aim.z / len } : { x: 0, z: -ps.side };
  }

  /** Teleport the server (and receiver) into place when a point is set up, and
   *  keep the server pinned at the serve spot while awaiting the serve. */
  private placeServeAvatars(): void {
    if (this.match.phase !== "serve") return;
    if (this.match.currentSetupId !== this.lastSetupId) {
      this.lastSetupId = this.match.currentSetupId;
      const r = this.match.receiverStand();
      if (r) {
        const ps = this.slots.get(r.slot);
        if (ps) {
          ps.pos.x = r.x;
          ps.pos.z = r.z;
        }
      }
    }
    const s = this.match.serverStand();
    if (s) {
      const ps = this.slots.get(s.slot);
      if (ps) {
        ps.pos.x = s.x;
        ps.pos.z = s.z;
        ps.yaw = ps.side < 0 ? 0 : Math.PI;
      }
    }
  }

  /**
   * Hold the ball where the match wants it. A jump of more than LAG.teleportM is a teleport:
   * it starts a new flight, so a rewound swing can't hit a position lerped across it.
   */
  private holdBall(pos: Vec3): void {
    const p = this.physics.ballPosition();
    if (Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z) > LAG.teleportM) this.hitSeq++;
    this.physics.holdBall(pos);
  }

  /** Keep a ball in play during warm-up so solo players can knock about. */
  private warmupBall(now: number): void {
    const p = this.physics.ballPosition();
    const resting = this.physics.ballSpeed() < 0.6 && p.y < BALL.radius + 0.05;
    this.warmupIdle = resting ? this.warmupIdle + 1 : 0;
    if (this.warmupIdle >= 90) {
      this.warmupIdle = 0;
      this.hitSeq++;
      this.physics.launchServe(
        { x: 0, y: 3, z: 0 },
        { x: (Math.random() - 0.5) * 6, y: 0, z: (Math.random() - 0.5) * 12 },
      );
    }
  }

  // ── Broadcasting ─────────────────────────────────────────────────────────────

  private buildPlayerStates(): PlayerState[] {
    const out: PlayerState[] = [];
    for (const ps of this.slots.values()) {
      out.push({
        slot: ps.slot,
        pos: { x: ps.pos.x, y: 0, z: ps.pos.z },
        yaw: ps.yaw,
        ...(ps.ack !== undefined && { ack: ps.ack }),
      });
    }
    return out;
  }

  private broadcastSnapshot(): void {
    const shots = this.pendingShots;
    const contacts = this.pendingContacts;
    this.pendingShots = [];
    this.pendingContacts = [];
    if (this.clients.size === 0) return;
    const snapshot: SnapshotMsg = {
      t: "snapshot",
      tick: this.tick,
      serverTime: this.clock,
      ball: this.physics.ballState(),
      players: this.buildPlayerStates(),
      ...(shots.length > 0 && { shots }),
      ...(contacts.length > 0 && { contacts }),
    };
    this.sendAll(encode(snapshot));
  }

  private broadcastMatch(): void {
    this.sendAll(encode(this.match.toMessage()));
  }

  private broadcastRoster(): void {
    const players: PlayerInfo[] = [];
    let humanPlayers = 0;
    for (const ps of this.slots.values()) {
      players.push({ id: ps.clientId, name: ps.name, slot: ps.slot, team: ps.team });
      if (!ps.isBot) humanPlayers++;
    }
    const roster: RosterMsg = {
      t: "roster",
      players,
      // Spectators are connected humans not occupying a player slot.
      spectatorCount: Math.max(0, this.clients.size - humanPlayers),
    };
    this.sendAll(encode(roster));
  }

  private sendAll(data: string): void {
    for (const c of this.clients.values()) {
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
    }
  }
}
