/**
 * Hit feedback: the Timing arc under the hitter, the ball trail, the impact flash,
 * contact puffs and glass ripples, the ground marker under the ball and the Smash
 * camera shake.
 *
 * Every mesh is built once and pooled; the per-frame paths (`setBall`, `update`)
 * write into existing buffers and allocate nothing.
 */
import * as THREE from "three";
import { COURT, type ContactEvent, type ShotEvent, type ShotKind, type Timing } from "@padel/shared";
import { PALETTE } from "./palette.js";
import type { Quality } from "./quality.js";

const ARC = {
  inner: 0.7,
  outer: 0.85,
  spanDeg: 140,
  fadeS: 0.6,
  /** Height above the turf, with a polygon offset on top, so it wins over the lines. */
  y: 0.02,
  /** One per player is enough; a fifth shot reuses the oldest. */
  pool: 4,
  /** How much the arc grows while it fades. */
  grow: 0.12,
} as const;

const LABEL = {
  /** World size of the label sprite (m). */
  w: 1.2,
  h: 0.4,
  /** Label centre: just past the arc's outer edge, a little above the ground. */
  ahead: 1.05,
  y: 0.32,
  font: "800 60px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
} as const;

const TIMING_TEXT: Record<Timing, string> = { perfect: "PERFECT", early: "EARLY", late: "LATE" };

const TRAIL = {
  points: 14,
  fadeS: 0.35,
  smashFadeS: 0.5,
  /** After a Smash the trail is brighter and longer for this long. */
  smashBoostS: 0.4,
  /** Half-width (m) at the ball; it tapers to zero at the tail. */
  halfWidth: 0.05,
  smashHalfWidth: 0.075,
  intensity: 0.9,
  smashIntensity: 1.6,
  /** A jump longer than this between frames is a teleport (new serve, held ball): restart the trail. */
  teleportM: 2.5,
} as const;

const FLASH = { durS: 0.12, fromM: 0.25, toM: 0.9, smashToM: 1.4, pool: 4, color: "#fff6c8" } as const;
const PUFF = { durS: 0.45, fromM: 0.15, toM: 0.7, opacity: 0.45, y: 0.08, pool: 4, color: "#c9d3e6" } as const;
const RIPPLE = {
  durS: 0.5,
  inner: 0.1,
  outer: 0.16,
  growTo: 4,
  opacity: 0.7,
  /** Drawn this far in front of the glass. */
  offsetM: 0.03,
  pool: 3,
  color: "#cfe6ff",
} as const;
const MARKER = { baseM: 0.2, perMetreM: 0.12, opacity: 0.5, fadePerMetre: 0.5, y: 0.015 } as const;
const SHAKE = { amplitude: 0.06, decayS: 0.25 } as const;

/** Colour of the Timing arc and its label. Pure. */
export function timingArcColor(t: Timing): string {
  return t === "perfect" ? PALETTE.timingPerfect : t === "early" ? PALETTE.timingEarly : PALETTE.timingLate;
}

/** Opacity of a trail point `ageS` old: 1 → 0 over 0.35 s (0.5 s after a Smash). Pure. */
export function trailOpacity(ageS: number, kind: ShotKind): number {
  const life = kind === "smash" ? TRAIL.smashFadeS : TRAIL.fadeS;
  return Math.min(1, Math.max(0, 1 - ageS / life));
}

/** Canvas helpers return null where there is no DOM (tests). */
function makeCanvas(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext("2d");
}

function canvasTexture(ctx: CanvasRenderingContext2D): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft white disc fading to transparent at the rim. */
function softDiscTexture(): THREE.CanvasTexture | null {
  const ctx = makeCanvas(64, 64);
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return canvasTexture(ctx);
}

function labelTexture(t: Timing): THREE.CanvasTexture | null {
  const ctx = makeCanvas(256, 84);
  if (!ctx) return null;
  ctx.font = LABEL.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(5,7,13,0.85)";
  ctx.strokeText(TIMING_TEXT[t], 128, 44);
  ctx.fillStyle = timingArcColor(t);
  ctx.fillText(TIMING_TEXT[t], 128, 44);
  return canvasTexture(ctx);
}

/** A fixed set of objects reused round-robin; each lives for `dur` seconds once spawned. */
class Pool<T extends THREE.Object3D> {
  private ages: number[];
  private durs: number[];
  private next = 0;

  constructor(readonly items: T[]) {
    this.ages = items.map(() => Infinity);
    this.durs = items.map(() => 1);
    for (const it of items) it.visible = false;
  }

  /** Index of the slot to use for a new burst (the oldest one). */
  spawn(durS: number): number {
    const i = this.next;
    this.next = (this.next + 1) % this.items.length;
    this.ages[i] = 0;
    this.durs[i] = durS;
    this.items[i]!.visible = true;
    return i;
  }

  /** Age every live item and call `apply(i, t)` with t in [0, 1); items past their life are hidden. */
  update(dtSec: number, apply: (i: number, t: number) => void): void {
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i]!.visible) continue;
      const age = this.ages[i]! + dtSec;
      this.ages[i] = age;
      const t = age / this.durs[i]!;
      if (t >= 1) this.items[i]!.visible = false;
      else apply(i, t);
    }
  }
}

const TRAIL_VERTEX = /* glsl */ `
attribute vec3 aDir;
attribute float aSide;
attribute float aTaper;
attribute float aAlpha;
uniform float uHalfWidth;
varying float vAlpha;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // Widen across the direction of travel, facing the camera.
  vec3 across = cross(aDir, cameraPosition - world.xyz);
  float len = length(across);
  if (len > 1e-6) world.xyz += across / len * aSide * uHalfWidth * aTaper;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const TRAIL_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor * vAlpha, vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Tapered, camera-facing ribbon through the last TRAIL.points ball positions. */
class Trail {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Sample 0 is always the ball; 1.. are older samples, newest first. */
  private pts = new Float32Array(TRAIL.points * 3);
  private stamps = new Float64Array(TRAIL.points);
  private pos: THREE.BufferAttribute;
  private dir: THREE.BufferAttribute;
  private alpha: THREE.BufferAttribute;
  private started = false;

  constructor() {
    const n = TRAIL.points;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.dir = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.alpha = new THREE.BufferAttribute(new Float32Array(n * 2), 1);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.dir.setUsage(THREE.DynamicDrawUsage);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    const side = new Float32Array(n * 2);
    const taper = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
      taper[i * 2] = taper[i * 2 + 1] = 1 - i / (n - 1);
    }
    const index: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setAttribute("position", this.pos);
    g.setAttribute("aDir", this.dir);
    g.setAttribute("aAlpha", this.alpha);
    g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    g.setAttribute("aTaper", new THREE.BufferAttribute(taper, 1));
    g.setIndex(index);
    const material = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERTEX,
      fragmentShader: TRAIL_FRAGMENT,
      uniforms: {
        uColor: { value: new THREE.Color(PALETTE.ball) },
        uHalfWidth: { value: TRAIL.halfWidth },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = "ball-trail";
    // The vertices move every frame; the bounding sphere would always be stale.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Record the ball at `now`; older samples are kept every `fadeS / (points - 1)` seconds. */
  sample(x: number, y: number, z: number, now: number, fadeS: number): void {
    const p = this.pts;
    const jump = Math.hypot(x - p[0]!, y - p[1]!, z - p[2]!);
    if (!this.started || jump > TRAIL.teleportM) {
      for (let i = 0; i < TRAIL.points; i++) {
        p[i * 3] = x;
        p[i * 3 + 1] = y;
        p[i * 3 + 2] = z;
        this.stamps[i] = now;
      }
      this.started = true;
      this.mesh.visible = true;
      return;
    }
    if (now - this.stamps[1]! >= fadeS / (TRAIL.points - 1)) {
      p.copyWithin(6, 3, (TRAIL.points - 1) * 3);
      this.stamps.copyWithin(2, 1, TRAIL.points - 1);
      p[3] = x;
      p[4] = y;
      p[5] = z;
      this.stamps[1] = now;
    }
    p[0] = x;
    p[1] = y;
    p[2] = z;
    this.stamps[0] = now;
  }

  /** Rebuild the ribbon's vertices for `now`. */
  update(now: number, kind: ShotKind, intensity: number, halfWidth: number): void {
    if (!this.started) return;
    const n = TRAIL.points;
    const p = this.pts;
    const pos = this.pos.array as Float32Array;
    const dir = this.dir.array as Float32Array;
    const alpha = this.alpha.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const prev = Math.max(0, i - 1) * 3;
      const next = Math.min(n - 1, i + 1) * 3;
      const dx = p[prev]! - p[next]!;
      const dy = p[prev + 1]! - p[next + 1]!;
      const dz = p[prev + 2]! - p[next + 2]!;
      const a = trailOpacity(now - this.stamps[i]!, kind) * intensity;
      for (let s = 0; s < 2; s++) {
        const v = i * 2 + s;
        pos[v * 3] = p[i * 3]!;
        pos[v * 3 + 1] = p[i * 3 + 1]!;
        pos[v * 3 + 2] = p[i * 3 + 2]!;
        dir[v * 3] = dx;
        dir[v * 3 + 1] = dy;
        dir[v * 3 + 2] = dz;
        alpha[v] = a;
      }
    }
    this.pos.needsUpdate = true;
    this.dir.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.mesh.material.uniforms.uHalfWidth!.value = halfWidth;
  }
}

export class Feedback {
  private time = 0;
  private shakeAge = Infinity;
  private smashUntil = -Infinity;
  private out = { shake: 0 };

  private trail = new Trail();
  private marker: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private arcs: Pool<THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>;
  private labels: Pool<THREE.Sprite>;
  private labelTextures: Record<Timing, THREE.CanvasTexture | null>;
  private flashes: Pool<THREE.Sprite>;
  /** Final size of each flash (a Smash flashes bigger). */
  private flashTo: number[];
  private puffs: Pool<THREE.Sprite>;
  private ripples: Pool<THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>;

  /** Every effect is cheap enough for both levels (the ground marker in particular stays on "low"). */
  constructor(scene: THREE.Scene, _quality: Quality) {
    const disc = softDiscTexture();

    scene.add(this.trail.mesh);

    this.marker = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        map: disc,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    this.marker.name = "ball-marker";
    this.marker.visible = false;
    scene.add(this.marker);

    // Flat on the ground, the arc centred on local +z (turned toward the net per shot).
    const arcGeo = new THREE.RingGeometry(
      ARC.inner,
      ARC.outer,
      24,
      1,
      (-ARC.spanDeg / 2) * THREE.MathUtils.DEG2RAD,
      ARC.spanDeg * THREE.MathUtils.DEG2RAD,
    )
      .rotateX(-Math.PI / 2)
      .rotateY(-Math.PI / 2);
    this.arcs = new Pool(
      Array.from({ length: ARC.pool }, () => {
        const m = new THREE.Mesh(
          arcGeo,
          new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
          }),
        );
        m.name = "timing-arc";
        return m;
      }),
    );

    this.labelTextures = { perfect: labelTexture("perfect"), early: labelTexture("early"), late: labelTexture("late") };
    this.labels = new Pool(
      Array.from({ length: ARC.pool }, () => {
        const s = new THREE.Sprite(
          new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
        );
        s.name = "timing-label";
        s.scale.set(LABEL.w, LABEL.h, 1);
        return s;
      }),
    );

    this.flashes = new Pool(
      Array.from({ length: FLASH.pool }, () => {
        const s = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: disc,
            color: FLASH.color,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        s.name = "impact-flash";
        return s;
      }),
    );
    this.flashTo = this.flashes.items.map(() => FLASH.toM);

    this.puffs = new Pool(
      Array.from({ length: PUFF.pool }, () => {
        const s = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: disc, color: PUFF.color, transparent: true, depthWrite: false }),
        );
        s.name = "dust-puff";
        return s;
      }),
    );

    const rippleGeo = new THREE.RingGeometry(RIPPLE.inner, RIPPLE.outer, 32);
    this.ripples = new Pool(
      Array.from({ length: RIPPLE.pool }, () => {
        const m = new THREE.Mesh(
          rippleGeo,
          new THREE.MeshBasicMaterial({
            color: RIPPLE.color,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          }),
        );
        m.name = "glass-ripple";
        return m;
      }),
    );

    for (const pool of [this.arcs, this.labels, this.flashes, this.puffs, this.ripples]) {
      for (const it of pool.items) scene.add(it);
    }
  }

  /** A shot: impact flash at the ball, Timing arc under the hitter, and for a Smash a brighter trail and a camera shake. */
  shot(e: ShotEvent, hitterPos: { x: number; z: number }): void {
    // Toward the net from the hitter's half.
    const facing = hitterPos.z < 0 ? 1 : -1;

    const a = this.arcs.spawn(ARC.fadeS);
    const arc = this.arcs.items[a]!;
    arc.position.set(hitterPos.x, ARC.y, hitterPos.z);
    arc.rotation.y = facing > 0 ? 0 : Math.PI;
    arc.material.color.set(timingArcColor(e.timing));

    const l = this.labels.spawn(ARC.fadeS);
    const label = this.labels.items[l]!;
    label.position.set(hitterPos.x, LABEL.y, hitterPos.z + facing * LABEL.ahead);
    const tex = this.labelTextures[e.timing];
    if (label.material.map !== tex) {
      label.material.map = tex;
      label.material.needsUpdate = true;
    }

    const f = this.flashes.spawn(FLASH.durS);
    this.flashes.items[f]!.position.set(e.pos.x, e.pos.y, e.pos.z);
    this.flashTo[f] = e.kind === "smash" ? FLASH.smashToM : FLASH.toM;

    if (e.kind === "smash") {
      this.smashUntil = this.time + TRAIL.smashBoostS;
      this.shakeAge = 0;
    }
  }

  /** The ball touching a surface: a dust puff on the floor, a ripple on the glass. */
  contact(e: ContactEvent): void {
    if (e.surface === "floor") {
      const i = this.puffs.spawn(PUFF.durS);
      this.puffs.items[i]!.position.set(e.pos.x, PUFF.y, e.pos.z);
    } else if (e.surface === "glass") {
      const i = this.ripples.spawn(RIPPLE.durS);
      const r = this.ripples.items[i]!;
      // Back glass if the ball is nearer the end wall than the side wall.
      const toBack = COURT.length / 2 - Math.abs(e.pos.z);
      const toSide = COURT.width / 2 - Math.abs(e.pos.x);
      if (toBack <= toSide) {
        r.rotation.set(0, 0, 0);
        r.position.set(e.pos.x, e.pos.y, Math.sign(e.pos.z) * (COURT.length / 2 - RIPPLE.offsetM));
      } else {
        r.rotation.set(0, Math.PI / 2, 0);
        r.position.set(Math.sign(e.pos.x) * (COURT.width / 2 - RIPPLE.offsetM), e.pos.y, e.pos.z);
      }
    }
  }

  /** The rendered ball position this frame: feeds the trail and the ground marker. */
  setBall(x: number, y: number, z: number): void {
    const smash = this.time < this.smashUntil;
    this.trail.sample(x, y, z, this.time, smash ? TRAIL.smashFadeS : TRAIL.fadeS);
    const h = Math.max(0, y);
    this.marker.visible = true;
    this.marker.position.set(x, MARKER.y, z);
    this.marker.scale.setScalar(MARKER.baseM + MARKER.perMetreM * h);
    this.marker.material.opacity = MARKER.opacity / (1 + MARKER.fadePerMetre * h);
  }

  /** Advance every effect; returns the camera shake amplitude (m) for this frame. */
  update(dtSec: number): { shake: number } {
    this.time += dtSec;

    const smash = this.time < this.smashUntil;
    this.trail.update(
      this.time,
      smash ? "smash" : "drive",
      smash ? TRAIL.smashIntensity : TRAIL.intensity,
      smash ? TRAIL.smashHalfWidth : TRAIL.halfWidth,
    );

    this.arcs.update(dtSec, this.fadeArc);
    this.labels.update(dtSec, this.fadeLabel);
    this.flashes.update(dtSec, this.burstFlash);
    this.puffs.update(dtSec, this.growPuff);
    this.ripples.update(dtSec, this.spreadRipple);

    this.shakeAge += dtSec;
    this.out.shake = this.shakeAge < SHAKE.decayS ? SHAKE.amplitude * (1 - this.shakeAge / SHAKE.decayS) : 0;
    return this.out;
  }

  /** Nothing changes with quality yet; kept so quality changes reach every world module. */
  setQuality(_q: Quality): void {}

  // Pool callbacks, bound once so `update` allocates nothing.
  private fadeArc = (i: number, t: number): void => {
    const arc = this.arcs.items[i]!;
    arc.material.opacity = 1 - t;
    arc.scale.setScalar(1 + ARC.grow * t);
  };

  private fadeLabel = (i: number, t: number): void => {
    this.labels.items[i]!.material.opacity = 1 - t * t;
  };

  private burstFlash = (i: number, t: number): void => {
    const s = this.flashes.items[i]!;
    s.scale.setScalar(FLASH.fromM + (this.flashTo[i]! - FLASH.fromM) * t);
    s.material.opacity = 1 - t;
  };

  private growPuff = (i: number, t: number): void => {
    const s = this.puffs.items[i]!;
    s.scale.setScalar(PUFF.fromM + (PUFF.toM - PUFF.fromM) * t);
    s.material.opacity = PUFF.opacity * (1 - t);
  };

  private spreadRipple = (i: number, t: number): void => {
    const r = this.ripples.items[i]!;
    r.scale.setScalar(1 + (RIPPLE.growTo - 1) * t);
    r.material.opacity = RIPPLE.opacity * (1 - t);
  };
}
