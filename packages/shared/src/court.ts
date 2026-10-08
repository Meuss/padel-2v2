/**
 * The regulation padel cage: which parts of the perimeter are glass, which are
 * metal mesh, and how high each reaches. The single source of truth for both the
 * server's wall colliders and the client's cage meshes.
 *
 * Seen from inside, every wall stands on the court's edge (x = ±width/2 for the
 * sides, z = ±length/2 for the back walls):
 *
 *   Back walls       glass 0–3 m across the full width, mesh 3–4 m.
 *   Sides, 0–2 m     from each back wall: glass 0–3 m, mesh 3–4 m.
 *   Sides, 2–4 m     from each back wall: glass 0–2 m, mesh 2–3 m (the step).
 *   Sides, centre    the middle 12 m: mesh 0–3 m, with two closed gates a side.
 *
 * Above those heights the cage is open: a ball that crosses it leaves the court.
 */
import { COURT } from "./constants.js";

export type CageMaterial = "glass" | "mesh";

interface SegmentBase {
  /** Bottom and top of the panel (m). */
  y0: number;
  y1: number;
  material: CageMaterial;
}

/** A panel of a back wall (at z = end · length/2), spanning x0 → x1. */
export interface BackSegment extends SegmentBase {
  side: "back";
  end: -1 | 1;
  x0: number;
  x1: number;
}

/** A panel of a side wall (left at x = -width/2, right at +width/2), spanning z0 → z1. */
export interface SideSegment extends SegmentBase {
  side: "left" | "right";
  /** The back wall this panel belongs to; absent for the central 12 m. */
  end?: -1 | 1;
  z0: number;
  z1: number;
}

export type CageSegment = BackSegment | SideSegment;

/** A closed access gate: drawn as a framed mesh panel, physically part of the central side mesh. */
export interface CageGate {
  side: "left" | "right";
  /** Centre of the gate along z. */
  z: number;
  width: number;
  height: number;
}

const HALF_W = COURT.width / 2;
const HALF_L = COURT.length / 2;

/** Heights (m) of the regulation cage. */
export const CAGE_HEIGHT = {
  /** Top of the glass on the back walls and the side glass next to them. */
  glass: COURT.glassHeight,
  /** Top of the mesh above that glass: the tallest part of the cage. */
  top: COURT.wallHeight,
  /** Top of the stepped side glass, 2–4 m from each back wall. */
  stepGlass: 2,
  /** Top of the mesh over the step and of the central side mesh. */
  sideTop: 3,
} as const;

/** Lengths (m) along each side wall, measured from the back wall. */
const TALL_LEN = 2;
const STEP_LEN = 2;

const GATE_WIDTH = 0.82;
const GATE_HEIGHT = 2.0;
/** Gate centres sit this far (m) either side of the net. */
const GATE_OFFSET = 0.6;

function buildCage(): CageSegment[] {
  const H = CAGE_HEIGHT;
  const segs: CageSegment[] = [];
  for (const end of [-1, 1] as const) {
    segs.push(
      { side: "back", end, x0: -HALF_W, x1: HALF_W, y0: 0, y1: H.glass, material: "glass" },
      { side: "back", end, x0: -HALF_W, x1: HALF_W, y0: H.glass, y1: H.top, material: "mesh" },
    );
  }
  for (const side of ["left", "right"] as const) {
    for (const end of [-1, 1] as const) {
      // z0 < z1 always: the wall end first on the negative side, last on the positive one.
      const span = (from: number, to: number): [number, number] => {
        const a = end * (HALF_L - from);
        const b = end * (HALF_L - to);
        return a < b ? [a, b] : [b, a];
      };
      const [t0, t1] = span(0, TALL_LEN);
      const [s0, s1] = span(TALL_LEN, TALL_LEN + STEP_LEN);
      segs.push(
        { side, end, z0: t0, z1: t1, y0: 0, y1: H.glass, material: "glass" },
        { side, end, z0: t0, z1: t1, y0: H.glass, y1: H.top, material: "mesh" },
        { side, end, z0: s0, z1: s1, y0: 0, y1: H.stepGlass, material: "glass" },
        { side, end, z0: s0, z1: s1, y0: H.stepGlass, y1: H.sideTop, material: "mesh" },
      );
    }
    const mid = HALF_L - TALL_LEN - STEP_LEN;
    segs.push({ side, z0: -mid, z1: mid, y0: 0, y1: H.sideTop, material: "mesh" });
  }
  return segs;
}

export const CAGE: readonly CageSegment[] = buildCage();

export const CAGE_GATES: readonly CageGate[] = (["left", "right"] as const).flatMap((side) =>
  [-1, 1].map((s) => ({ side, z: s * GATE_OFFSET, width: GATE_WIDTH, height: GATE_HEIGHT })),
);

/** The x of a side segment's wall plane. */
export const sideX = (side: "left" | "right"): number => (side === "left" ? -HALF_W : HALF_W);

/**
 * The wall nearest (x, z), and the coordinate along it: a back wall when the point is closer
 * to it than to a side wall. Corners (equally close) count as the back wall.
 */
function nearestWall(x: number, z: number): { back: boolean; end: -1 | 1; along: number; side: "left" | "right" } {
  const back = HALF_L - Math.abs(z) <= HALF_W - Math.abs(x);
  return { back, end: z < 0 ? -1 : 1, along: back ? x : z, side: x < 0 ? "left" : "right" };
}

/** The segments of the wall nearest (x, z) that span that point along the wall. */
function segmentsAt(x: number, z: number): CageSegment[] {
  const w = nearestWall(x, z);
  return CAGE.filter((s) =>
    s.side === "back"
      ? w.back && s.end === w.end && w.along >= s.x0 && w.along <= s.x1
      : !w.back && s.side === w.side && w.along >= s.z0 && w.along <= s.z1,
  );
}

/**
 * What the cage is made of at a point on (or just inside) its nearest wall: glass, mesh, or
 * null where the cage is open (above it, or below the floor). On a boundary between two
 * panels the lower panel wins.
 */
export function surfaceAt(x: number, y: number, z: number): CageMaterial | null {
  let best: CageSegment | null = null;
  for (const s of segmentsAt(x, z)) {
    if (y >= s.y0 && y <= s.y1 && (best === null || s.y0 < best.y0)) best = s;
  }
  return best?.material ?? null;
}

/** Height (m) of the top of the cage on the wall nearest (x, z); the taller panel at a boundary. */
export function cageTopAt(x: number, z: number): number {
  let top = 0;
  for (const s of segmentsAt(x, z)) top = Math.max(top, s.y1);
  return top;
}

/**
 * Height (m) of the net's top at x: COURT.netHeight at the centre, rising along a parabola
 * (the sag of the cable) to COURT.netPostHeight at the posts on the side walls.
 */
export function netHeightAt(x: number): number {
  const u = Math.min(1, Math.abs(x) / HALF_W);
  return COURT.netHeight + (COURT.netPostHeight - COURT.netHeight) * u * u;
}

/**
 * Whether the ball has left the cage over the top: its centre is past a wall's plane and
 * above the cage there (it can only get past the plane by going over), or it is well
 * outside the court in any case.
 */
export function leftCage(pos: { x: number; y: number; z: number }): boolean {
  const ax = Math.abs(pos.x);
  const az = Math.abs(pos.z);
  if (ax > HALF_W + 0.3 || az > HALF_L + 0.3) return true;
  return (ax > HALF_W || az > HALF_L) && pos.y > cageTopAt(pos.x, pos.z);
}
