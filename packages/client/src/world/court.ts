/**
 * The playing court: blue turf and its surround, painted lines, the black steel
 * and glass cage with mesh fence, and the net. Static geometry is merged by
 * material so the whole court costs a handful of draw calls.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CourtConfig } from "@padel/shared";
import { PALETTE } from "./palette.js";
import type { Quality } from "./quality.js";

const LINE_W = 0.05;
const POST = 0.1;
const RAIL = 0.08;
/** Metres per fence cell, and per (finer) net cell. */
const FENCE_CELL = 0.18;
const NET_CELL = 0.07;

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

export function buildCourt(scene: THREE.Scene, court: CourtConfig, quality: Quality): THREE.Group {
  const root = new THREE.Group();
  root.name = "court";
  const halfW = court.width / 2;
  const halfL = court.length / 2;
  const wallH = court.wallHeight;
  const glassH = court.glassHeight;

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
  root.add(
    new THREE.Mesh(merged(lineParts), new THREE.MeshBasicMaterial({ color: PALETTE.lines })),
  );

  // ── Cage layout ──
  // Back walls: glass full width to glassH. Side walls, from each back wall: 2 m
  // of glass to glassH, then 2 m stepped down to 2 m high. Fence everywhere else.
  const stepH = glassH - 1;
  const glassParts: THREE.BufferGeometry[] = [];
  const fenceParts: THREE.BufferGeometry[] = [];
  const steelParts: THREE.BufferGeometry[] = [];
  const rail = (len: number, x: number, ry: number, z: number, alongZ: boolean) =>
    steelParts.push(placed(new THREE.BoxGeometry(len, RAIL, RAIL), x, ry, z, alongZ ? Math.PI / 2 : 0));

  for (const z of [-halfL, halfL]) {
    glassParts.push(placed(new THREE.PlaneGeometry(court.width, glassH), 0, glassH / 2, z));
    fenceParts.push(placed(cellPanel(court.width, wallH - glassH, FENCE_CELL), 0, (glassH + wallH) / 2, z));
    rail(court.width, 0, glassH, z, false);
  }
  for (const x of [-halfW, halfW]) {
    for (const s of [-1, 1]) {
      const zTall = s * (halfL - 1);
      const zStep = s * (halfL - 3);
      glassParts.push(placed(new THREE.PlaneGeometry(2, glassH), x, glassH / 2, zTall, Math.PI / 2));
      glassParts.push(placed(new THREE.PlaneGeometry(2, stepH), x, stepH / 2, zStep, Math.PI / 2));
      fenceParts.push(placed(cellPanel(2, wallH - glassH, FENCE_CELL), x, (glassH + wallH) / 2, zTall, Math.PI / 2));
      fenceParts.push(placed(cellPanel(2, wallH - stepH, FENCE_CELL), x, (stepH + wallH) / 2, zStep, Math.PI / 2));
      rail(2, x, glassH, zTall, true);
      rail(2, x, stepH, zStep, true);
    }
    const midLen = court.length - 8;
    fenceParts.push(placed(cellPanel(midLen, wallH, FENCE_CELL), x, wallH / 2, 0, Math.PI / 2));
  }

  // Posts every 2 m around the perimeter (corners once), and the top rail.
  const postAt = (x: number, z: number) =>
    steelParts.push(placed(new THREE.BoxGeometry(POST, wallH, POST), x, wallH / 2, z));
  const nx = Math.round(court.width / 2);
  const nz = Math.round(court.length / 2);
  for (let i = 0; i <= nx; i++) {
    const x = -halfW + (court.width / nx) * i;
    postAt(x, -halfL);
    postAt(x, halfL);
  }
  for (let i = 1; i < nz; i++) {
    const z = -halfL + (court.length / nz) * i;
    postAt(-halfW, z);
    postAt(halfW, z);
  }
  rail(court.width, 0, wallH, -halfL, false);
  rail(court.width, 0, wallH, halfL, false);
  rail(court.length, -halfW, wallH, 0, true);
  rail(court.length, halfW, wallH, 0, true);

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

  root.add(
    new THREE.Mesh(
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
    ),
  );

  const glass = new THREE.Mesh(
    merged(glassParts),
    new THREE.MeshPhysicalMaterial({
      color: PALETTE.glassTint,
      transmission: 0,
      transparent: true,
      opacity: 0.12,
      roughness: 0.05,
      metalness: 0,
      envMapIntensity: 1.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  glass.renderOrder = 1; // after the fence, so its reflections sit on top
  root.add(glass);

  scene.add(root);
  return root;
}
