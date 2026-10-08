/**
 * Dev-only helpers for `pnpm shoot` and manual checks: sample Banners, a sample Final card, sample
 * faults, and the auto-serve. Every call site in main.ts is behind `import.meta.env.DEV`, so
 * production builds drop all of this.
 */
import {
  COURT,
  SERVICE_LINE_DIST,
  tossApex,
  type FaultHighlight,
  type InputMsg,
  type MatchMsg,
  type Team,
  type Vec2,
  type VoteMsg,
} from "@padel/shared";
import type { BannerItem } from "./hud/banner.js";
import { bannerFor, goldenPointBanner } from "./hud/copy.js";

// ── Dev query parameters ─────────────────────────────────────────────────────

/** What the dev query parameters ask for (`pnpm shoot` and manual checks). */
export interface DevParams {
  /** ?quality=high|low pins the renderer quality (the shoot tool measures each level). */
  quality: "high" | "low" | null;
  /** ?forceReplay=1: every point is notable, so `pnpm shoot` can catch a replay. */
  forceReplay: boolean;
  /** ?finalCard=1: the Final card with synthetic stats and an open Rematch vote. */
  finalCard: boolean;
  /** ?controls=1: the controls card opens on every Welcome, seen or not, and holds through serves. */
  controls: boolean;
  /** ?vote=reset|rematch: a synthetic open vote, for the vote panel. */
  vote: VoteMsg["kind"] | null;
  /** ?banner=<kind>: a Banner held on screen (rallies included) for screenshots. */
  banner: BannerItem | null;
  /** ?join=<name>: skip the nickname card and join with this name. */
  join: string | null;
  /** &bots=<n> (0-3, with ?join): bots to add once seated; set to 0 once they are asked for. */
  bots: number;
  /** &autoserve=1 (with ?join): serve by itself so `pnpm shoot` can show rallies. */
  autoServe: boolean;
  /** ?tray=1: the emote tray open. */
  tray: boolean;
  /** ?fault=<kind>[&faultAt=<ms>]: a synthetic fault, looped, or held `faultAt` ms in. */
  fault: DevFault | null;
  /** ?joinView=loading|outdated holds that join state. */
  joinView: "loading" | "outdated" | null;
  /** ?roomStatus=<playing>,<watching> fakes the join screen's room line. */
  roomStatus: { playing: number; watching: number } | null;
}

/** No dev parameters: what a production page always has. */
export const NO_DEV_PARAMS: DevParams = {
  quality: null,
  forceReplay: false,
  finalCard: false,
  controls: false,
  vote: null,
  banner: null,
  join: null,
  bots: 0,
  autoServe: false,
  tray: false,
  fault: null,
  joinView: null,
  roomStatus: null,
};

/** The dev parameters in a query string (`location.search`). Pure. */
export function readDevParams(search: string): DevParams {
  const q = new URLSearchParams(search);
  const quality = q.get("quality");
  const vote = q.get("vote");
  const banner = q.get("banner");
  const join = q.get("join");
  const fault = q.get("fault");
  const highlight = fault === null ? null : devFaultHighlight(fault);
  const at = q.get("faultAt");
  const joinView = q.get("joinView");
  const room = q.get("roomStatus")?.split(",").map(Number);
  return {
    quality: quality === "high" || quality === "low" ? quality : null,
    forceReplay: q.get("forceReplay") === "1",
    finalCard: q.get("finalCard") === "1",
    controls: q.get("controls") === "1",
    vote: vote === "reset" || vote === "rematch" ? vote : null,
    banner: banner === null ? null : devBannerItem(banner),
    join,
    bots: join === null ? 0 : Math.max(0, Math.min(3, Number(q.get("bots") ?? 0) || 0)),
    autoServe: join !== null && q.get("autoserve") === "1",
    tray: q.get("tray") === "1",
    fault: highlight ? { highlight, freezeMs: at === null ? null : Number(at) } : null,
    joinView: joinView === "loading" || joinView === "outdated" ? joinView : null,
    roomStatus: room?.length === 2 ? { playing: room[0]!, watching: room[1]! } : null,
  };
}

// ── Dev Banner (?banner=<kind>) ──────────────────────────────────────────────

/** A sample Banner for a kind ("golden", "game", "set", "fault", "let", "start", "reset") or its title. */
export function devBannerItem(raw: string): BannerItem | null {
  const k = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (k === "golden" || k === "goldenpoint") return { copy: goldenPointBanner(5, 4), durationMs: Infinity };
  const kinds = { game: "game", set: "set&match", fault: "fault", let: "let", start: "match", reset: "reset" } as const;
  for (const [kind, title] of Object.entries(kinds) as [keyof typeof kinds, string][]) {
    if (k !== kind && k !== title) continue;
    const copy = bannerFor(kind, kind === "game" || kind === "set" ? "A" : null, 5, 4, kind === "fault" ? "Into the net" : null);
    return copy ? { copy, durationMs: Infinity } : null;
  }
  return null;
}

// ── Dev Final card (?finalCard=1) ────────────────────────────────────────────

/** A finished match with sample stats, won by `winner` (our team, so a long nickname shows on the card). */
export function devFinalMatch(winner: Team): MatchMsg {
  return {
    t: "match",
    phase: "over",
    pointA: "0",
    pointB: "0",
    gamesA: winner === "A" ? 6 : 4,
    gamesB: winner === "A" ? 4 : 6,
    tiebreak: false,
    sideA: -1,
    serverSlot: null,
    serveBox: null,
    awaitingServe: false,
    tossing: false,
    event: "SET & MATCH",
    eventKind: "set",
    eventTeam: winner,
    reason: null,
    highlight: null,
    winner,
    stats: {
      A: { shots: 132, perfect: 51, smashes: 9, points: 31 },
      B: { shots: 118, perfect: 34, smashes: 5, points: 24 },
      longestRally: 17,
      durationS: 642,
    },
  };
}

// ── Dev fault animation (?fault=<kind>&faultAt=<ms>) ─────────────────────────

export interface DevFault {
  highlight: FaultHighlight;
  freezeMs: number | null;
}

/** What the dev fault needs from the page: our side and team, and the scene to play it on. */
export interface DevFaultHost {
  side(): -1 | 1;
  team(): Team | null;
  play(h: FaultHighlight, freezeMs: number | null): void;
}

let devFaultTimer: number | undefined;

/** Play the synthetic fault once the players are on court: looped, or held at `freezeMs`. */
export function startDevFault(f: DevFault, host: DevFaultHost): void {
  if (devFaultTimer !== undefined) return;
  // The samples sit in the z > 0 half: mirror them into the far half from our camera.
  const play = () => {
    const h = host.side() === 1 ? mirrorFault(f.highlight) : { ...f.highlight };
    if (h.slot) h.slot = host.team() === "B" ? "A1" : "B1"; // an opponent, across the net
    host.play(h, f.freezeMs);
  };
  devFaultTimer = window.setTimeout(() => {
    play();
    if (f.freezeMs === null) devFaultTimer = window.setInterval(play, 2600);
  }, 1500);
}

/** The same fault seen from the other end: z (and the box's half) flipped. */
function mirrorFault(h: FaultHighlight): FaultHighlight {
  const m: FaultHighlight = { ...h };
  if (h.points) m.points = h.points.map((p) => ({ x: -p.x, y: p.y, z: -p.z }));
  if (h.box) m.box = { xMin: -h.box.xMax, xMax: -h.box.xMin, zNear: h.box.zNear, zFar: h.box.zFar, side: h.box.side === 1 ? -1 : 1 };
  return m;
}

/**
 * A sample fault at typical positions, mostly in the z > 0 half (the far half from the first
 * Player's camera): ground (double bounce), net, out, glass, mesh, player (double hit),
 * serve (long, with the target box) and serve-net.
 */
export function devFaultHighlight(kind: string): FaultHighlight | null {
  const box = { xMin: -5, xMax: 0, zNear: 0, zFar: 6.95, side: 1 } as const;
  switch (kind) {
    case "ground":
      return { kind: "ground", surface: "floor", points: [{ x: 1.4, y: 0.07, z: 4.6 }, { x: 2.6, y: 0.07, z: 7.4 }] };
    case "net":
      return { kind: "net", surface: "net", points: [{ x: -1.3, y: 0.74, z: 0.1 }] };
    case "out":
      return { kind: "out", points: [{ x: 1.6, y: 4.15, z: 10.08 }, { x: 1.1, y: 0.07, z: 7.2 }] };
    case "glass":
      return { kind: "wall", surface: "glass", points: [{ x: -1.6, y: 1.5, z: 9.93 }] };
    case "mesh":
      return { kind: "wall", surface: "mesh", points: [{ x: 4.93, y: 1.6, z: 2.6 }] };
    case "player":
      return { kind: "player", slot: "B1", points: [{ x: -2.5, y: 0, z: 5 }] };
    case "serve":
      return { kind: "out", surface: "floor", points: [{ x: -2.2, y: 0.07, z: 7.9 }], box };
    case "serve-net":
      return { kind: "net", surface: "net", points: [{ x: -2, y: 0.82, z: 0.1 }], box };
    default:
      return null;
  }
}

// ── Dev auto-serve (?autoserve=1) ────────────────────────────────────────────
// Timer-driven rather than per frame: headless SwiftShader renders at ~2 fps, slower than
// the toss lasts, and its render clock drifts well behind the server's.

const AUTOSERVE_DELAY_MS = 600;

/** What the auto-serve needs from the page. */
export interface AutoServeHost {
  /** We are the server, pinned at the serve spot. */
  locked(): boolean;
  side(): -1 | 1;
  /** The interpolation clock: the `view` of an ordinary input. */
  renderTime(): number;
  /** Send one input now, outside the frame loop, with these fields over the idle defaults. */
  send(extra: Partial<InputMsg>): void;
}

export class AutoServe {
  private state: "idle" | "tossing" | "striking" = "idle";
  private timer: number | undefined;
  /** The newest snapshot's server time and when it arrived, to estimate the server clock. */
  private lastSnapshot: { serverTime: number; at: number } | null = null;

  constructor(private host: AutoServeHost) {}

  /** On each snapshot: keeps the server clock estimate current. */
  onSnapshot(serverTime: number): void {
    this.lastSnapshot = { serverTime, at: performance.now() };
  }

  /**
   * On each match update: as the server awaiting the serve, toss AUTOSERVE_DELAY_MS later,
   * then strike a Drive at the toss apex. The toss started when we first see `tossing`, so
   * its apex is tossApex() later; the server judges the strike at our `view`, so a view of
   * that apex time is a perfect serve whenever the strike arrives within LAG.maxRewindMs.
   */
  onMatch(match: MatchMsg | null): void {
    if (!this.host.locked() || !match?.awaitingServe) {
      window.clearTimeout(this.timer);
      this.state = "idle";
      return;
    }
    if (!match.tossing && this.state === "idle") {
      this.state = "tossing";
      this.timer = window.setTimeout(() => this.host.send({ serve: true }), AUTOSERVE_DELAY_MS);
    } else if (match.tossing && this.state !== "striking") {
      this.state = "striking";
      window.clearTimeout(this.timer);
      const apexMs = tossApex() * 1000;
      const apex = this.serverClockNow() + apexMs;
      this.timer = window.setTimeout(() => this.host.send({ shot: "drive", view: apex }), apexMs);
    }
  }

  /** Unit aim from the serve spot to the centre of the diagonal service box. */
  aimAtBoxCentre(from: { x: number; z: number }): Vec2 {
    const side = this.host.side();
    const target = { x: (-Math.sign(from.x) * COURT.width) / 4, z: (-side * SERVICE_LINE_DIST) / 2 };
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    const len = Math.hypot(dx, dz);
    return { x: dx / len, z: dz / len };
  }

  /** Estimated server clock (ms) right now. */
  private serverClockNow(): number {
    const s = this.lastSnapshot;
    return s ? s.serverTime + (performance.now() - s.at) : this.host.renderTime();
  }
}
