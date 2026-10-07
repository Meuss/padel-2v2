/**
 * The Pro Tour Broadcast arena around the court: night sky and ground, four
 * stands of dark tiers with an instanced crowd, floodlight rigs behind the stands, the
 * lighting rig, and the LED boards (a scrolling perimeter ribbon plus a club
 * board above each back wall).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { COURT } from "@padel/shared";
import { BOARD_H, BOARD_W, CLUB_NAME, boardMessages, drawBoard, type BoardState } from "./boards.js";
import { PALETTE } from "./palette.js";
import type { Quality } from "./quality.js";

const STAND_GAP = 3; // metres between the cage and the first tier
const TIERS = 6;
const TIER_RISE = 0.45;
const TIER_DEPTH = 0.8;
const TIER_BASE = 1.0; // the front tier stands just above the LED ribbon
const SEAT_PITCH = 0.7;
const EMPTY_SEATS = 0.15;
const LOW_CROWD = 0.4;
const RIBBON_H = 0.9;
const RIBBON_REPEAT_M = RIBBON_H * (BOARD_W / BOARD_H); // keep the canvas aspect
const RIBBON_SPEED = 1.4; // metres per second
/** Height of the floodlight heads: just over the back row, so they sit in the top edge of both camera views. */
const RIG_HEAD_Y = 4.6;
/** Lateral positions of the floodlight rigs behind each end stand. */
const RIG_X = [-11, -4, 4, 11];
const CHEER_SEC = 2;
const IDLE_STEP_SEC = 0.1; // idle breathing at 10 Hz
// Muted mid-low shirts: the crowd reads as a mass of people from the Player cam,
// still well below the bright court.
const CROWD_COLORS = ["#2b3a5c", "#3a4a6e", "#45474f", "#6a3236", "#565a63", "#33363d", "#2f4c80", "#6b5a3e"];
/** Lambert multiplier on every shirt: keeps the crowd back even under the key light. */
const CROWD_DIM = "#c8c8c8";
/** How high (m) the crowd jumps on a full-intensity cheer. */
const CHEER_JUMP_M = 0.42;
/** Emissive lift on the crowd at the peak of a full-intensity cheer (flashes, raised arms). */
const CHEER_GLOW = new THREE.Color("#3a3f4c");
const SHADOW_MAP = { high: 2048, low: 1024 } as const;

/** Small deterministic PRNG so the crowd layout is identical on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error("arena: geometry merge failed");
  for (const p of parts) p.dispose();
  return g;
}

/** A seated spectator: 6-sided torso plus an icosahedron head (44 triangles). */
function spectatorGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.21, 0.17, 0.6, 6).translate(0, 0.3, 0).toNonIndexed();
  const head = new THREE.IcosahedronGeometry(0.14, 0).translate(0, 0.78, 0);
  return merged([body, head]);
}

/** One side of the bowl, described by its outward axis and the cage line. */
interface Side {
  /** Outward unit normal in XZ (toward the stands). */
  out: THREE.Vector2;
  /** Distance from the court centre to the cage on this side. */
  cage: number;
  /** Half-length of the front tier along the side. */
  half: number;
  /** End stands grow with each tier to wrap the corners and close the bowl. */
  wraps: boolean;
}

/** Half-length of tier i along its side (measured at the tier's middle for seats). */
function tierHalf(side: Side, i: number, at: number): number {
  return side.wraps ? side.half + TIER_DEPTH * (i + at) : side.half;
}

export class Arena {
  private ribbonTex: THREE.CanvasTexture;
  private ribbonCtx: CanvasRenderingContext2D;
  private messagesKey = "";
  private crowd: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private baseY: Float32Array;
  private phase: Float32Array;
  private time = 0;
  private cheerAge = CHEER_SEC;
  private cheerLevel = 0;
  private idleAcc = 0;
  /** Seats kept at quality "low": the crowd's instances are ordered so these come first. */
  private lowCount = 0;
  private key!: THREE.DirectionalLight;

  constructor(scene: THREE.Scene, quality: Quality) {
    scene.background = new THREE.Color(PALETTE.sky);
    // Fog starts just past the stands so the ground and the far bowl melt into the night.
    scene.fog = new THREE.Fog(PALETTE.sky, 28, 90);

    // Matte and unshadowed, so the ground beyond the stands stays near-black under the key light.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2).translate(0, -0.05, 0),
      new THREE.MeshLambertMaterial({ color: PALETTE.ground }),
    );
    scene.add(ground);

    const halfW = COURT.width / 2;
    const halfL = COURT.length / 2;
    const sides: Side[] = [
      { out: new THREE.Vector2(0, -1), cage: halfL, half: halfW + STAND_GAP, wraps: true },
      { out: new THREE.Vector2(1, 0), cage: halfW, half: halfL + STAND_GAP, wraps: false },
      { out: new THREE.Vector2(0, 1), cage: halfL, half: halfW + STAND_GAP, wraps: true },
      { out: new THREE.Vector2(-1, 0), cage: halfW, half: halfL + STAND_GAP, wraps: false },
    ];

    this.addStands(scene, sides);
    const seats = this.layoutSeats(sides);
    this.baseY = new Float32Array(seats.length);
    this.phase = new Float32Array(seats.length);
    this.crowd = this.addCrowd(scene, seats);
    this.addFloodlights(scene, halfL + STAND_GAP + TIERS * TIER_DEPTH + 0.6);
    this.addLights(scene);
    this.setQuality(quality);

    const ribbonCanvas = document.createElement("canvas");
    ribbonCanvas.width = BOARD_W;
    ribbonCanvas.height = BOARD_H;
    this.ribbonCtx = ribbonCanvas.getContext("2d")!;
    this.ribbonTex = new THREE.CanvasTexture(ribbonCanvas);
    this.ribbonTex.colorSpace = THREE.SRGBColorSpace;
    this.ribbonTex.wrapS = THREE.RepeatWrapping;
    this.ribbonTex.anisotropy = quality === "high" ? 8 : 2;
    this.addRibbon(scene, sides);
    this.addEndBoards(scene, halfL);
    this.setBoards({ phase: "warmup", gamesA: 0, gamesB: 0, pointA: "0", pointB: "0", names: [], reaction: null });
  }

  /** Thin the crowd and shrink the key light's shadow map on "low"; restore both on "high". */
  setQuality(q: Quality): void {
    this.crowd.count = q === "high" ? this.baseY.length : this.lowCount;
    const size = SHADOW_MAP[q];
    const shadow = this.key.shadow;
    if (shadow.mapSize.x !== size) {
      shadow.mapSize.set(size, size);
      // The renderer reallocates the map at the new size on the next frame.
      shadow.map?.dispose();
      shadow.map = null;
    }
  }

  /** Update the ribbon text. Cheap: only redraws the canvas when the messages change. */
  setBoards(s: BoardState): void {
    const messages = boardMessages(s);
    const key = messages.join("\n");
    if (key === this.messagesKey) return;
    this.messagesKey = key;
    drawBoard(this.ribbonCtx, messages, 0);
    this.ribbonTex.needsUpdate = true;
  }

  /** Make the crowd jump for ~2 s; `intensity` is 0..1. */
  cheer(intensity: number): void {
    const k = Math.min(1, Math.max(0, intensity));
    const live = this.cheerAge < CHEER_SEC ? this.cheerLevel * (1 - this.cheerAge / CHEER_SEC) : 0;
    this.cheerLevel = Math.max(k, live);
    this.cheerAge = 0;
    for (let i = 0; i < this.phase.length; i++) this.phase[i] = Math.random() * Math.PI * 2;
  }

  /** Scroll the ribbon and animate the crowd. */
  update(dtSec: number): void {
    const dt = Math.min(dtSec, 0.1);
    this.time += dt;
    this.ribbonTex.offset.x = (this.ribbonTex.offset.x + (RIBBON_SPEED * dt) / RIBBON_REPEAT_M) % 1;

    const m = this.crowd.instanceMatrix;
    const arr = m.array as Float32Array;
    if (this.cheerAge < CHEER_SEC) {
      this.cheerAge += dt;
      const level = this.cheerLevel * Math.max(0, 1 - this.cheerAge / CHEER_SEC);
      const amp = CHEER_JUMP_M * level;
      for (let i = 0; i < this.crowd.count; i++) {
        arr[i * 16 + 13] = this.baseY[i]! + amp * Math.abs(Math.sin(this.time * 7 + this.phase[i]!));
      }
      m.needsUpdate = true;
      this.crowd.material.emissive.copy(CHEER_GLOW).multiplyScalar(level);
      return;
    }
    this.idleAcc += dt;
    if (this.idleAcc < IDLE_STEP_SEC) return;
    this.idleAcc = 0;
    for (let i = 0; i < this.crowd.count; i++) {
      arr[i * 16 + 13] = this.baseY[i]! + 0.015 * (0.5 + 0.5 * Math.sin(this.time * 1.7 + this.phase[i]!));
    }
    m.needsUpdate = true;
  }

  /** Tier i of a side: a box running along the side, stepping up and back. */
  private addStands(scene: THREE.Scene, sides: Side[]): void {
    const mat = new THREE.MeshLambertMaterial({ color: "#07090e" });
    for (const side of sides) {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < TIERS; i++) {
        const top = TIER_BASE + TIER_RISE * i;
        const dist = side.cage + STAND_GAP + TIER_DEPTH * (i + 0.5);
        const len = 2 * tierHalf(side, i, 1);
        const box = new THREE.BoxGeometry(len, top, TIER_DEPTH);
        if (side.out.x !== 0) box.rotateY(Math.PI / 2);
        parts.push(box.translate(side.out.x * dist, top / 2, side.out.y * dist));
      }
      scene.add(new THREE.Mesh(merged(parts), mat));
    }
  }

  /**
   * Every seat of the full ("high") crowd, ordered so the seats kept at "low" come
   * first: `setQuality` then only changes the instance count.
   */
  private layoutSeats(sides: Side[]): THREE.Vector3[] {
    const rand = mulberry32(0x5eed);
    const kept: THREE.Vector3[] = [];
    const dropped: THREE.Vector3[] = [];
    for (const side of sides) {
      const along = new THREE.Vector2(-side.out.y, side.out.x);
      for (let i = 0; i < TIERS; i++) {
        const dist = side.cage + STAND_GAP + TIER_DEPTH * (i + 0.45);
        const count = Math.floor((2 * tierHalf(side, i, 0.5)) / SEAT_PITCH);
        const start = -((count - 1) * SEAT_PITCH) / 2;
        for (let k = 0; k < count; k++) {
          if (rand() < EMPTY_SEATS) continue;
          const keepAtLow = rand() < LOW_CROWD;
          const a = start + k * SEAT_PITCH + (rand() - 0.5) * 0.12;
          (keepAtLow ? kept : dropped).push(
            new THREE.Vector3(
              side.out.x * dist + along.x * a,
              TIER_BASE + TIER_RISE * i,
              side.out.y * dist + along.y * a,
            ),
          );
        }
      }
    }
    this.lowCount = kept.length;
    return kept.concat(dropped);
  }

  private addCrowd(
    scene: THREE.Scene,
    seats: THREE.Vector3[],
  ): THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> {
    const rand = mulberry32(0xc0ffee);
    const mesh = new THREE.InstancedMesh(
      spectatorGeometry(),
      new THREE.MeshLambertMaterial({ color: CROWD_DIM }),
      seats.length,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    seats.forEach((p, i) => {
      const s = 0.9 + rand() * 0.22;
      m.makeScale(s, s, s).setPosition(p);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(CROWD_COLORS[Math.floor(rand() * CROWD_COLORS.length)]!));
      this.baseY[i] = p.y;
      this.phase[i] = rand() * Math.PI * 2;
    });
    // The bobbing crowd stays inside the stands, so skip per-frame culling maths.
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }

  /**
   * Floodlight banks on short masts behind each end stand. Each head is a steel
   * box carrying 2×4 bright panels aimed at the court centre. Both cameras sit
   * behind an end, so the far end's banks show along the top edge of the frame,
   * where the bloom makes them glow.
   */
  private addFloodlights(scene: THREE.Scene, z: number): void {
    const rigs: [number, number][] = [];
    for (const sz of [-1, 1]) for (const x of RIG_X) rigs.push([x, sz * z]);
    const steel: THREE.BufferGeometry[] = [];
    const panels: THREE.BufferGeometry[] = [];
    const aim = new THREE.Object3D();
    for (const [px, pz] of rigs) {
      steel.push(new THREE.CylinderGeometry(0.1, 0.16, RIG_HEAD_Y, 6).translate(px, RIG_HEAD_Y / 2, pz));
      aim.position.set(px, RIG_HEAD_Y + 0.5, pz);
      aim.lookAt(0, 0, 0);
      aim.updateMatrix();
      steel.push(new THREE.BoxGeometry(2.6, 1.5, 0.3).translate(0, 0, -0.2).applyMatrix4(aim.matrix));
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 4; c++) {
          panels.push(
            new THREE.PlaneGeometry(0.56, 0.6)
              .translate(-0.93 + c * 0.62, -0.33 + r * 0.66, -0.04)
              .applyMatrix4(aim.matrix),
          );
        }
      }
    }
    scene.add(
      new THREE.Mesh(
        merged(steel),
        new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.5, metalness: 0.6 }),
      ),
    );
    // Well above 1.0 (linear) so the bloom threshold catches the lamps and nothing on the court.
    const lamp = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
    lamp.color.setRGB(1.25, 1.25, 1.18);
    scene.add(new THREE.Mesh(merged(panels), lamp));
  }

  private addLights(scene: THREE.Scene): void {
    const key = new THREE.DirectionalLight("#f2f6ff", 2.2);
    key.position.set(18, 26, 6);
    key.castShadow = true;
    const cam = key.shadow.camera;
    cam.left = cam.bottom = -12;
    cam.right = cam.top = 12;
    cam.near = 5;
    cam.far = 70;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    this.key = key;

    scene.add(new THREE.HemisphereLight("#9fb4ff", "#0b0f18", 0.55));

    for (const s of [-1, 1]) {
      const fill = new THREE.DirectionalLight("#f2f6ff", 0.6);
      fill.position.set(s * -16, 18, s * 24);
      scene.add(fill);
    }
  }

  /**
   * The LED ribbon at the foot of the stands: one inward-facing quad per side,
   * with U running continuously around the bowl so one texture tiles it all.
   */
  private addRibbon(scene: THREE.Scene, sides: Side[]): void {
    const pos: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    let u = 0;
    const y0 = 0.05;
    const y1 = y0 + RIBBON_H;
    for (const side of sides) {
      const dist = side.cage + STAND_GAP - 0.02;
      // Looking outward from the court, "right" is out × up.
      const right = new THREE.Vector2(-side.out.y, side.out.x);
      const cx = side.out.x * dist;
      const cz = side.out.y * dist;
      const ax = cx - right.x * side.half;
      const az = cz - right.y * side.half;
      const bx = cx + right.x * side.half;
      const bz = cz + right.y * side.half;
      const u1 = u + (2 * side.half) / RIBBON_REPEAT_M;
      const b = pos.length / 3;
      pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
      uv.push(u, 0, u1, 0, u1, 1, u, 1);
      index.push(b, b + 1, b + 2, b, b + 2, b + 3);
      u = u1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.ribbonTex, toneMapped: false })));
  }

  /**
   * A static club board behind each back glass, facing the court. It sits just
   * above the cage's top rail so neither the rail nor the fence cuts the text.
   */
  private addEndBoards(scene: THREE.Scene, halfL: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = BOARD_W / 2;
    canvas.height = BOARD_H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = PALETTE.ledBackground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = PALETTE.ledText;
    ctx.font = "700 76px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(CLUB_NAME, canvas.width / 2, canvas.height / 2 + 3);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    const w = 8;
    const h = w * (canvas.height / canvas.width);
    const parts: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      // A plane faces +Z; the far (−Z) board must face +Z, the near one −Z.
      const g = new THREE.PlaneGeometry(w, h);
      if (s > 0) g.rotateY(Math.PI);
      parts.push(g.translate(0, COURT.wallHeight + 0.15 + h / 2, s * (halfL + 0.6)));
    }
    scene.add(
      new THREE.Mesh(merged(parts), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
    );
  }
}
