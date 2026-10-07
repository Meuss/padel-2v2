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
  PLAYER,
  REACTIONS,
  SNAPSHOT_RATE,
  SWING,
  TICK_DT,
  TICK_MS,
  TICK_RATE,
  encode,
  hitVelocity,
  stepPlayer,
  swingConnects,
  type ReactionMsg,
  type InputMsg,
  type KickedMsg,
  type MatchMsg,
  type PlayerInfo,
  type PlayerState,
  type RosterMsg,
  type Slot,
  type SnapshotMsg,
  type Team,
  type VoteMsg,
} from "@padel/shared";
import { MatchEngine } from "./match.js";
import { PhysicsWorld } from "./world.js";

const SLOT_ORDER: Slot[] = ["A1", "B1", "A2", "B2"];
const TEAM_OF: Record<Slot, Team> = { A1: "A", A2: "A", B1: "B", B2: "B" };
const RACKET_Y = 1.0;

/** Funny bot names — famous folks + Swiss / Lausanne flavour. */
const BOT_NAMES = [
  "Roger Federer", "Stan Wawrinka", "Rafael Nadal", "Novak Djokovic",
  "Donald Trump", "Elon Musk", "Julien Sprunger", "Fribourg-Gottéron",
  "Taylor Swift", "Lionel Messi", "Cristiano Ronaldo", "Mr Bean",
  "Guillaume Tell", "Heidi", "DJ Bobo", "Général Guisan",
  "Papet Vaudois", "Monsieur Léman", "Ouchy Express", "Le LHC",
  "Roger du Flon", "Toblerone",
];

interface PlayerSlot {
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
  swingRequested: boolean;
  serveRequested: boolean;
  lastSwingMs: number;
  swung: boolean;
  isBot: boolean;
  serveReadyAt: number;
  botArmed: boolean; // ready to take one swing (re-armed when the ball leaves reach)
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

const TICKS_PER_SNAPSHOT = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE));

export class Room {
  private clients = new Map<string, Client>();
  private slots = new Map<Slot, PlayerSlot>();
  private tick = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastSetupId = -1;
  private warmupIdle = 0;
  private botCounter = 0;
  private vote: { accepted: Set<string>; startedAt: number; initiator: string } | null =
    null;

  private constructor(
    private physics: PhysicsWorld,
    private match: MatchEngine,
  ) {}

  static async create(): Promise<Room> {
    return new Room(await PhysicsWorld.create(), new MatchEngine());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
      swingRequested: false,
      serveRequested: false,
      lastSwingMs: 0,
      swung: false,
      isBot,
      serveReadyAt: 0,
      botArmed: true,
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
    for (const ps of this.slots.values()) {
      if (ps.clientId === clientId) {
        ps.inputQueue.push(input);
        if (ps.inputQueue.length > MAX_QUEUED_INPUTS) ps.inputQueue.shift();
        if (input.swing) ps.swingRequested = true;
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
      this.match.resetMatch();
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
    );
  }

  private homePosition(slot: Slot, side: -1 | 1): { x: number; z: number } {
    const x = slot.endsWith("1") ? -2.5 : 2.5;
    return { x, z: side * COURT.length * 0.25 };
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  /** Advance the room by one fixed tick (called by the loop; public for tests). */
  step(): void {
    const now = performance.now();
    // Keep each player's defended side in sync with the match (handles swaps).
    for (const ps of this.slots.values()) ps.side = this.match.sideOf(ps.team);

    this.updateBots(now);
    this.handleServeRequests();
    this.integratePlayers();
    if (this.match.phase === "rally" || this.match.phase === "warmup") {
      this.resolveSwings(now);
    }

    const contacts = this.physics.step();
    const action = this.match.tick(
      now,
      this.physics.ballPosition(),
      this.physics.ballSpeed(),
      contacts,
    );
    if (action.hold) this.physics.holdBall(action.hold);
    if (this.match.phase === "warmup") this.warmupBall(now);
    this.placeServeAvatars();

    this.tick++;
    if (this.tick % TICKS_PER_SNAPSHOT === 0) this.broadcastSnapshot();
    if (this.match.consumeDirty()) this.broadcastMatch();
    if (this.tick % 15 === 0) this.maintainSession(); // ~4×/s
  }

  private handleServeRequests(): void {
    const server = this.match.currentServer;
    for (const ps of this.slots.values()) {
      if (ps.serveRequested) {
        ps.serveRequested = false;
        if (ps.slot === server) {
          const launch = this.match.serve(ps.slot);
          if (launch) this.physics.launchServe(launch.from, launch.to);
        }
      }
    }
  }

  private integratePlayers(): void {
    const server = this.match.currentServer;
    for (const ps of this.slots.values()) {
      // Humans consume exactly one queued input per tick and do NOT move when
      // the queue is empty, so the client can replay the same steps exactly.
      // Bots write `ps.input` directly every tick.
      let move = { x: 0, z: 0 };
      if (ps.isBot) {
        if (ps.input) move = ps.input.move;
      } else {
        const next = ps.inputQueue.shift();
        if (next) {
          ps.input = next;
          ps.ack = next.seq;
          move = next.move;
        }
      }
      const aim = ps.input?.aim;
      if (aim && (aim.x !== 0 || aim.z !== 0)) ps.yaw = Math.atan2(aim.x, aim.z);
      // The serving player is locked at the serve spot until they serve.
      if (this.match.phase === "serve" && ps.slot === server) continue;
      const p = stepPlayer(ps.pos, move, ps.side, TICK_DT);
      ps.pos.x = p.x;
      ps.pos.z = p.z;
    }
  }

  private resolveSwings(now: number): void {
    const inRally = this.match.phase === "rally";
    for (const ps of this.slots.values()) {
      if (!ps.swingRequested) continue;
      ps.swingRequested = false;
      if (now - ps.lastSwingMs < SWING.cooldownMs) continue;
      ps.lastSwingMs = now;
      ps.swung = true;

      const ball = this.physics.ballPosition();
      if (!swingConnects(ps.pos.x, RACKET_Y, ps.pos.z, ball, PLAYER.reach + BALL.radius)) {
        continue;
      }
      // In a rally, only a legal hit actually moves the ball (an illegal one —
      // hitting your own serve, or a double touch — must not).
      if (inRally && !this.match.hit(ps.slot, ps.team, now)) continue;
      const aim = ps.input?.aim ?? { x: 0, z: ps.side < 0 ? 1 : -1 };
      const v = hitVelocity(aim, SWING.power, SWING.lift);
      this.physics.setBallVelocity(v.x, v.y, v.z);
    }
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

  /** Keep a ball in play during warm-up so solo players can knock about. */
  private warmupBall(now: number): void {
    const p = this.physics.ballPosition();
    const resting = this.physics.ballSpeed() < 0.6 && p.y < BALL.radius + 0.05;
    this.warmupIdle = resting ? this.warmupIdle + 1 : 0;
    if (this.warmupIdle >= 90) {
      this.warmupIdle = 0;
      this.physics.launchServe(
        { x: 0, y: 3, z: 0 },
        { x: (Math.random() - 0.5) * 6, y: 0, z: (Math.random() - 0.5) * 12 },
      );
    }
  }

  /** Drive AI bots: hold a back-court lane, step to the ball only when it's a
   *  genuine incoming ball in their half, swing in reach, serve on their turn. */
  private updateBots(now: number): void {
    const phase = this.match.phase;
    const server = this.match.currentServer;
    const { pos: ball, vel } = this.physics.ballState();
    const halfL = COURT.length / 2;
    const clamp = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);
    for (const ps of this.slots.values()) {
      if (!ps.isBot) continue;
      const s = ps.side;
      const laneX = ps.slot.endsWith("1") ? -2.5 : 2.5; // left vs right lane
      const backZ = s * (halfL - 1.8); // home: near our own baseline
      const teammates = [...this.slots.values()].filter((p) => p.team === ps.team).length;
      const laneOk =
        teammates <= 1 ? true : laneX < 0 ? ball.x <= 0.3 : ball.x >= -0.3;
      const onOurSide = Math.sign(ball.z) === s;
      const incoming = Math.sign(vel.z) === s; // ball travelling toward our court
      const near = Math.hypot(ball.x - ps.pos.x, ball.z - ps.pos.z) < 3;
      const chase = onOurSide && laneOk && (incoming || near);
      // Target: the ball if it's ours to take, otherwise our back-court lane spot.
      const tx = chase ? ball.x : laneX;
      const tz = chase ? ball.z : backZ;
      ps.input = {
        t: "input",
        seq: 0,
        ts: now,
        move: { x: clamp((tx - ps.pos.x) * s), z: clamp(-(tz - ps.pos.z) * s) },
        aim: { x: clamp(-ps.pos.x * 0.15), z: -s },
        swing: false,
        serve: false,
      };
      const dx = ball.x - ps.pos.x;
      const dz = ball.z - ps.pos.z;
      // Swing once per approach: only when the ball is on the bot's own side
      // and has re-entered reach (re-armed after it leaves), so the bot never
      // hits its own ball twice.
      if (phase === "rally" && Math.sign(ball.z) === s) {
        const d = Math.hypot(dx, ball.y - RACKET_Y, dz);
        const inReach = d <= PLAYER.reach + BALL.radius + 0.2;
        if (inReach && ps.botArmed) {
          ps.swingRequested = true;
          ps.botArmed = false;
        } else if (!inReach) {
          ps.botArmed = true;
        }
      } else {
        ps.botArmed = true;
      }
      if (phase === "serve" && server === ps.slot) {
        if (ps.serveReadyAt === 0) ps.serveReadyAt = now + 700;
        else if (now >= ps.serveReadyAt) {
          ps.serveRequested = true;
          ps.botArmed = false; // don't lunge at our own serve
        }
      } else {
        ps.serveReadyAt = 0;
      }
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
        swing: ps.swung,
        ...(ps.ack !== undefined && { ack: ps.ack }),
      });
      ps.swung = false;
    }
    return out;
  }

  private broadcastSnapshot(): void {
    if (this.clients.size === 0) return;
    const snapshot: SnapshotMsg = {
      t: "snapshot",
      tick: this.tick,
      serverTime: Date.now(),
      ball: this.physics.ballState(),
      players: this.buildPlayerStates(),
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
