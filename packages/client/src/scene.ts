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
  PLAYER,
  type CourtConfig,
  type FaultHighlight,
  type Slot,
  type Team,
  type Vec2,
} from "@padel/shared";
import { Arena } from "./world/arena.js";
import type { BoardState } from "./world/boards.js";
import { buildCourt as buildCourtMeshes } from "./world/court.js";

const TEAM_COLOR: Record<Team, number> = { A: 0x3b82f6, B: 0xef4444 };

export class PadelScene {
  readonly scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private ball: THREE.Mesh;
  private players = new Map<Slot, THREE.Group>();
  private court: CourtConfig | null = null;
  private cameraMode: "spectator" | "player" = "spectator";
  private camTeam: Team = "A";
  private camPos = new THREE.Vector3(0, 16, 24);
  private camLook = new THREE.Vector3(0, 1, 0);
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private swingStart = new Map<Slot, number>();
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

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

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
    buildCourtMeshes(this.scene, court, "high");
  }

  /** Update the LED boards (redraws only when their messages change). */
  setBoards(s: BoardState): void {
    this.arena.setBoards(s);
  }

  /** Make the crowd cheer; `intensity` is 0..1. */
  cheer(intensity: number): void {
    this.arena.cheer(intensity);
  }

  /** Lazily create and return the avatar group for a slot. */
  private avatar(slot: Slot): THREE.Group {
    let g = this.players.get(slot);
    if (g) return g;
    g = new THREE.Group();
    const group = g;
    const team: Team = slot.startsWith("A") ? "A" : "B";
    const color = TEAM_COLOR[team];

    // Stylized low-poly player: skin head/arms/legs, team-coloured jersey + cap,
    // white shorts and shoes. (Replaces the old capsule.)
    const skin = new THREE.MeshStandardMaterial({ color: 0xf2c9a0, roughness: 0.85 });
    const jersey = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const white = new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 0.7 });
    const part = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      group.add(m);
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
    part(
      new THREE.SphereGeometry(0.185, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      jersey,
      0,
      1.71,
      0,
    ); // cap dome
    part(new THREE.BoxGeometry(0.34, 0.04, 0.16), jersey, 0, 1.69, 0.16); // cap brim

    // Racket: a real padel paddle — short grip, throat, and a solid perforated
    // teardrop face with an accent rim. Built in `racketModel`, then held out at
    // the hand inside `racket` (which the swing animation rotates).
    const racket = new THREE.Group();
    const racketModel = new THREE.Group();
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x15171c,
      roughness: 0.85,
    });

    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.024, 0.15, 12),
      gripMat,
    );
    racketModel.add(grip);
    const butt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.02, 12),
      gripMat,
    );
    butt.position.y = -0.085;
    racketModel.add(butt);

    const accent = team === "A" ? 0x1e3a8a : 0x7f1d1d;
    const throat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.02, 0.07, 12),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 }),
    );
    throat.position.y = 0.11;
    racketModel.add(throat);

    // Solid teardrop padel face: an extruded, beveled bat with real through-holes
    // (a teardrop outline + a grid of circular holes), not a flat round paddle.
    const faceY = 0.3;
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
    const faceGeo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.01,
      bevelSegments: 1,
      curveSegments: 10,
    });
    faceGeo.translate(0, 0, -depth / 2);
    const face = new THREE.Mesh(
      faceGeo,
      new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.45 }),
    );
    face.position.set(0, faceY, 0);
    face.castShadow = true;
    racketModel.add(face);

    // Hold the paddle at the right hand, face toward the hitting direction.
    racketModel.position.set(0.46, PLAYER.height * 0.5, 0.12);
    racketModel.rotation.set(-0.15, 0, -0.45);
    racketModel.castShadow = true;
    racket.add(racketModel);
    g.add(racket);
    g.userData.racket = racket;

    this.scene.add(g);
    this.players.set(slot, g);
    return g;
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
    this.swingStart.set(slot, performance.now());
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
      const g = this.players.get(h.slot);
      if (g) pos = { x: g.position.x, y: 0, z: g.position.z };
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

  private updateSwings(now: number): void {
    const DURATION = 320;
    const AMP = 1.7;
    for (const [slot, group] of this.players) {
      const racket = group.userData.racket as THREE.Group | undefined;
      if (!racket) continue;
      const start = this.swingStart.get(slot);
      if (start === undefined) continue;
      const p = (now - start) / DURATION;
      if (p >= 1) {
        racket.rotation.set(0, 0, 0);
        this.swingStart.delete(slot);
        continue;
      }
      // Sweep the racket across the front (+AMP → −AMP) with a forward dip.
      racket.rotation.y = AMP * Math.cos(p * Math.PI);
      racket.rotation.x = -0.5 * Math.sin(p * Math.PI);
    }
  }

  setSpectatorCamera(): void {
    this.cameraMode = "spectator";
    this.camPos.set(0, 16, 24);
    this.camLook.set(0, 1, 0);
  }

  setPlayerCamera(team: Team): void {
    this.cameraMode = "player";
    this.camTeam = team;
  }

  /** In player mode, place the camera behind the player (away from the net),
   *  looking toward the net. Derived from the player's z-side so it stays correct
   *  after an ends-swap. */
  focusCamera(x: number, _y: number, z: number): void {
    if (this.cameraMode !== "player") return;
    const s = z < 0 ? -1 : 1; // which end the player is on
    this.camPos.set(x * 0.5, 6.5, z + s * 10);
    this.camLook.set(x * 0.35, 1.4, z - s * 6);
  }

  setBall(x: number, y: number, z: number): void {
    this.ball.position.set(x, y, z);
  }

  setPlayer(slot: Slot, x: number, y: number, z: number, yaw: number): void {
    const g = this.avatar(slot);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
  }

  removePlayer(slot: Slot): void {
    const g = this.players.get(slot);
    if (g) {
      this.scene.remove(g);
      this.players.delete(slot);
    }
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
    this.updateSwings(now);
    this.updateMarkers(now);
    // Smoothly ease the camera toward its target pose.
    this.camera.position.lerp(this.camPos, 0.12);
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
  }

  start(frame: (dt: number) => void): void {
    let last = performance.now();
    this.renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      frame(dt);
      this.render();
    });
  }
}
