/**
 * Fault animations: broadcast replay graphics for whatever lost the point, drawn at the true
 * positions the server recorded (`FaultHighlight.points`).
 *
 *   Double bounce   numbered impact marks on the turf, 250 ms apart, a dashed arc between
 *                   them, and a red pulse on bounce 2.
 *   Net             the net's top tape lights from the contact outward, a ripple on the net
 *                   at the contact, and the ball's ghost hanging there for 0.6 s.
 *   Out             a ring at the exit point (on the cage plane, or flat where it landed), an
 *                   OUT chip, and a faint dashed line back to the last bounce.
 *   On the full     an impact star on the glass, or a rattling glow on the mesh panel, and the
 *                   ball's ghost.
 *   Double hit      a ring around the player and a 2× chip.
 *   Serve fault     any of the above plus the target service box, flashing.
 *
 * `--rojo` marks the fault, white the neutral marks. Every element eases in, and everything
 * eases out together at the end (1.9–2.1 s in all). The meshes are built once and reused; a
 * new fault replaces the last one, and `update` allocates nothing.
 */
import * as THREE from "three";
import {
  BALL,
  COURT,
  SERVICE_LINE_DIST,
  netHeightAt,
  type FaultKind,
  type FaultSurface,
  type ServiceBox,
  type Vec3,
} from "@padel/shared";
import { PALETTE } from "./palette.js";

export interface FaultFx {
  kind: FaultKind;
  points: Vec3[];
  surface?: FaultSurface;
  /** A serve fault: the box the serve had to land in. */
  box?: ServiceBox;
}

export type FaultAction = "ring" | "label" | "arc" | "pulse" | "sweep" | "chip" | "ghost" | "impact" | "line" | "box";

/** One element of a fault animation starting `at` ms in; `index` picks the point (or the mark) it belongs to. */
export interface FaultCue {
  at: number;
  action: FaultAction;
  index: number;
}

/** Cue times (ms from the start of the animation). */
const CUE = {
  bounceGap: 250,
  labelLag: 80,
  arc: 120,
  bouncePulse: 450,
  pulse: 200,
  chip: 150,
  line: 250,
  lastBounce: 350,
  netRing: 60,
  netPulse: 300,
  impact: 40,
} as const;

const DURATION_MS: Record<FaultKind, number> = { ground: 2100, net: 1900, out: 2000, wall: 2000, player: 1900 };

/** Envelope: each element eases in over IN_MS; all of them ease out over the last FADE_MS. */
const IN_MS = 260;
const FADE_MS = 650;
/** How fast `stop()` clears the screen (a replay is starting). */
const STOP_MS = 220;

const HALF_W = COURT.width / 2;
const HALF_L = COURT.length / 2;

/** The ordered cues of a fault's animation. Pure. */
export function faultTimeline(fx: FaultFx): FaultCue[] {
  const n = fx.points.length;
  if (n === 0) return [];
  const cues: FaultCue[] = [];
  const cue = (at: number, action: FaultAction, index = 0) => cues.push({ at, action, index });
  if (fx.box) cue(0, "box");
  switch (fx.kind) {
    case "ground":
      if (n >= 2) {
        cue(0, "ring", 0);
        cue(CUE.labelLag, "label", 0);
        cue(CUE.arc, "arc");
        cue(CUE.bounceGap, "ring", 1);
        cue(CUE.bounceGap + CUE.labelLag, "label", 1);
        cue(CUE.bouncePulse, "pulse", 1);
      } else {
        cue(0, "ring");
        cue(CUE.pulse, "pulse");
      }
      break;
    case "net":
      cue(0, "ghost");
      cue(0, "sweep");
      cue(CUE.netRing, "ring");
      cue(CUE.netPulse, "pulse");
      break;
    case "out":
      cue(0, "ring");
      cue(CUE.chip, "chip");
      if (n >= 2) {
        cue(CUE.line, "line");
        cue(CUE.lastBounce, "ring", 1);
      }
      break;
    case "wall":
      cue(0, "ghost");
      cue(CUE.impact, "impact");
      break;
    case "player":
      cue(0, "ring");
      if (faultChip(fx)) cue(CUE.chip, "chip");
      cue(CUE.pulse, "pulse");
      break;
  }
  return cues.sort((a, b) => a.at - b.at);
}

/** How long a fault's animation lasts (ms). Pure. */
export function faultDuration(fx: FaultFx): number {
  return DURATION_MS[fx.kind];
}

/** The chip's text: OUT for an out, 2× for a double hit; null when the fault has no chip. Pure. */
export function faultChip(fx: FaultFx): string | null {
  if (fx.kind === "out") return "OUT";
  if (fx.kind === "player" && !fx.box) return "2×";
  return null;
}

const easeOutExpo = (x: number): number => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const easeOutCubic = (x: number): number => 1 - (1 - x) ** 3;
const easeInOutCubic = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 1 → 0 with a soft start and a soft landing. */
const fadeCurve = (x: number): number => 0.5 + 0.5 * Math.cos(Math.PI * clamp01(x));

/**
 * Opacity of an element `sinceCueMs` after its cue, `elapsedMs` into an animation that ends at
 * `endMs`: eases in, holds, eases out over the last `fadeMs`. Pure.
 */
export function faultAlpha(sinceCueMs: number, elapsedMs: number, endMs: number, fadeMs = FADE_MS): number {
  if (sinceCueMs <= 0 || elapsedMs >= endMs) return 0;
  const fadeIn = easeOutCubic(clamp01(sinceCueMs / IN_MS));
  const fadeOut = elapsedMs < endMs - fadeMs ? 1 : fadeCurve((elapsedMs - (endMs - fadeMs)) / fadeMs);
  return fadeIn * fadeOut;
}

// ── Look ─────────────────────────────────────────────────────────────────────

const LOOK = {
  /** Height of the turf marks, with a polygon offset on top so they win over the lines. */
  turfY: 0.02,
  bounceR: 0.48,
  netR: 0.3,
  exitR: 0.4,
  lastBounceR: 0.26,
  playerR: 0.78,
  /** The ring grows from this fraction of its radius. */
  ringFrom: 0.35,
  ringGrowMs: 450,
  pulseMs: 700,
  pulseGrow: 1.5,
  /** The soft disc under a ring, relative to its radius. */
  discScale: 2.6,
  discOpacity: 0.3,
  labelY: 0.42,
  labelSize: 0.56,
  /** Gap (m) between a bounce ring's edge and its number. */
  labelBeside: 0.25,
  chipW: 1.1,
  chipH: 0.48,
  chipAbove: 0.78,
  chipBesidePlayerY: 0.9,
  ghostHoldMs: 600,
  ghostFadeMs: 350,
  arcDrawMs: 380,
  sweepMs: 650,
  impactGrowMs: 380,
  starSize: 1.6,
  rattleW: 1.5,
  rattleH: 1.1,
  rattleAmp: 0.035,
  rattleDecayMs: 180,
  /** Wall marks sit this far in front of the panel. */
  wallOffset: 0.03,
  boxFlashMs: 900,
  boxFlashPeriodMs: 300,
  boxInset: 0.12,
  boxFrame: 0.06,
  font: "'Barlow Condensed', 'Arial Narrow', sans-serif",
} as const;

const NAVY = "#0f1a33";
/** White marks run a touch over 1 so the bloom picks them up; red stays crisp. */
const WHITE_GLOW = new THREE.Color(PALETTE.lines).multiplyScalar(1.25);
const ROJO = new THREE.Color(PALETTE.rojo);

/** Canvas helpers return null where there is no DOM (tests). */
function makeCanvas(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext("2d");
}

function canvasTexture(ctx: CanvasRenderingContext2D | null): THREE.CanvasTexture | null {
  if (!ctx) return null;
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function softDisc(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
}

/** A round number tag: "1" on navy, "2" on red, both ringed in white. */
function drawNumber(ctx: CanvasRenderingContext2D, text: string, plate: string): void {
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = PALETTE.lines;
  ctx.stroke();
  ctx.fillStyle = PALETTE.lines;
  ctx.font = `700 80px ${LOOK.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 68);
}

/** A red plate with white condensed caps, the Banner's fault plate in miniature. */
function drawChip(ctx: CanvasRenderingContext2D, text: string): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PALETTE.rojo;
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, h - 8, 10);
  ctx.fill();
  ctx.fillStyle = PALETTE.lines;
  ctx.font = `700 76px ${LOOK.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "3px";
  ctx.fillText(text, w / 2, h / 2 + 4);
}

/** Glass impact star: radial cracks around a bright core, in red with white hairlines. */
function drawStar(ctx: CanvasRenderingContext2D): void {
  const c = 128;
  ctx.clearRect(0, 0, 256, 256);
  ctx.lineCap = "round";
  // A fixed pattern (no randomness): 13 cracks of varied length and slight angle jitter.
  const cracks = 13;
  for (let i = 0; i < cracks; i++) {
    const a = (i / cracks) * Math.PI * 2 + Math.sin(i * 2.7) * 0.18;
    const len = 70 + 46 * (0.5 + 0.5 * Math.sin(i * 1.9 + 0.6));
    const x = c + Math.cos(a) * len;
    const y = c + Math.sin(a) * len;
    ctx.strokeStyle = PALETTE.rojo;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * 10, c + Math.sin(a) * 10);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(244,247,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Two broken concentric cracks.
  ctx.strokeStyle = "rgba(216,56,58,0.85)";
  ctx.lineWidth = 3;
  for (const [r, from, to] of [
    [38, 0.2, 1.4],
    [38, 2.3, 3.6],
    [38, 4.2, 5.6],
    [64, 0.9, 2.0],
    [64, 3.3, 4.4],
  ] as const) {
    ctx.beginPath();
    ctx.arc(c, c, r, from, to);
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(c, c, 0, c, c, 22);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(c - 22, c - 22, 44, 44);
}

/** Mesh rattle: a glowing red frame around the struck stretch of wire. */
function drawRattle(ctx: CanvasRenderingContext2D): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(216,56,58,0.16)";
  ctx.fillRect(22, 22, w - 44, h - 44);
  ctx.shadowColor = PALETTE.rojo;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = PALETTE.rojo;
  ctx.lineWidth = 7;
  ctx.strokeRect(22, 22, w - 44, h - 44);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(244,247,255,0.85)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(22, 22, w - 44, h - 44);
}

// ── Dashed / sweeping ribbon ─────────────────────────────────────────────────

const RIBBON_SAMPLES = 64;

const RIBBON_VERTEX = /* glsl */ `
attribute vec3 aDir;
attribute float aSide;
attribute float aU;
uniform float uHalfWidth;
varying float vU;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // Widen across the path, facing the camera.
  vec3 across = cross(aDir, cameraPosition - world.xyz);
  float len = length(across);
  if (len > 1e-6) world.xyz += across / len * aSide * uHalfWidth;
  vU = aU;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const RIBBON_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uDash;
uniform float uFrom;
uniform float uTo;
uniform float uHeadA;
uniform float uHeadB;
uniform float uSharp;
uniform float uHot;
varying float vU;
void main() {
  if (vU < uFrom || vU > uTo) discard;
  if (uDash > 0.0 && fract(vU * uDash) > 0.55) discard;
  // Bright, white-hot heads at the drawing (or sweeping) fronts.
  float head = exp(-abs(vU - uHeadA) * uSharp) + exp(-abs(vU - uHeadB) * uSharp);
  float hot = clamp(head * uHot, 0.0, 1.0);
  gl_FragColor = vec4(mix(uColor, vec3(1.25), hot), clamp(uOpacity * (1.0 + hot), 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

type RibbonUniforms = {
  uColor: { value: THREE.Color };
  uOpacity: { value: number };
  uDash: { value: number };
  uFrom: { value: number };
  uTo: { value: number };
  uHeadA: { value: number };
  uHeadB: { value: number };
  uSharp: { value: number };
  uHot: { value: number };
  uHalfWidth: { value: number };
};

/** A camera-facing ribbon along a path, revealed between two fractions of its length. */
class Ribbon {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly u: RibbonUniforms;
  private pos: THREE.BufferAttribute;
  private dir: THREE.BufferAttribute;
  private pts = new Float32Array(RIBBON_SAMPLES * 3);
  /** Path length (m) of the last `setPath`. */
  length = 0;

  constructor(name: string) {
    const n = RIBBON_SAMPLES;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.dir = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    const side = new Float32Array(n * 2);
    const along = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
      along[i * 2] = along[i * 2 + 1] = i / (n - 1);
    }
    const index: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setAttribute("position", this.pos);
    g.setAttribute("aDir", this.dir);
    g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    g.setAttribute("aU", new THREE.BufferAttribute(along, 1));
    g.setIndex(index);
    this.u = {
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 0 },
      uDash: { value: 0 },
      uFrom: { value: 0 },
      uTo: { value: 1 },
      uHeadA: { value: -10 },
      uHeadB: { value: -10 },
      uSharp: { value: 30 },
      uHot: { value: 0 },
      uHalfWidth: { value: 0.03 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERTEX,
      fragmentShader: RIBBON_FRAGMENT,
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  /** Lay the ribbon along `at(u, out)` for u in [0, 1] (called on play, not per frame). */
  setPath(at: (u: number, out: THREE.Vector3) => void): void {
    const n = RIBBON_SAMPLES;
    const v = SCRATCH;
    const p = this.pts;
    this.length = 0;
    for (let i = 0; i < n; i++) {
      at(i / (n - 1), v);
      p[i * 3] = v.x;
      p[i * 3 + 1] = v.y;
      p[i * 3 + 2] = v.z;
      if (i > 0) this.length += Math.hypot(v.x - p[i * 3 - 3]!, v.y - p[i * 3 - 2]!, v.z - p[i * 3 - 1]!);
    }
    const pos = this.pos.array as Float32Array;
    const dir = this.dir.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const prev = Math.max(0, i - 1) * 3;
      const next = Math.min(n - 1, i + 1) * 3;
      for (let s = 0; s < 2; s++) {
        const k = (i * 2 + s) * 3;
        pos[k] = p[i * 3]!;
        pos[k + 1] = p[i * 3 + 1]!;
        pos[k + 2] = p[i * 3 + 2]!;
        dir[k] = p[next]! - p[prev]!;
        dir[k + 1] = p[next + 1]! - p[prev + 1]!;
        dir[k + 2] = p[next + 2]! - p[prev + 2]!;
      }
    }
    this.pos.needsUpdate = true;
    this.dir.needsUpdate = true;
  }
}

const SCRATCH = new THREE.Vector3();

// ── Player ───────────────────────────────────────────────────────────────────

type BasicMesh<G extends THREE.BufferGeometry = THREE.BufferGeometry> = THREE.Mesh<G, THREE.MeshBasicMaterial>;

function markMaterial(opts: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    ...opts,
  });
}

/** Which wall a point is nearest: a back wall (normal along z) or a side wall (along x). */
function nearestWallIsBack(x: number, z: number): boolean {
  return HALF_L - Math.abs(z) <= HALF_W - Math.abs(x);
}

/** Turn a flat XY-plane mark into the plane of the wall nearest (x, z). */
function faceWall(o: THREE.Object3D, x: number, z: number): void {
  o.rotation.set(0, nearestWallIsBack(x, z) ? 0 : Math.PI / 2, 0);
}

/** Plays one fault animation at a time. */
export class FaultFxPlayer {
  readonly root = new THREE.Group();
  /** Rings 0 and 1 mark points; ring 2 is the expanding pulse. */
  private rings: BasicMesh<THREE.RingGeometry>[];
  private discs: BasicMesh<THREE.PlaneGeometry>[];
  private ringR = [1, 1, 1];
  private labels: THREE.Sprite[];
  private labelY = [0, 0];
  private ribbon: Ribbon;
  private sweep: Ribbon;
  private sweepCentre = 0.5;
  private chip: THREE.Sprite;
  private chipY = 0;
  private chipCtx: CanvasRenderingContext2D | null;
  private chipText = "";
  private ghost: BasicMesh<THREE.SphereGeometry>;
  private ghostGlow: THREE.Sprite;
  private impact: BasicMesh<THREE.PlaneGeometry>;
  private impactBase = new THREE.Vector3();
  private impactAlong = new THREE.Vector3();
  private rattle = false;
  private starTex: THREE.CanvasTexture | null;
  private rattleTex: THREE.CanvasTexture | null;
  private boxFrame: BasicMesh<THREE.ShapeGeometry>;
  private boxFill: BasicMesh<THREE.PlaneGeometry>;
  private numberCtx: (CanvasRenderingContext2D | null)[];

  private cues: FaultCue[] = [];
  /** Ms since the animation started (negative while its delay runs). */
  private t = 0;
  private end = 0;
  private fadeMs = FADE_MS;
  private active = false;
  private frozenAt: number | null = null;
  private reduced = false;

  constructor(scene: THREE.Scene) {
    this.root.name = "fault-fx";
    const discCtx = makeCanvas(128, 128);
    if (discCtx) softDisc(discCtx);
    const discTex = canvasTexture(discCtx);

    const ringGeo = new THREE.RingGeometry(0.86, 1, 72);
    const discGeo = new THREE.PlaneGeometry(LOOK.discScale, LOOK.discScale);
    this.rings = [0, 1, 2].map((i) => {
      const m = new THREE.Mesh(ringGeo, markMaterial());
      m.name = i === 2 ? "fault-pulse" : "fault-ring";
      m.renderOrder = 6;
      return m;
    });
    this.discs = [0, 1].map((i) => {
      const d = new THREE.Mesh(discGeo, markMaterial({ map: discTex, polygonOffsetFactor: -2 }));
      d.name = "fault-glow";
      d.renderOrder = 5;
      this.rings[i]!.add(d);
      return d;
    });

    this.numberCtx = [makeCanvas(128, 128), makeCanvas(128, 128)];
    this.labels = [0, 1].map((i) => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: canvasTexture(this.numberCtx[i]!), transparent: true, depthWrite: false, depthTest: false, toneMapped: false }),
      );
      s.name = "fault-label";
      s.renderOrder = 8;
      s.scale.set(LOOK.labelSize, LOOK.labelSize, 1);
      return s;
    });

    this.ribbon = new Ribbon("fault-arc");
    this.sweep = new Ribbon("fault-sweep");

    this.chipCtx = makeCanvas(256, 112);
    this.chip = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: canvasTexture(this.chipCtx), transparent: true, depthWrite: false, depthTest: false, toneMapped: false }),
    );
    this.chip.name = "fault-chip";
    this.chip.renderOrder = 8;

    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 20, 14),
      new THREE.MeshBasicMaterial({ color: PALETTE.ball, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.ghost.name = "fault-ghost";
    this.ghost.renderOrder = 7;
    this.ghostGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: discTex, color: PALETTE.ball, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.ghostGlow.name = "fault-ghost-glow";
    this.ghostGlow.scale.setScalar(0.5);
    this.ghost.add(this.ghostGlow);

    const starCtx = makeCanvas(256, 256);
    if (starCtx) drawStar(starCtx);
    this.starTex = canvasTexture(starCtx);
    const rattleCtx = makeCanvas(256, 188);
    if (rattleCtx) drawRattle(rattleCtx);
    this.rattleTex = canvasTexture(rattleCtx);
    this.impact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), markMaterial({ map: this.starTex }));
    this.impact.name = "fault-impact";
    this.impact.renderOrder = 6;

    // The service box: an inset frame and a faint fill, flat on the turf, centred on the origin.
    const bw = HALF_W - 2 * LOOK.boxInset;
    const bh = SERVICE_LINE_DIST - 2 * LOOK.boxInset;
    const t = LOOK.boxFrame;
    const outer = new THREE.Shape();
    outer.moveTo(-bw / 2, -bh / 2).lineTo(bw / 2, -bh / 2).lineTo(bw / 2, bh / 2).lineTo(-bw / 2, bh / 2).closePath();
    const hole = new THREE.Path();
    hole.moveTo(-bw / 2 + t, -bh / 2 + t).lineTo(-bw / 2 + t, bh / 2 - t).lineTo(bw / 2 - t, bh / 2 - t).lineTo(bw / 2 - t, -bh / 2 + t).closePath();
    outer.holes.push(hole);
    this.boxFrame = new THREE.Mesh(new THREE.ShapeGeometry(outer).rotateX(-Math.PI / 2), markMaterial({ color: WHITE_GLOW }));
    this.boxFrame.name = "fault-box";
    this.boxFrame.renderOrder = 6;
    this.boxFill = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh).rotateX(-Math.PI / 2), markMaterial({ color: PALETTE.lines }));
    this.boxFill.name = "fault-box-fill";
    this.boxFill.renderOrder = 5;

    this.root.add(...this.rings, ...this.labels, this.ribbon.mesh, this.sweep.mesh, this.chip, this.ghost, this.impact, this.boxFrame, this.boxFill);
    this.hideAll();
    scene.add(this.root);

    this.drawText();
    // Barlow Condensed comes from a web font: redraw the canvas text once it is ready.
    if (typeof document !== "undefined" && document.fonts) {
      void document.fonts.load(`700 80px 'Barlow Condensed'`).then(() => this.drawText(), () => {});
    }
  }

  /** Fewer, gentler moves: no growing rings, pulses, travel or rattle; the fades stay. */
  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  /** Dev: hold every animation at `ms` from its start (null: run normally). */
  freeze(ms: number | null): void {
    this.frozenAt = ms;
  }

  /** Start `fx` after `delayMs` (the rendered ball reaches the fault then), replacing any other. */
  play(fx: FaultFx, delayMs: number): void {
    this.hideAll();
    this.cues = faultTimeline(fx);
    this.end = faultDuration(fx);
    this.fadeMs = FADE_MS;
    this.t = -delayMs;
    this.active = this.cues.length > 0;
    if (this.active) this.place(fx);
  }

  /** Ease the current fault out fast (a replay is starting); one still waiting never shows. */
  stop(): void {
    if (!this.active) return;
    if (this.t <= 0 || this.frozenAt !== null) {
      this.active = false;
      this.hideAll();
      return;
    }
    if (this.end - this.t > STOP_MS) {
      this.end = this.t + STOP_MS;
      this.fadeMs = STOP_MS;
    }
  }

  update(dtSec: number): void {
    if (!this.active) return;
    this.t = this.frozenAt ?? this.t + dtSec * 1000;
    if (this.t >= this.end) {
      this.active = false;
      this.hideAll();
      return;
    }
    for (let i = 0; i < this.cues.length; i++) {
      const c = this.cues[i]!;
      this.apply(c.action, c.index, this.t - c.at);
    }
  }

  private hideAll(): void {
    for (const o of this.root.children) o.visible = false;
  }

  private drawText(): void {
    const [one, two] = this.numberCtx;
    if (one) drawNumber(one, "1", NAVY);
    if (two) drawNumber(two, "2", PALETTE.rojo);
    if (this.chipCtx && this.chipText) drawChip(this.chipCtx, this.chipText);
    for (const s of [...this.labels, this.chip]) if (s.material.map) s.material.map.needsUpdate = true;
  }

  /** Position and colour every element the fault uses (on play only). */
  private place(fx: FaultFx): void {
    const p0 = fx.points[0]!;
    const p1 = fx.points[1];
    switch (fx.kind) {
      case "ground":
        if (p1) {
          this.ringFlat(0, p0, LOOK.bounceR, WHITE_GLOW);
          this.ringFlat(1, p1, LOOK.bounceR, ROJO);
          // The numbers stand beside their marks, off the arc's path.
          const d = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
          let sx = -(p1.z - p0.z) / d;
          let sz = (p1.x - p0.x) / d;
          if (sx < 0) {
            sx = -sx;
            sz = -sz;
          }
          const off = LOOK.bounceR + LOOK.labelBeside;
          this.labels[0]!.position.set(p0.x + sx * off, LOOK.labelY, p0.z + sz * off);
          this.labels[1]!.position.set(p1.x + sx * off, LOOK.labelY, p1.z + sz * off);
          this.labelY[0] = this.labelY[1] = LOOK.labelY;
          this.arcPath(p0, p1);
          this.pulseFrom(1);
        } else {
          this.ringFlat(0, p0, LOOK.bounceR, ROJO);
          this.pulseFrom(0);
        }
        break;
      case "net": {
        const x = THREE.MathUtils.clamp(p0.x, -HALF_W + 0.3, HALF_W - 0.3);
        const top = netHeightAt(x);
        const ring = this.rings[0]!;
        ring.position.set(x, THREE.MathUtils.clamp(p0.y, 0.25, top - 0.08), 0);
        ring.rotation.set(0, 0, 0);
        this.setRing(0, LOOK.netR, ROJO);
        this.pulseFrom(0);
        this.ghostAt(p0);
        this.sweepCentre = (x + HALF_W) / COURT.width;
        this.sweep.setPath((u, out) => {
          const sx = -HALF_W + u * COURT.width;
          out.set(sx, netHeightAt(sx) + 0.015, 0);
        });
        this.sweep.u.uColor.value.copy(ROJO);
        this.sweep.u.uHalfWidth.value = 0.035;
        this.sweep.u.uSharp.value = this.sweep.length / 0.35;
        this.sweep.u.uDash.value = 0;
        break;
      }
      case "out": {
        const ring = this.rings[0]!;
        if (p0.y > 0.6) {
          // Over the cage: the ring stands in the wall's plane where the ball crossed it.
          const back = nearestWallIsBack(p0.x, p0.z);
          ring.position.set(
            back ? p0.x : Math.sign(p0.x) * HALF_W,
            p0.y,
            back ? Math.sign(p0.z) * HALF_L : p0.z,
          );
          faceWall(ring, p0.x, p0.z);
        } else {
          ring.position.set(p0.x, LOOK.turfY, p0.z);
          ring.rotation.set(-Math.PI / 2, 0, 0);
        }
        this.setRing(0, LOOK.exitR, ROJO);
        if (p0.y > 0.6) {
          // Under the ring, inside the court: above the cage top it would leave the frame.
          const back = nearestWallIsBack(p0.x, p0.z);
          SCRATCH.copy(ring.position);
          if (back) SCRATCH.z -= Math.sign(p0.z) * LOOK.wallOffset;
          else SCRATCH.x -= Math.sign(p0.x) * LOOK.wallOffset;
          this.chipAt(SCRATCH, ring.position.y - LOOK.exitR - LOOK.chipH / 2 - 0.15, "OUT");
        } else {
          this.chipAt(ring.position, ring.position.y + LOOK.chipAbove, "OUT");
        }
        if (p1) {
          this.ringFlat(1, p1, LOOK.lastBounceR, WHITE_GLOW);
          const from = ring.position;
          this.ribbon.setPath((u, out) => {
            out.set(from.x + (p1.x - from.x) * u, from.y + (LOOK.turfY - from.y) * u, from.z + (p1.z - from.z) * u);
          });
          this.styleRibbon(0.02, WHITE_GLOW, 0.32);
        }
        break;
      }
      case "wall": {
        const back = nearestWallIsBack(p0.x, p0.z);
        const wx = back ? p0.x : Math.sign(p0.x) * (HALF_W - LOOK.wallOffset);
        const wz = back ? Math.sign(p0.z) * (HALF_L - LOOK.wallOffset) : p0.z;
        this.impact.position.set(wx, p0.y, wz);
        this.impactBase.copy(this.impact.position);
        faceWall(this.impact, p0.x, p0.z);
        // The rattle shakes along the panel.
        this.impactAlong.set(back ? 1 : 0, 0, back ? 0 : 1);
        this.rattle = fx.surface === "mesh";
        const tex = this.rattle ? this.rattleTex : this.starTex;
        if (this.impact.material.map !== tex) this.impact.material.map = tex;
        this.impact.scale.set(
          this.rattle ? LOOK.rattleW : LOOK.starSize,
          this.rattle ? LOOK.rattleH : LOOK.starSize,
          1,
        );
        this.ghostAt(p0);
        break;
      }
      case "player":
        this.ringFlat(0, p0, LOOK.playerR, ROJO);
        this.pulseFrom(0);
        if (faultChip(fx)) {
          // Beside the ring at waist height, toward the middle: the name tag owns the space overhead.
          SCRATCH.copy(this.rings[0]!.position);
          SCRATCH.x += (p0.x > 0 ? -1 : 1) * (LOOK.playerR + LOOK.chipW / 2 + 0.1);
          this.chipAt(SCRATCH, LOOK.chipBesidePlayerY, faultChip(fx)!);
        }
        break;
    }
    if (fx.box) {
      const b = fx.box;
      const cx = (b.xMin + b.xMax) / 2;
      const cz = (b.side * (b.zNear + b.zFar)) / 2;
      this.boxFrame.position.set(cx, LOOK.turfY + 0.002, cz);
      this.boxFill.position.set(cx, LOOK.turfY - 0.004, cz);
    }
  }

  private setRing(i: number, r: number, color: THREE.Color): void {
    this.ringR[i] = r;
    this.rings[i]!.material.color.copy(color);
    if (i < 2) this.discs[i]!.material.color.copy(color);
  }

  private ringFlat(i: number, p: Vec3, r: number, color: THREE.Color): void {
    const ring = this.rings[i]!;
    ring.position.set(p.x, LOOK.turfY, p.z);
    ring.rotation.set(-Math.PI / 2, 0, 0);
    this.setRing(i, r, color);
  }

  /** The pulse ring takes ring i's place, size and colour. */
  private pulseFrom(i: number): void {
    const pulse = this.rings[2]!;
    const src = this.rings[i]!;
    pulse.position.copy(src.position);
    pulse.rotation.copy(src.rotation);
    pulse.material.color.copy(ROJO);
    this.ringR[2] = this.ringR[i]!;
  }

  private ghostAt(p: Vec3): void {
    this.ghost.position.set(p.x, p.y, p.z);
  }

  private chipAt(at: THREE.Vector3, y: number, text: string): void {
    this.chip.position.set(at.x, y, at.z);
    this.chipY = y;
    if (text !== this.chipText) {
      this.chipText = text;
      if (this.chipCtx) {
        drawChip(this.chipCtx, text);
        if (this.chip.material.map) this.chip.material.map.needsUpdate = true;
      }
    }
  }

  /** A dashed parabola from bounce 1 to bounce 2, its height growing with their distance. */
  private arcPath(a: Vec3, b: Vec3): void {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const h = THREE.MathUtils.clamp(0.22 * d, 0.3, 1.4);
    this.ribbon.setPath((u, out) => {
      out.set(a.x + (b.x - a.x) * u, LOOK.turfY + 4 * h * u * (1 - u), a.z + (b.z - a.z) * u);
    });
    this.styleRibbon(0.03, WHITE_GLOW, 0.22);
  }

  private styleRibbon(halfWidth: number, color: THREE.Color, dashM: number): void {
    const u = this.ribbon.u;
    u.uHalfWidth.value = halfWidth;
    u.uColor.value.copy(color);
    u.uDash.value = this.ribbon.length / dashM;
    u.uSharp.value = this.ribbon.length / 0.12;
    u.uHeadB.value = -10;
  }

  private apply(action: FaultAction, i: number, since: number): void {
    const a = faultAlpha(since, this.t, this.end, this.fadeMs);
    switch (action) {
      case "ring": {
        const ring = this.rings[i]!;
        ring.visible = a > 0;
        if (!ring.visible) return;
        const grow = this.reduced ? 1 : LOOK.ringFrom + (1 - LOOK.ringFrom) * easeOutExpo(since / LOOK.ringGrowMs);
        ring.scale.setScalar(this.ringR[i]! * grow);
        ring.material.opacity = a;
        if (i < 2) this.discs[i]!.material.opacity = a * LOOK.discOpacity;
        return;
      }
      case "pulse": {
        const pulse = this.rings[2]!;
        const x = since / LOOK.pulseMs;
        pulse.visible = !this.reduced && a > 0 && x < 1;
        if (!pulse.visible) return;
        pulse.scale.setScalar(this.ringR[2]! * (1 + LOOK.pulseGrow * easeOutCubic(x)));
        pulse.material.opacity = a * (1 - x) * (1 - x) * 0.9;
        return;
      }
      case "label": {
        const s = this.labels[i]!;
        s.visible = a > 0;
        if (!s.visible) return;
        s.material.opacity = a;
        // Settles down onto its mark.
        const lift = this.reduced ? 0 : 0.12 * (1 - easeOutExpo(since / 400));
        s.position.y = this.labelY[i]! + lift;
        return;
      }
      case "arc":
      case "line": {
        const r = this.ribbon;
        r.mesh.visible = a > 0;
        if (!r.mesh.visible) return;
        const drawn = this.reduced ? 1 : easeInOutCubic(clamp01(since / LOOK.arcDrawMs));
        r.u.uFrom.value = 0;
        r.u.uTo.value = drawn;
        r.u.uHeadA.value = drawn;
        r.u.uHot.value = drawn < 1 ? 0.9 : 0.9 * (1 - clamp01((since - LOOK.arcDrawMs) / 300));
        r.u.uOpacity.value = a * (action === "line" ? 0.5 : 0.9);
        return;
      }
      case "sweep": {
        const r = this.sweep;
        r.mesh.visible = a > 0;
        if (!r.mesh.visible) return;
        const s = this.reduced ? 1 : easeOutCubic(clamp01(since / LOOK.sweepMs));
        const c = this.sweepCentre;
        r.u.uFrom.value = c - s;
        r.u.uTo.value = c + s;
        r.u.uHeadA.value = c - s;
        r.u.uHeadB.value = c + s;
        r.u.uHot.value = this.reduced ? 0 : 1.4 * (1 - s);
        // The tape glows, then settles to a dimmer red until the fade.
        r.u.uOpacity.value = a * (0.95 - 0.35 * s);
        return;
      }
      case "chip": {
        const s = this.chip;
        s.visible = a > 0;
        if (!s.visible) return;
        s.material.opacity = a;
        const e = easeOutExpo(since / 400);
        const k = this.reduced ? 1 : 0.92 + 0.08 * e;
        s.scale.set(LOOK.chipW * k, LOOK.chipH * k, 1);
        s.position.y = this.chipY - (this.reduced ? 0 : 0.12 * (1 - e));
        return;
      }
      case "ghost": {
        // Hangs at the contact, then fades well before the rest.
        const hang = since < LOOK.ghostHoldMs ? 1 : fadeCurve((since - LOOK.ghostHoldMs) / LOOK.ghostFadeMs);
        const g = a * hang;
        this.ghost.visible = g > 0.001;
        if (!this.ghost.visible) return;
        this.ghost.material.opacity = 0.8 * g;
        this.ghostGlow.material.opacity = 0.55 * g;
        return;
      }
      case "impact": {
        const m = this.impact;
        m.visible = a > 0;
        if (!m.visible) return;
        if (this.rattle) {
          const shake = this.reduced ? 0 : LOOK.rattleAmp * Math.sin(since * 0.07) * Math.exp(-since / LOOK.rattleDecayMs);
          m.position.copy(this.impactBase).addScaledVector(this.impactAlong, shake);
          m.material.opacity = a * (0.8 + 0.2 * Math.exp(-since / 250));
        } else {
          const grow = this.reduced ? 1 : 0.3 + 0.7 * easeOutExpo(since / LOOK.impactGrowMs);
          m.scale.set(LOOK.starSize * grow, LOOK.starSize * grow, 1);
          m.material.opacity = a;
        }
        return;
      }
      case "box": {
        this.boxFrame.visible = this.boxFill.visible = a > 0;
        if (a <= 0) return;
        const flash =
          this.reduced || since >= LOOK.boxFlashMs
            ? 1
            : 0.5 + 0.5 * Math.cos((2 * Math.PI * since) / LOOK.boxFlashPeriodMs);
        this.boxFrame.material.opacity = a * (0.35 + 0.65 * flash);
        this.boxFill.material.opacity = a * (0.04 + 0.1 * flash);
        return;
      }
    }
  }
}
