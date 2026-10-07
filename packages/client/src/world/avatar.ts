/**
 * Player avatars: the CC0 mannequin (`public/models/player.glb`) in Azul/Rojo
 * kits, holding a padel racket, with a nickname on the shirt back and an
 * animation mixer driven by ground speed, swings and celebrations.
 *
 * The model loads asynchronously. Until it arrives (or if it never does), each
 * avatar shows the procedural V1 player, then swaps in the mannequin in place.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { PLAYER, type Slot, type Team } from "@padel/shared";
import { PALETTE } from "./palette.js";

export type Locomotion = "idle" | "ready" | "jog" | "sprint";

/** Ground speed (m/s) where standing turns into a jog. */
const JOG_SPEED = 0.35;
/** Ground speed (m/s) where a jog turns into a sprint. */
const SPRINT_SPEED = 4.2;
/** A threshold must be passed by this much (m/s) to leave the current clip, so noise can't flicker it. */
const LOCO_HYSTERESIS = 0.1;

/**
 * Pick the locomotion clip from ground speed (m/s), whether the ball is on our side,
 * and the clip playing now (hysteresis: ±0.1 m/s around each threshold). Pure.
 */
export function pickLocomotion(speed: number, ballOnOurSide: boolean, prev: Locomotion): Locomotion {
  // Each threshold sits 0.1 m/s lower when we are already above it, higher when below.
  const moving = prev === "jog" || prev === "sprint";
  const sprintAt = prev === "sprint" ? SPRINT_SPEED - LOCO_HYSTERESIS : SPRINT_SPEED + LOCO_HYSTERESIS;
  const jogAt = moving ? JOG_SPEED - LOCO_HYSTERESIS : JOG_SPEED + LOCO_HYSTERESIS;
  if (speed >= sprintAt) return "sprint";
  if (speed >= jogAt) return "jog";
  return ballOnOurSide ? "ready" : "idle";
}

/** Nickname as printed on the shirt: uppercase, at most 10 characters including the ellipsis. Pure. */
export function shirtName(name: string): string {
  const n = name.trim().toUpperCase();
  return n.length > 10 ? `${n.slice(0, 9)}…` : n;
}

export interface ModelSource {
  load(): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>;
}

let glbPromise: Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> | null = null;

/** The shipped mannequin, fetched once per page (a failed fetch is retried on the next call). */
export const glbModelSource: ModelSource = {
  load() {
    glbPromise ??= new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}models/player.glb`)
      .then((g) => ({ scene: g.scene, animations: g.animations }))
      .catch((e: unknown) => {
        glbPromise = null;
        throw e;
      });
    return glbPromise;
  },
};

const KIT: Record<Team, string> = { A: PALETTE.azul, B: PALETTE.rojo };
const LOCO_CLIP: Record<Locomotion, string> = {
  idle: "Idle_Loop",
  ready: "Crouch_Idle_Loop",
  jog: "Jog_Fwd_Loop",
  sprint: "Sprint_Loop",
};
const SWING_CLIP = { drive: "Sword_Attack", smash: "Punch_Cross" } as const;
const DANCE_CLIP = "Dance_Loop";

const CROSSFADE_S = 0.18;
/** A jump further than this (m) between two poses is a teleport (ends swap, reconnect), not a run. */
const TELEPORT_M = 2;
const SWING_S = 0.42;
const SWING_FADE_IN_S = 0.05;
const SWING_FADE_OUT_S = 0.12;
/** The swing layer outweighs locomotion on the upper body (≈85 %) while the legs keep running. */
const SWING_WEIGHT = 6;
const CELEBRATE_S = 2.5;
/** Bones a swing must not touch, so the legs keep their locomotion. */
const LOWER_BODY = /hips|thigh|shin|foot|toe|^root$/i;

/**
 * Racket pose in the `DEF-hand.R` bone's frame. The rotation was solved from the
 * hand's pose in `Idle_Loop` so that, at rest, the shaft points up (slightly
 * forward and out) and the face looks straight ahead; then checked by screenshot.
 */
const RACKET_IN_HAND = {
  pos: new THREE.Vector3(0, 0.07, 0.02),
  rot: new THREE.Quaternion(-0.014, -0.385, -0.909, 0.16).normalize(),
};
/** Shirt nickname in the `DEF-spine.003` frame (bone +Z faces the chest side): on the back, facing away. */
const DECAL_IN_SPINE = { pos: new THREE.Vector3(0, 0.02, -0.15), w: 0.32, h: 0.12 };

/** Find a bone by its glTF name; three's loader strips the dots (`DEF-hand.R` → `DEF-handR`). */
function findBone(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  const sanitized = THREE.PropertyBinding.sanitizeNodeName(name);
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!found && (o.name === name || o.name === sanitized)) found = o;
  });
  return found;
}

// ── Racket (shared geometry and per-team materials) ─────────────────────────

let racketGeo: { handle: THREE.BufferGeometry; throat: THREE.BufferGeometry; face: THREE.BufferGeometry } | null =
  null;
const racketMats = new Map<Team, { grip: THREE.Material; accent: THREE.Material; face: THREE.Material }>();

function racketGeometry(): NonNullable<typeof racketGeo> {
  if (racketGeo) return racketGeo;
  const grip = new THREE.CylinderGeometry(0.02, 0.024, 0.15, 12);
  const butt = new THREE.CylinderGeometry(0.028, 0.028, 0.02, 12).translate(0, -0.085, 0);
  // One mesh for grip + butt cap (same material).
  const handle = mergeSimple(grip, butt);
  const throat = new THREE.CylinderGeometry(0.032, 0.02, 0.07, 12).translate(0, 0.11, 0);

  // Solid teardrop padel face with real through-holes.
  const W = 0.135;
  const H = 0.16;
  const shape = new THREE.Shape();
  shape.moveTo(0, -H);
  shape.bezierCurveTo(W * 0.95, -H * 0.55, W, H * 0.25, W * 0.68, H * 0.72);
  shape.bezierCurveTo(W * 0.4, H, -W * 0.4, H, -W * 0.68, H * 0.72);
  shape.bezierCurveTo(-W, H * 0.25, -W * 0.95, -H * 0.55, 0, -H);
  for (let gy = -0.07; gy <= 0.11; gy += 0.036) {
    const row = Math.round((gy + 0.07) / 0.036);
    const offx = (row % 2) * 0.018;
    for (let gx = -0.09 + offx; gx <= 0.09; gx += 0.036) {
      if (Math.hypot(gx, gy - 0.015) < 0.1) {
        const hole = new THREE.Path();
        hole.absarc(gx, gy, 0.0115, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
    }
  }
  const depth = 0.04;
  const face = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 1,
    curveSegments: 10,
  }).translate(0, 0.3, -depth / 2);
  racketGeo = { handle, throat, face };
  return racketGeo;
}

/** Concatenate two non-indexed-compatible geometries (position/normal/uv) into one. */
function mergeSimple(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const ga = a.toNonIndexed();
  const gb = b.toNonIndexed();
  const out = new THREE.BufferGeometry();
  for (const key of ["position", "normal", "uv"]) {
    const x = ga.getAttribute(key) as THREE.BufferAttribute;
    const y = gb.getAttribute(key) as THREE.BufferAttribute;
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array, 0);
    arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(key, new THREE.BufferAttribute(arr, x.itemSize));
  }
  for (const g of [a, b, ga, gb]) g.dispose();
  return out;
}

/** A padel racket with its origin in the grip and the face up its +Y axis, face normal ±Z. */
export function makeRacket(team: Team): THREE.Group {
  const geo = racketGeometry();
  let mats = racketMats.get(team);
  if (!mats) {
    mats = {
      grip: new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.85 }),
      accent: new THREE.MeshStandardMaterial({ color: team === "A" ? 0x1e3a8a : 0x7f1d1d, roughness: 0.5 }),
      face: new THREE.MeshStandardMaterial({ color: KIT[team], metalness: 0.3, roughness: 0.45 }),
    };
    racketMats.set(team, mats);
  }
  const racket = new THREE.Group();
  racket.name = "racket";
  for (const [g, m] of [
    [geo.handle, mats.grip],
    [geo.throat, mats.accent],
    [geo.face, mats.face],
  ] as const) {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    racket.add(mesh);
  }
  return racket;
}

// ── Shirt nickname decal ─────────────────────────────────────────────────────

interface Decal {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

/** A transparent 256×96 canvas plane, or null where there is no DOM (tests). */
function makeDecal(): Decal | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(DECAL_IN_SPINE.w, DECAL_IN_SPINE.h),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  mesh.name = "shirt-name";
  mesh.position.copy(DECAL_IN_SPINE.pos);
  mesh.rotation.y = Math.PI; // face out of the back
  return { mesh, ctx, texture };
}

function drawDecal(d: Decal, name: string): void {
  const { ctx } = d;
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  const text = shirtName(name);
  if (text) {
    ctx.font = "800 64px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    const tw = ctx.measureText(text).width;
    const squeeze = Math.min(1, (w - 16) / Math.max(1, tw));
    ctx.save();
    ctx.translate(w / 2, h / 2 + 3);
    ctx.scale(squeeze, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  d.texture.needsUpdate = true;
}

// ── Procedural fallback (V1 player) ──────────────────────────────────────────

class FallbackBody {
  readonly group = new THREE.Group();
  private racketPivot = new THREE.Group();
  private swingLeft = 0;
  private jumpLeft = 0;
  private disposables: { dispose(): void }[] = [];

  constructor(team: Team) {
    const group = this.group;
    const skin = new THREE.MeshStandardMaterial({ color: 0xf2c9a0, roughness: 0.85 });
    const jersey = new THREE.MeshStandardMaterial({ color: KIT[team], roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 0.7 });
    this.disposables.push(skin, jersey, white);
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      group.add(m);
      this.disposables.push(geo);
      return m;
    };
    for (const sx of [-0.12, 0.12]) {
      part(new THREE.CylinderGeometry(0.085, 0.075, 0.72, 12), skin, sx, 0.46, 0); // leg
      part(new THREE.BoxGeometry(0.16, 0.09, 0.3), white, sx, 0.05, 0.05); // shoe
    }
    part(new THREE.BoxGeometry(0.44, 0.26, 0.3), white, 0, 0.86, 0); // shorts
    part(new THREE.CylinderGeometry(0.21, 0.27, 0.62, 16), jersey, 0, 1.2, 0); // torso
    part(new THREE.SphereGeometry(0.21, 14, 12), jersey, 0, 1.48, 0).scale.set(1, 0.5, 1); // shoulders
    part(new THREE.SphereGeometry(0.17, 18, 14), skin, 0, 1.66, 0); // head
    part(new THREE.SphereGeometry(0.185, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2), jersey, 0, 1.71, 0); // cap
    part(new THREE.BoxGeometry(0.34, 0.04, 0.16), jersey, 0, 1.69, 0.16); // cap brim

    // Paddle held out at the right hand; the pivot is what the swing rotates.
    const racket = makeRacket(team);
    racket.position.set(0.46, PLAYER.height * 0.5, 0.12);
    racket.rotation.set(-0.15, 0, -0.45);
    this.racketPivot.add(racket);
    group.add(this.racketPivot);
  }

  swing(): void {
    this.swingLeft = 0.32;
  }

  celebrate(): void {
    this.jumpLeft = 0.5;
  }

  update(dt: number): void {
    if (this.swingLeft > 0) {
      this.swingLeft = Math.max(0, this.swingLeft - dt);
      const p = 1 - this.swingLeft / 0.32;
      // Sweep the racket across the front (+1.7 → −1.7) with a forward dip.
      this.racketPivot.rotation.y = this.swingLeft > 0 ? 1.7 * Math.cos(p * Math.PI) : 0;
      this.racketPivot.rotation.x = this.swingLeft > 0 ? -0.5 * Math.sin(p * Math.PI) : 0;
    }
    if (this.jumpLeft > 0) {
      this.jumpLeft = Math.max(0, this.jumpLeft - dt);
      this.group.position.y = 0.35 * Math.sin((1 - this.jumpLeft / 0.5) * Math.PI);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}

// ── Model preparation (once per factory) ─────────────────────────────────────

interface PreparedModel {
  scene: THREE.Object3D;
  scale: number;
  clips: Map<string, THREE.AnimationClip>;
}

function prepare(model: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }): PreparedModel {
  model.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model.scene, true);
  const height = box.max.y - box.min.y;
  const scale = Number.isFinite(height) && height > 0.01 ? PLAYER.height / height : 1;
  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of model.animations) clips.set(clip.name, clip);
  // Swings are layered over locomotion: keep only the upper-body tracks.
  for (const name of Object.values(SWING_CLIP)) {
    const clip = clips.get(name);
    if (!clip) continue;
    const upper = clip.tracks.filter((t) => !LOWER_BODY.test(t.name.slice(0, t.name.lastIndexOf("."))));
    clips.set(name, new THREE.AnimationClip(name, clip.duration, upper));
  }
  return { scene: model.scene, scale, clips };
}

/** Wait after a failed model load before the one automatic retry. */
const RETRY_MS = 5000;

export class AvatarFactory {
  private model: PreparedModel | null = null;
  private loading = false;
  private retried = false;
  /** Live avatars still on the fallback body, upgraded together when the model arrives. */
  private waiting = new Set<Avatar>();

  constructor(private source: ModelSource) {}

  /** Returns immediately: a fallback avatar now, upgraded in place when the model resolves. Never throws. */
  create(slot: Slot, team: Team): Avatar {
    const avatar = new Avatar(slot, team, () => this.waiting.delete(avatar));
    if (this.model) {
      avatar.upgrade(this.model);
    } else {
      this.waiting.add(avatar);
      this.load();
    }
    return avatar;
  }

  /** Start a load unless one is running. On success every waiting avatar is upgraded. */
  private load(): void {
    if (this.loading || this.model) return;
    this.loading = true;
    let p: Promise<PreparedModel>;
    try {
      p = this.source.load().then(prepare);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (m) => {
        this.loading = false;
        this.model = m;
        for (const avatar of this.waiting) avatar.upgrade(m);
        this.waiting.clear();
      },
      (e: unknown) => {
        // Keep the fallback players. The next avatar created retries the load, and so
        // does one automatic retry a few seconds later (a Render cold start, a blip).
        this.loading = false;
        if (import.meta.env.MODE !== "test") console.warn("Player model unavailable, using fallback avatars", e);
        if (!this.retried) {
          this.retried = true;
          setTimeout(() => this.load(), RETRY_MS);
        }
      },
    );
  }
}

export class Avatar {
  readonly root = new THREE.Group();
  private fallback: FallbackBody | null;
  private body: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private clips = new Map<string, THREE.AnimationClip>();
  private kitMaterials: THREE.Material[] = [];
  private skeletons: THREE.Skeleton[] = [];
  private decal: Decal | null = null;
  private name = "";
  private disposed = false;

  private hasLast = false;
  private lastX = 0;
  private lastZ = 0;
  private speed = 0;
  private ballOnOurSide = false;
  private loco: Locomotion = "idle";
  /**
   * The full-body base layer (locomotion clips and the dance): exactly one target fades
   * up while every other running action fades down, each from its current weight. Three's
   * fadeIn/fadeOut restart from 0/1, which pops when a crossfade is interrupted.
   */
  private baseTarget: THREE.AnimationAction | null = null;
  private baseActions: THREE.AnimationAction[] = [];
  private swingAction: THREE.AnimationAction | null = null;
  private swingElapsed = 0;
  private danceAction: THREE.AnimationAction | null = null;
  private celebrateLeft = 0;

  constructor(
    readonly slot: Slot,
    private team: Team,
    /** Called once from `dispose` (the factory stops tracking the avatar). */
    private onDispose: () => void = () => {},
  ) {
    this.root.name = `player-${slot}`;
    this.fallback = new FallbackBody(team);
    this.root.add(this.fallback.group);
  }

  setPose(x: number, y: number, z: number, yaw: number, dtSec: number): void {
    const moved = this.hasLast ? Math.hypot(x - this.lastX, z - this.lastZ) : 0;
    if (moved > TELEPORT_M) {
      this.speed = 0; // a teleport (ends swap, reconnect) is not a jog
    } else if (this.hasLast && dtSec > 0) {
      // Smoothed, and clamped so a large frame gap is not a sprint.
      const inst = Math.min(10, moved / dtSec);
      this.speed += (inst - this.speed) * Math.min(1, dtSec * 12);
    }
    this.hasLast = true;
    this.lastX = x;
    this.lastZ = z;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
  }

  setBallSide(ballOnOurSide: boolean): void {
    this.ballOnOurSide = ballOnOurSide;
  }

  swing(kind: "drive" | "smash"): void {
    if (this.fallback) {
      this.fallback.swing();
      return;
    }
    const action = this.action(SWING_CLIP[kind]);
    if (!action) return;
    this.swingAction?.stop();
    const clip = action.getClip();
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    action.weight = SWING_WEIGHT;
    action.timeScale = clip.duration / SWING_S;
    action.fadeIn(SWING_FADE_IN_S).play();
    this.swingAction = action;
    this.swingElapsed = 0;
  }

  celebrate(): void {
    this.celebrateLeft = CELEBRATE_S;
    this.startDance();
  }

  /** Fade into the dance (mannequin) or hop (fallback); `celebrateLeft` says when to stop. */
  private startDance(): void {
    if (this.fallback) {
      this.fallback.celebrate();
      return;
    }
    const dance = this.action(DANCE_CLIP);
    if (!dance) return;
    this.danceAction = dance;
    this.setBase(dance);
  }

  setName(name: string): void {
    this.name = name;
    if (this.decal) drawDecal(this.decal, name);
  }

  update(dtSec: number): void {
    const wasCelebrating = this.celebrateLeft > 0;
    this.celebrateLeft = Math.max(0, this.celebrateLeft - dtSec);
    if (this.fallback) {
      this.fallback.update(dtSec);
      return;
    }
    if (!this.mixer) return;

    if (wasCelebrating && this.celebrateLeft === 0) this.danceAction = null;
    if (!this.danceAction) {
      // Pick the clip first, then fade it in: the dance hands over straight to it.
      this.loco = pickLocomotion(this.speed, this.ballOnOurSide, this.loco);
      const loco = this.action(LOCO_CLIP[this.loco]);
      this.setBase(loco);
      if (loco && this.loco === "jog") loco.timeScale = THREE.MathUtils.clamp(this.speed / 3.2, 0.8, 1.4);
    }
    this.blendBase(dtSec);

    if (this.swingAction) {
      const before = this.swingElapsed;
      this.swingElapsed += dtSec;
      const fadeAt = SWING_S - SWING_FADE_OUT_S;
      if (before < fadeAt && this.swingElapsed >= fadeAt) this.swingAction.fadeOut(SWING_FADE_OUT_S);
      if (this.swingElapsed >= SWING_S) {
        this.swingAction.stop();
        this.swingAction = null;
      }
    }
    this.mixer.update(dtSec);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onDispose();
    this.root.removeFromParent();
    this.fallback?.dispose();
    this.fallback = null;
    if (this.mixer && this.body) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.body);
    }
    this.mixer = null;
    this.baseActions.length = 0;
    this.baseTarget = null;
    for (const m of this.kitMaterials) m.dispose();
    for (const s of this.skeletons) s.dispose();
    if (this.decal) {
      this.decal.texture.dispose();
      this.decal.mesh.material.dispose();
      this.decal.mesh.geometry.dispose();
      this.decal = null;
    }
  }

  /** Swap the fallback for a clone of the loaded mannequin. Called by the factory. */
  upgrade(model: PreparedModel): void {
    if (this.disposed || this.body) return;
    const body = SkeletonUtils.clone(model.scene);
    body.scale.setScalar(model.scale);

    const cloned = new Map<THREE.Material, THREE.Material>();
    const kit = (m: THREE.Material): THREE.Material => {
      let c = cloned.get(m);
      if (!c) {
        c = m.clone();
        if (c instanceof THREE.MeshStandardMaterial) {
          if (m.name === "M_Main") {
            c.color.set(KIT[this.team]);
            c.roughness = 0.6;
          } else if (m.name === "M_Joints") {
            c.color.set(PALETTE.joints);
          }
        }
        cloned.set(m, c);
        this.kitMaterials.push(c);
      }
      return c;
    };
    body.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh)) return;
      o.material = Array.isArray(o.material) ? o.material.map(kit) : kit(o.material);
      o.castShadow = true;
      o.receiveShadow = false;
      this.skeletons.push(o.skeleton);
    });

    findBone(body, "DEF-hand.R")?.add(makeRacketInHand(this.team));
    const spine = findBone(body, "DEF-spine.003");
    this.decal = spine ? makeDecal() : null;
    if (this.decal) {
      spine!.add(this.decal.mesh);
      drawDecal(this.decal, this.name);
    }

    this.fallback?.dispose();
    this.fallback = null;
    this.body = body;
    this.clips = model.clips;
    this.mixer = new THREE.AnimationMixer(body);
    this.root.add(body);
    this.loco = pickLocomotion(this.speed, this.ballOnOurSide, this.loco);
    this.setBase(this.action(LOCO_CLIP[this.loco]));
    if (this.celebrateLeft > 0) this.startDance(); // finish a celebration begun on the fallback
  }

  private action(name: string): THREE.AnimationAction | null {
    const clip = this.clips.get(name);
    return clip && this.mixer ? this.mixer.clipAction(clip) : null;
  }

  /** Make `action` the base-layer target. One not already running starts from its first frame. */
  private setBase(action: THREE.AnimationAction | null): void {
    if (!action || action === this.baseTarget) return;
    if (!this.baseActions.includes(action)) {
      action.reset();
      action.timeScale = 1;
      // The first clip shows at once; later ones blend up from nothing.
      action.setEffectiveWeight(this.baseTarget ? 0 : 1);
      action.play();
      this.baseActions.push(action);
    }
    this.baseTarget = action;
  }

  /** Fade the base layer toward its target at a constant rate; the weights always sum to 1. */
  private blendBase(dtSec: number): void {
    const step = dtSec / CROSSFADE_S;
    let others = 0;
    // Backwards, so a stopped action can be spliced out without skipping the next one.
    for (let i = this.baseActions.length - 1; i >= 0; i--) {
      const action = this.baseActions[i]!;
      if (action === this.baseTarget) continue;
      const w = Math.max(0, action.weight - step);
      if (w === 0) {
        action.stop();
        this.baseActions.splice(i, 1);
      } else {
        action.setEffectiveWeight(w);
        others += w;
      }
    }
    this.baseTarget?.setEffectiveWeight(Math.min(1, Math.max(0, 1 - others)));
  }
}

function makeRacketInHand(team: Team): THREE.Group {
  const racket = makeRacket(team);
  racket.position.copy(RACKET_IN_HAND.pos);
  racket.quaternion.copy(RACKET_IN_HAND.rot);
  return racket;
}
