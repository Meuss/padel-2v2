/**
 * The playing court: blue turf and its surround, painted lines, the regulation
 * cage (glass, mesh and black steel, laid out by the shared `CAGE` the server
 * also collides with), and the net. Static geometry is merged by material so
 * the whole court costs a handful of draw calls.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CAGE, CAGE_GATES, cageTopAt, sideX, type CourtConfig } from "@padel/shared";
import { PALETTE } from "./palette.js";
import type { Quality } from "./quality.js";

const LINE_W = 0.05;
const POST = 0.1;
const RAIL = 0.08;
/** Section of a gate's frame bars. */
const GATE_BAR = 0.05;
/** Metres per fence cell, and per (finer) net cell. */
const FENCE_CELL = 0.18;
const NET_CELL = 0.07;
/** Environment reflection strength on the glass (the scene's own is 0.3). */
const GLASS_REFLECTION = 1.0;

/** Return `geo` moved to (x, y, z) after rotating it by `rotY` about +Y. */
function placed(geo: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0): THREE.BufferGeometry {
  if (rotY !== 0) geo.rotateY(rotY);
  return geo.translate(x, y, z);
}

/** A ground-level strip (lines) lying flat at height y. */
function flatStrip(w: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, y, z);
}

/** A vertical panel whose UVs count cells, so one tiling texture fits any size. */
function cellPanel(w: number, h: number, cell: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / cell, (uv.getY(i) * h) / cell);
  return g;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error("court: geometry merge failed");
  for (const p of parts) p.dispose();
  return g;
}

/** Fine grayscale noise that breaks up the flat turf colour into artificial grass. */
function turfTexture(quality: Quality): THREE.CanvasTexture {
  const s = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(s, s);
  let seed = 0x2a5fc4;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < s * s; i++) {
    const v = 214 + Math.floor(rand() * 41);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 16);
  tex.anisotropy = quality === "high" ? 8 : 2;
  return tex;
}

/** One wire cell (white = wire, transparent = hole), read as an alpha map. */
function fenceTexture(): THREE.CanvasTexture {
  const s = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 7;
  ctx.strokeRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function buildCourt(
  scene: THREE.Scene,
  court: CourtConfig,
  quality: Quality,
): { root: THREE.Group; endWalls: EndWalls } {
  const root = new THREE.Group();
  root.name = "court";
  const halfW = court.width / 2;
  const halfL = court.length / 2;

  // ── Turf and surround ──
  const turf = new THREE.Mesh(
    new THREE.PlaneGeometry(court.width, court.length).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: PALETTE.turf, roughness: 0.95, map: turfTexture(quality) }),
  );
  turf.receiveShadow = true;
  root.add(turf);

  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(court.width + 6, court.length + 6).rotateX(-Math.PI / 2).translate(0, -0.02, 0),
    new THREE.MeshStandardMaterial({ color: PALETTE.surround, roughness: 0.95 }),
  );
  surround.receiveShadow = true;
  root.add(surround);

  // ── Lines (plus the net tape, same crisp white) ──
  const y = 0.012;
  const sv = Math.min(halfL - 0.2, 6.95); // service lines: 6.95 m from the net
  const lineParts = [
    flatStrip(court.width, LINE_W, 0, y, -halfL + LINE_W / 2),
    flatStrip(court.width, LINE_W, 0, y, halfL - LINE_W / 2),
    flatStrip(LINE_W, court.length, -halfW + LINE_W / 2, y, 0),
    flatStrip(LINE_W, court.length, halfW - LINE_W / 2, y, 0),
    flatStrip(court.width, LINE_W, 0, y, -sv),
    flatStrip(court.width, LINE_W, 0, y, sv),
    flatStrip(LINE_W, sv * 2, 0, y, 0),
    placed(new THREE.BoxGeometry(court.width, 0.06, 0.03), 0, court.netHeight, 0),
  ];
  // Scaled just under the bloom threshold so the floodlit lines stay crisp instead of glowing.
  const lineColor = new THREE.Color(PALETTE.lines).multiplyScalar(0.85);
  root.add(new THREE.Mesh(merged(lineParts), new THREE.MeshBasicMaterial({ color: lineColor })));

  // ── Cage, from the shared regulation layout (the same panels the server collides with) ──
  const glassParts: THREE.BufferGeometry[] = [];
  const fenceParts: THREE.BufferGeometry[] = [];
  const steelParts: THREE.BufferGeometry[] = [];
  // Each end's back wall (and the corner returns within 2 m of it) is collected apart so it
  // can be faded when the camera sits behind it.
  const endParts = [-1, 1].map(() => ({
    glass: [] as THREE.BufferGeometry[],
    fence: [] as THREE.BufferGeometry[],
    steel: [] as THREE.BufferGeometry[],
  }));
  const endOf = (z: number) => endParts[z < 0 ? 0 : 1]!;
  const inEnd = (z: number) => Math.abs(z) >= halfL - 2 - 1e-6;
  /** The parts list a piece at `z` goes to: its end's (faded with it) or the shared one. */
  const partsAt = (z: number, kind: "glass" | "fence" | "steel") =>
    inEnd(z) ? endOf(z)[kind] : kind === "glass" ? glassParts : kind === "fence" ? fenceParts : steelParts;
  const railGeo = (len: number, x: number, ry: number, z: number, alongZ: boolean) =>
    placed(new THREE.BoxGeometry(len, RAIL, RAIL), x, ry, z, alongZ ? Math.PI / 2 : 0);

  for (const seg of CAGE) {
    const h = seg.y1 - seg.y0;
    const midY = (seg.y0 + seg.y1) / 2;
    const back = seg.side === "back";
    const len = back ? seg.x1 - seg.x0 : seg.z1 - seg.z0;
    const x = back ? (seg.x0 + seg.x1) / 2 : sideX(seg.side);
    const z = back ? seg.end * halfL : (seg.z0 + seg.z1) / 2;
    const rotY = back ? 0 : Math.PI / 2;
    const panel =
      seg.material === "glass" ? new THREE.PlaneGeometry(len, h) : cellPanel(len, h, FENCE_CELL);
    partsAt(z, seg.material === "glass" ? "glass" : "fence").push(placed(panel, x, midY, z, rotY));
    // A rail along every panel's top: the glass/mesh seams and the stepped top of the cage.
    partsAt(z, "steel").push(railGeo(len, x, seg.y1, z, !back));
  }

  // Posts every 2 m and at every panel boundary, each as tall as the cage there.
  const postAt = (x: number, z: number) => {
    const h = cageTopAt(x, z);
    partsAt(z, "steel").push(placed(new THREE.BoxGeometry(POST, h, POST), x, h / 2, z));
  };
  const stops = (lo: number, hi: number, bounds: number[]) => {
    const all = new Set<number>(bounds);
    for (let v = lo; v <= hi + 1e-6; v += 2) all.add(Math.round(v * 1000) / 1000);
    return [...all];
  };
  const backBounds = CAGE.flatMap((s) => (s.side === "back" ? [s.x0, s.x1] : []));
  for (const x of stops(-halfW, halfW, backBounds)) {
    postAt(x, -halfL);
    postAt(x, halfL);
  }
  for (const side of ["left", "right"] as const) {
    const bounds = CAGE.flatMap((s) => (s.side === side ? [s.z0, s.z1] : []));
    // The corners already have their back-wall post.
    for (const z of stops(-halfL, halfL, bounds)) if (Math.abs(z) < halfL - 1e-6) postAt(sideX(side), z);
  }

  // The access gates: a steel frame on the central mesh, with a latch bar at hand height.
  for (const gate of CAGE_GATES) {
    const gx = sideX(gate.side) - Math.sign(sideX(gate.side)) * 0.03; // just inside the mesh
    const z0 = gate.z - gate.width / 2;
    const z1 = gate.z + gate.width / 2;
    for (const gz of [z0, z1]) {
      steelParts.push(placed(new THREE.BoxGeometry(GATE_BAR, gate.height, GATE_BAR), gx, gate.height / 2, gz));
    }
    for (const gy of [GATE_BAR / 2, gate.height, 1.0]) {
      steelParts.push(railGeo(gate.width, gx, gy, gate.z, true));
    }
  }

  // Net posts join the steel; the net itself joins the fence with finer cells.
  const netPostH = court.netHeight + 0.08;
  for (const x of [-halfW + 0.08, halfW - 0.08]) {
    steelParts.push(placed(new THREE.CylinderGeometry(0.045, 0.045, netPostH, 10), x, netPostH / 2, 0));
  }
  fenceParts.push(placed(cellPanel(court.width - 0.16, court.netHeight - 0.03, NET_CELL), 0, (court.netHeight - 0.03) / 2, 0));

  const steel = new THREE.Mesh(
    merged(steelParts),
    new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.45, metalness: 0.6 }),
  );
  steel.castShadow = true;
  root.add(steel);

  const fenceMesh = new THREE.Mesh(
      merged(fenceParts),
      new THREE.MeshStandardMaterial({
        color: PALETTE.steel,
        roughness: 0.6,
        metalness: 0.5,
        alphaMap: fenceTexture(),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
  root.add(fenceMesh);

  const glass = new THREE.Mesh(
    merged(glassParts),
    new THREE.MeshPhysicalMaterial({
      color: PALETTE.glassTint,
      transmission: 0,
      transparent: true,
      opacity: CUT_OPACITY.glassSolid,
      roughness: 0.05,
      metalness: 0,
      // Its own reference to the scene environment, so `envMapIntensity` applies here
      // instead of the scene's deliberately low `environmentIntensity`: the panes
      // catch the floodlights while the rest of the night stays dark.
      envMap: scene.environment,
      envMapIntensity: GLASS_REFLECTION,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  glass.renderOrder = 1; // after the fence, so its reflections sit on top
  root.add(glass);

  const endWalls = new EndWalls();
  const steelMat = steel.material as THREE.MeshStandardMaterial;
  const fenceSrc = fenceMesh.material as THREE.MeshStandardMaterial;
  const glassMat = glass.material as THREE.MeshPhysicalMaterial;
  for (const [i, parts] of endParts.entries()) {
    const g = new THREE.Group();
    g.name = i === 0 ? "endWallNeg" : "endWallPos";
    const m = {
      steel: steelMat.clone(),
      fence: fenceSrc.clone(),
      glass: glassMat.clone(),
    };
    const stl = new THREE.Mesh(merged(parts.steel), m.steel);
    stl.castShadow = true;
    const fen = new THREE.Mesh(merged(parts.fence), m.fence);
    const gl = new THREE.Mesh(merged(parts.glass), m.glass);
    gl.renderOrder = 1;
    g.add(stl, fen, gl);
    root.add(g);
    endWalls.add(i === 0 ? -1 : 1, m);
  }

  scene.add(root);
  return { root, endWalls };
}

interface EndMaterials {
  steel: THREE.MeshStandardMaterial;
  fence: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
}

const CUT_SECONDS = 0.3;
const CUT_OPACITY = { fence: 0.12, steel: 0.15, glass: 0.05, glassSolid: 0.12 };

/** The two back walls, one of which is faded out while the camera sits behind it. */
export class EndWalls {
  private ends = new Map<-1 | 1, { mats: EndMaterials; cut: number }>();

  add(side: -1 | 1, mats: EndMaterials): void {
    this.ends.set(side, { mats, cut: 0 });
  }

  /** Cut-away amount (0 solid, 1 fully faded) of the end on `side`. */
  cutAmount(side: -1 | 1): number {
    return this.ends.get(side)?.cut ?? 0;
  }

  /** Fade the `cutSide` end out and the other in, over about 0.3 s. */
  update(cutSide: -1 | 1, dtSec: number): void {
    for (const [side, e] of this.ends) {
      const target = side === cutSide ? 1 : 0;
      const step = dtSec / CUT_SECONDS;
      e.cut = target > e.cut ? Math.min(target, e.cut + step) : Math.max(target, e.cut - step);
      const set = (m: THREE.Material & { opacity: number }, solid: number, faded: number) => {
        const transparent = e.cut > 0 || m.transparent;
        m.opacity = solid + (faded - solid) * e.cut;
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.needsUpdate = true;
        }
      };
      set(e.mats.fence, 1, CUT_OPACITY.fence);
      set(e.mats.steel, 1, CUT_OPACITY.steel);
      set(e.mats.glass, CUT_OPACITY.glassSolid, CUT_OPACITY.glass);
    }
  }
}
