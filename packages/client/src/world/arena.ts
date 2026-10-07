/**
 * The Pro Tour Broadcast arena around the court: night sky and ground, four
 * stands of dark tiers with an instanced crowd, corner floodlight towers, the
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
const TOWER_H = 14;
const CHEER_SEC = 2;
const IDLE_STEP_SEC = 0.1; // idle breathing at 10 Hz
// Muted, dark shirts so the crowd reads as a mass behind the bright court.
const CROWD_COLORS = ["#141c33", "#1e3157", "#33373f", "#5c2226", "#5d626c", "#24272e", "#2a3f68"];

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
  private crowd: THREE.InstancedMesh;
  private baseY: Float32Array;
  private phase: Float32Array;
  private time = 0;
  private cheerAge = CHEER_SEC;
  private cheerLevel = 0;
  private idleAcc = 0;

  constructor(scene: THREE.Scene, quality: Quality) {
    scene.background = new THREE.Color(PALETTE.sky);
    scene.fog = new THREE.Fog(PALETTE.sky, 40, 110);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2).translate(0, -0.05, 0),
      new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 }),
    );
    ground.receiveShadow = true;
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
    const seats = this.layoutSeats(sides, quality);
    this.baseY = new Float32Array(seats.length);
    this.phase = new Float32Array(seats.length);
    this.crowd = this.addCrowd(scene, seats);
    this.addFloodlights(scene, halfW + STAND_GAP + TIERS * TIER_DEPTH + 1, halfL + STAND_GAP + TIERS * TIER_DEPTH + 1);
    this.addLights(scene, quality);

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
      const amp = 0.25 * this.cheerLevel * Math.max(0, 1 - this.cheerAge / CHEER_SEC);
      for (let i = 0; i < this.baseY.length; i++) {
        arr[i * 16 + 13] = this.baseY[i]! + amp * Math.abs(Math.sin(this.time * 7 + this.phase[i]!));
      }
      m.needsUpdate = true;
      return;
    }
    this.idleAcc += dt;
    if (this.idleAcc < IDLE_STEP_SEC) return;
    this.idleAcc = 0;
    for (let i = 0; i < this.baseY.length; i++) {
      arr[i * 16 + 13] = this.baseY[i]! + 0.015 * (0.5 + 0.5 * Math.sin(this.time * 1.7 + this.phase[i]!));
    }
    m.needsUpdate = true;
  }

  /** Tier i of a side: a box running along the side, stepping up and back. */
  private addStands(scene: THREE.Scene, sides: Side[]): void {
    const mat = new THREE.MeshStandardMaterial({ color: "#10141d", roughness: 0.9 });
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
      const mesh = new THREE.Mesh(merged(parts), mat);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  private layoutSeats(sides: Side[], quality: Quality): THREE.Vector3[] {
    const rand = mulberry32(0x5eed);
    const seats: THREE.Vector3[] = [];
    for (const side of sides) {
      const along = new THREE.Vector2(-side.out.y, side.out.x);
      for (let i = 0; i < TIERS; i++) {
        const dist = side.cage + STAND_GAP + TIER_DEPTH * (i + 0.45);
        const count = Math.floor((2 * tierHalf(side, i, 0.5)) / SEAT_PITCH);
        const start = -((count - 1) * SEAT_PITCH) / 2;
        for (let k = 0; k < count; k++) {
          const empty = rand() < EMPTY_SEATS;
          const keep = quality === "high" || rand() < LOW_CROWD;
          if (empty || !keep) continue;
          const a = start + k * SEAT_PITCH + (rand() - 0.5) * 0.12;
          seats.push(
            new THREE.Vector3(
              side.out.x * dist + along.x * a,
              TIER_BASE + TIER_RISE * i,
              side.out.y * dist + along.y * a,
            ),
          );
        }
      }
    }
    return seats;
  }

  private addCrowd(scene: THREE.Scene, seats: THREE.Vector3[]): THREE.InstancedMesh {
    const rand = mulberry32(0xc0ffee);
    const mesh = new THREE.InstancedMesh(
      spectatorGeometry(),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
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

  /** Four corner towers: steel pole plus a head of 2×4 white panels aimed at the court. */
  private addFloodlights(scene: THREE.Scene, x: number, z: number): void {
    const steel: THREE.BufferGeometry[] = [];
    const panels: THREE.BufferGeometry[] = [];
    const aim = new THREE.Object3D();
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = sx * x;
        const pz = sz * z;
        steel.push(new THREE.CylinderGeometry(0.14, 0.22, TOWER_H, 8).translate(px, TOWER_H / 2, pz));
        aim.position.set(px, TOWER_H + 0.6, pz);
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
    }
    scene.add(
      new THREE.Mesh(
        merged(steel),
        new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.5, metalness: 0.6 }),
      ),
    );
    scene.add(
      new THREE.Mesh(merged(panels), new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false })),
    );
  }

  private addLights(scene: THREE.Scene, quality: Quality): void {
    const key = new THREE.DirectionalLight("#f2f6ff", 2.2);
    key.position.set(18, 26, 6);
    key.castShadow = true;
    const size = quality === "high" ? 2048 : 1024;
    key.shadow.mapSize.set(size, size);
    const cam = key.shadow.camera;
    cam.left = cam.bottom = -12;
    cam.right = cam.top = 12;
    cam.near = 5;
    cam.far = 70;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);

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
