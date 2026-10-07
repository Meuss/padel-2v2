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
import {
  BALL,
  type CourtConfig,
  type FaultHighlight,
  type Slot,
  type Team,
  type Vec2,
} from "@padel/shared";
import { Arena } from "./world/arena.js";
import { broadcastCamPose, CameraRig, cutawaySide } from "./world/cameras.js";
import { AvatarFactory, glbModelSource, type Avatar } from "./world/avatar.js";
import type { BoardState } from "./world/boards.js";
import { buildCourt as buildCourtMeshes, type EndWalls } from "./world/court.js";

export class PadelScene {
  readonly scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private ball: THREE.Mesh;
  private avatars = new AvatarFactory(glbModelSource);
  private players = new Map<Slot, Avatar>();
  private names = new Map<Slot, string>();
  /** Duration of the frame being built, for avatar speed (set before the frame callback). */
  private frameDt = 1 / 60;
  private court: CourtConfig | null = null;
  private rig: CameraRig;
  private endWalls: EndWalls | null = null;
  private camTeam: Team = "A";
  private camPlayer: { x: number; z: number } | null = null;
  private camBall: { x: number; z: number } | null = null;
  private camSide: -1 | 1 = -1;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private arena: Arena;
  private lastRender = performance.now();
  private markers: { mesh: THREE.Mesh; born: number; ttl: number }[] = [];

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    // Reflections for the glass (and later the players) come from a neutral room.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    // Keep the room's fill subtle: the night arena must stay dark.
    this.scene.environmentIntensity = 0.3;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 300);
    const start = broadcastCamPose(null);
    this.camera.position.copy(start.pos);
    this.camera.lookAt(start.look);
    this.rig = new CameraRig(this.camera);

    this.arena = new Arena(this.scene, "high");

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 24, 18),
      new THREE.MeshStandardMaterial({
        color: 0xdcff4a,
        emissive: 0x3a4a00,
        emissiveIntensity: 0.4,
        roughness: 0.5,
      }),
    );
    this.ball.castShadow = true;
    this.ball.position.set(0, 1, 0);
    this.scene.add(this.ball);

    this.onResize();
    window.addEventListener("resize", this.onResize);
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
  stats(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
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

  /** Start a racket swing animation for a slot's avatar. */
  triggerSwing(slot: Slot): void {
    this.players.get(slot)?.swing("drive");
  }

  /** Flash a red highlight on whatever caused the lost point. */
  showFault(h: FaultHighlight): void {
    const now = performance.now();
    const red = () =>
      new THREE.MeshStandardMaterial({
        color: 0xff3030,
        emissive: 0xff2020,
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });
    const add = (mesh: THREE.Mesh) => {
      this.scene.add(mesh);
      this.markers.push({ mesh, born: now, ttl: 1900 });
    };
    const ringAt = (x: number, z: number) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 12, 32), red());
      r.rotation.x = -Math.PI / 2;
      r.position.set(x, 0.07, z);
      add(r);
    };

    let pos = h.pos;
    if (h.kind === "player" && h.slot) {
      const a = this.players.get(h.slot);
      if (a) pos = { x: a.root.position.x, y: 0, z: a.root.position.z };
    }

    if (h.kind === "ground" || h.kind === "out" || h.kind === "player") {
      if (pos) ringAt(pos.x, pos.z);
    } else if (h.kind === "wall" && pos) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), red());
      s.position.set(pos.x, Math.max(0.4, pos.y), pos.z);
      add(s);
      ringAt(pos.x, pos.z);
    } else if (h.kind === "net") {
      const w = this.court?.width ?? 10;
      const nh = this.court?.netHeight ?? 0.88;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, nh), red());
      p.position.set(0, nh / 2, 0);
      add(p);
    }
  }

  private updateMarkers(now: number): void {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i]!;
      const t = (now - m.born) / m.ttl;
      if (t >= 1) {
        this.scene.remove(m.mesh);
        m.mesh.geometry.dispose();
        (m.mesh.material as THREE.Material).dispose();
        this.markers.splice(i, 1);
        continue;
      }
      (m.mesh.material as THREE.MeshStandardMaterial).opacity = 0.9 * (1 - t);
      m.mesh.scale.setScalar(1 + t * 0.7);
    }
  }

  setSpectatorCamera(): void {
    this.rig.setMode("broadcast");
  }

  setPlayerCamera(team: Team): void {
    this.camTeam = team;
    this.rig.setMode("player");
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
  }

  setPlayer(slot: Slot, x: number, y: number, z: number, yaw: number): void {
    this.avatar(slot).setPose(x, y, z, yaw, this.frameDt);
  }

  removePlayer(slot: Slot): void {
    this.players.get(slot)?.dispose();
    this.players.delete(slot);
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    // updateStyle=true: set the canvas CSS size to the window size while the
    // drawing buffer scales by devicePixelRatio. Without this, the canvas is
    // displayed at buffer size (2× on Retina) and only a corner is visible.
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  render(): void {
    const now = performance.now();
    const dt = (now - this.lastRender) / 1000;
    this.lastRender = now;
    this.arena.update(dt);
    for (const a of this.players.values()) a.update(dt);
    this.updateMarkers(now);
    this.rig.update(dt);
    this.endWalls?.update(cutawaySide(this.rig.cameraZ), dt);
    this.renderer.render(this.scene, this.camera);
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
