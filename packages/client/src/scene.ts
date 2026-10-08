/**
 * Three.js rendering of the padel court. Builds static geometry from the
 * server-provided CourtConfig and exposes setters for the dynamic entities
 * (ball, players) that the network layer updates each frame.
 *
 * The court (`world/court.ts`) and the night arena around it (`world/arena.ts`)
 * are procedural; this class owns the renderer, camera and dynamic entities.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
  BALL,
  INTERP_DELAY_MS,
  type ContactEvent,
  type CourtConfig,
  type FaultHighlight,
  type ShotEvent,
  type ShotKind,
  type Slot,
  type Team,
  type Vec2,
} from "@padel/shared";
import { Arena } from "./world/arena.js";
import { broadcastCamPose, CameraRig, cutawaySide, stepFrameShift } from "./world/cameras.js";
import { AvatarFactory, glbModelSource, type Avatar } from "./world/avatar.js";
import type { BoardState } from "./world/boards.js";
import { buildCourt as buildCourtMeshes, type EndWalls } from "./world/court.js";
import { FaultFxPlayer, type FaultFx } from "./world/faultfx.js";
import { Feedback } from "./world/feedback.js";
import { PALETTE } from "./world/palette.js";
import { QualityMonitor, type Quality } from "./world/quality.js";
import { SelfMarker } from "./world/selfmarker.js";

const BLOOM = { strength: 0.55, radius: 0.4, threshold: 0.92 } as const;
const MAX_PIXEL_RATIO = { high: 1.75, low: 1 } as const;

export class PadelScene {
  readonly scene = new THREE.Scene();
  /** Hit feedback: Timing arcs, ball trail, impact flashes, ground marker, Smash shake. */
  private feedback = new Feedback(this.scene, "high");
  /** Fault animations: what lost the point, drawn where it happened. */
  private faultFx = new FaultFxPlayer(this.scene);
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private ball: THREE.Mesh;
  private avatars = new AvatarFactory(glbModelSource);
  private players = new Map<Slot, Avatar>();
  private names = new Map<Slot, string>();
  /** Duration of the frame being built, for avatar speed (set before the frame callback). */
  private frameDt = 1 / 60;
  private court: CourtConfig | null = null;
  /** Sideways picture shift, a fraction of the width, easing toward its target (setFrameShift). */
  private frameShift = 0;
  private frameShiftTarget = 0;
  private rig: CameraRig;
  private endWalls: EndWalls | null = null;
  private camTeam: Team = "A";
  private camPlayer: { x: number; z: number } | null = null;
  private camBall: { x: number; z: number } | null = null;
  private camSide: -1 | 1 = -1;
  private camMode: "player" | "broadcast" = "broadcast";
  /** An Instant replay is on screen: the Broadcast cam, whatever the seat. */
  private replaying = false;
  /** The local player's ring and chevron (Player cam only). */
  private selfMarker = new SelfMarker();
  private selfSlot: Slot | null = null;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private arena: Arena;
  private lastRender = performance.now();
  private quality: Quality = "high";
  /** Picks the quality from real frame times; null once a level is forced. */
  private monitor: QualityMonitor | null = new QualityMonitor("high");
  /** Bloom post-processing, present on "high" only. */
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO.high));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // The composer issues several render() calls per frame: count them all, reset per frame.
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    // Reflections for the glass (and later the players) come from a neutral room.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    // Keep the room's fill subtle: the night arena must stay dark.
    this.scene.environmentIntensity = 0.3;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 300);
    const start = broadcastCamPose(null);
    this.camera.position.copy(start.pos);
    this.camera.lookAt(start.look);
    this.rig = new CameraRig(this.camera);

    this.arena = new Arena(this.scene, "high");

    // The only optic-yellow object; a faint self-glow keeps it readable against the night.
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 24, 18),
      new THREE.MeshStandardMaterial({
        color: PALETTE.ball,
        emissive: PALETTE.ball,
        emissiveIntensity: 0.35,
        roughness: 0.5,
      }),
    );
    this.ball.castShadow = true;
    this.ball.position.set(0, 1, 0);
    this.scene.add(this.ball);
    this.scene.add(this.selfMarker.root);

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reduced) {
      this.faultFx.setReducedMotion(reduced.matches);
      reduced.addEventListener("change", (e) => this.faultFx.setReducedMotion(e.matches));
    }

    this.applyQuality("high");
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  /** A hidden tab stalls the frame loop: start a fresh quality window once it is visible again. */
  private onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") this.monitor?.resetWindow(performance.now());
  };

  /** Pin the quality level and stop the automatic fallback (dev `?quality=` param). */
  forceQuality(q: Quality): void {
    this.monitor = null;
    this.applyQuality(q);
  }

  /**
   * The one place quality changes land. "high": bloom through an EffectComposer and a
   * pixel ratio up to 1.75. "low": direct rendering at pixel ratio 1, a 1024 shadow map
   * and a thinner crowd.
   */
  private applyQuality(q: Quality): void {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO[q]));
    this.arena.setQuality(q);
    this.feedback.setQuality(q);
    if (q === "high" && !this.composer) {
      // A multisampled HDR target keeps the antialiasing that the default framebuffer had.
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      const composer = new EffectComposer(this.renderer, target);
      composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
      composer.addPass(this.bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
    } else if (q === "low" && this.composer) {
      for (const pass of this.composer.passes) pass.dispose();
      this.composer.dispose();
      this.composer = null;
      this.bloom = null;
    }
    this.onResize();
  }

  buildCourt(court: CourtConfig): void {
    // The court is static and a Welcome arrives on every (re)connect: build once.
    if (this.court) return;
    this.court = court;
    this.endWalls = buildCourtMeshes(this.scene, court, "high").endWalls;
  }

  /** Update the LED boards (redraws only when their messages change). */
  setBoards(s: BoardState): void {
    this.arena.setBoards(s);
  }

  /** Make the crowd cheer; `intensity` is 0..1. */
  cheer(intensity: number): void {
    this.arena.cheer(intensity);
  }

  /** Lazily create and return the avatar for a slot. */
  private avatar(slot: Slot): Avatar {
    let a = this.players.get(slot);
    if (a) return a;
    const team: Team = slot.startsWith("A") ? "A" : "B";
    a = this.avatars.create(slot, team);
    a.setName(this.names.get(slot) ?? "");
    this.scene.add(a.root);
    this.players.set(slot, a);
    return a;
  }

  /** Nickname printed on the back of a slot's shirt. */
  setPlayerName(slot: Slot, name: string): void {
    this.names.set(slot, name);
    this.players.get(slot)?.setName(name);
  }

  /** Every avatar of `team` celebrates (a won point or game). */
  celebrate(team: Team): void {
    for (const [slot, a] of this.players) if (slot.startsWith(team)) a.celebrate();
  }

  /** Tell each avatar whether the ball is in the half it stands in (ready vs idle stance). */
  setBallSide(ballZ: number): void {
    for (const a of this.players.values()) a.setBallSide(Math.sign(ballZ) === Math.sign(a.root.position.z));
  }

  /** Render counters from the last frame (used by the shoot tool and quality checks). */
  stats(): { quality: Quality; calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return {
      quality: this.quality,
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
    };
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Project a world point to CSS pixel coords for HTML overlays (name labels). */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      visible: v.z < 1 && v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1,
    };
  }

  /**
   * World-space aim direction (XZ, unit) from the player toward the point on the
   * court under the mouse pointer. Falls back to facing the net if the ray
   * misses the ground or the pointer sits on the player.
   */
  aimFromPointer(ndcX: number, ndcY: number, px: number, pz: number): Vec2 {
    const fallback: Vec2 = { x: 0, z: this.camTeam === "A" ? 1 : -1 };
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return fallback;
    const dx = hit.x - px;
    const dz = hit.z - pz;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return fallback;
    return { x: dx / len, z: dz / len };
  }

  /** Start a racket swing animation for a slot's avatar: overhead for a Smash, else a Drive. */
  triggerSwing(slot: Slot, kind: ShotKind = "drive"): void {
    this.players.get(slot)?.swing(kind === "smash" ? "smash" : "drive");
  }

  /** Shots and ball contacts, played when the rendered ball reaches them. */
  onEvents(shots: readonly ShotEvent[], contacts: readonly ContactEvent[]): void {
    for (const e of shots) this.feedback.shot(e, this.players.get(e.slot)?.root.position ?? e.pos);
    for (const e of contacts) this.feedback.contact(e);
  }

  /** Clear the ball trail, the ground marker and any fault animation (a new Welcome: the old ball is gone). */
  resetFeedback(): void {
    this.feedback.reset();
    this.faultFx.stop();
  }

  /**
   * Animate what lost the point. It starts `delayMs` from now: the match update arrives about
   * INTERP_DELAY_MS before the rendered ball reaches the fault. A double hit is marked around
   * the offending player's avatar.
   */
  showFault(h: FaultHighlight, delayMs = INTERP_DELAY_MS): void {
    this.faultFx.play(this.faultFxFor(h), delayMs);
  }

  /** Dev only: play `h` at once and, with `freezeMs`, hold it that far in. */
  devFault(h: FaultHighlight, freezeMs: number | null): void {
    this.faultFx.freeze(freezeMs);
    this.faultFx.play(this.faultFxFor(h), 0);
  }

  private faultFxFor(h: FaultHighlight): FaultFx {
    let points = h.points ?? [];
    const avatar = h.kind === "player" && h.slot ? this.players.get(h.slot) : undefined;
    if (avatar) points = [{ x: avatar.root.position.x, y: 0, z: avatar.root.position.z }];
    const fx: FaultFx = { kind: h.kind, points };
    if (h.surface) fx.surface = h.surface;
    if (h.box) fx.box = h.box;
    return fx;
  }

  setSpectatorCamera(): void {
    this.camMode = "broadcast";
    this.rig.setMode("broadcast");
  }

  setPlayerCamera(team: Team): void {
    this.camTeam = team;
    this.camMode = "player";
    this.rig.setMode(this.replaying ? "broadcast" : this.camMode);
  }

  /**
   * Enter or leave an Instant replay: the Broadcast cam (the rig glides there and back) and no
   * own marker. The ball jumps between the live and recorded play, so the trail starts afresh.
   */
  setReplay(on: boolean): void {
    this.replaying = on;
    this.rig.setMode(on ? "broadcast" : this.camMode);
    this.feedback.reset();
    // The replay re-shows the rally: the live fault animation must not linger over it.
    this.faultFx.stop();
  }

  /** Mark the local player's avatar (null: nobody). Shown in the Player cam only, rallies included, never in a replay. */
  setSelfMarker(slot: Slot | null): void {
    this.selfSlot = slot;
    if (slot) this.selfMarker.setTeam(slot.startsWith("A") ? "A" : "B");
  }

  /** Stores the local player's position; the side comes from the player's z so it stays
   *  correct after an ends-swap. */
  focusCamera(x: number, _y: number, z: number): void {
    this.camPlayer = { x, z };
    this.camSide = z < 0 ? -1 : 1;
    this.rig.setTargets(this.camPlayer, this.camBall, this.camSide);
  }

  setBallTarget(x: number, z: number): void {
    this.camBall = { x, z };
    this.rig.setTargets(this.camPlayer, this.camBall, this.camSide);
  }

  setBall(x: number, y: number, z: number): void {
    this.ball.position.set(x, y, z);
    this.feedback.setBall(x, y, z);
  }

  setPlayer(slot: Slot, x: number, y: number, z: number, yaw: number): void {
    this.avatar(slot).setPose(x, y, z, yaw, this.frameDt);
  }

  removePlayer(slot: Slot): void {
    this.players.get(slot)?.dispose();
    this.players.delete(slot);
  }

  /**
   * Slides the picture left by a fraction of its width, so the court sits in the part of the
   * screen an overlay leaves open (the join screen's panel covers the right); 0 recentres it.
   * It eases there over ~250 ms (render), so opening or closing the overlay never snaps.
   */
  setFrameShift(fraction: number): void {
    this.frameShiftTarget = fraction;
  }

  private applyFrameShift(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    // Both update the projection matrix.
    if (this.frameShift !== 0) this.camera.setViewOffset(w, h, this.frameShift * w, 0, w, h);
    else this.camera.clearViewOffset();
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    // updateStyle=true: set the canvas CSS size to the window size while the
    // drawing buffer scales by devicePixelRatio. Without this, the canvas is
    // displayed at buffer size (2× on Retina) and only a corner is visible.
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyFrameShift();
    // The composer resizes its passes; UnrealBloomPass halves the buffer size itself,
    // so its first mip already runs at resolution / 2.
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  };

  render(): void {
    const now = performance.now();
    const frameMs = now - this.lastRender;
    const dt = frameMs / 1000;
    this.lastRender = now;
    if (this.monitor) {
      const q = this.monitor.sample(frameMs, now);
      if (q !== this.quality) this.applyQuality(q);
    }
    this.arena.update(dt);
    for (const a of this.players.values()) a.update(dt);
    const marked = this.camMode === "player" && !this.replaying && this.selfSlot ? this.players.get(this.selfSlot) : undefined;
    this.selfMarker.follow(marked?.root ?? null);
    this.faultFx.update(dt);
    this.rig.addShake(this.feedback.update(dt).shake);
    this.rig.update(dt);
    if (this.frameShift !== this.frameShiftTarget) {
      this.frameShift = stepFrameShift(this.frameShift, this.frameShiftTarget, dt);
      this.applyFrameShift();
    }
    this.endWalls?.update(cutawaySide(this.rig.cameraZ), dt);
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  start(frame: (dt: number) => void): void {
    let last = performance.now();
    this.renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      this.frameDt = dt;
      frame(dt);
      this.render();
    });
  }
}
