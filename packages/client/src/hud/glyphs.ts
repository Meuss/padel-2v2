/**
 * Drawn control glyphs, in the join comp's language (docs/design/v2-comp-join.png): outline
 * keycaps and a mouse with one button lit. Strokes and key letters use `currentColor`; a lit
 * button takes the `.glyph-hl` class (optic in hud.css). Each returns a fresh <svg class="glyph">
 * sized in px at a 22 px key height, so CSS can scale it by height alone.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
/** Height of one key, in viewBox units (and px at the base size). */
const KEY = 22;
/** One key inside a cluster, and the gap between keys. */
const CLUSTER_KEY = 15;
const CLUSTER_GAP = 2;

type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** The outer <svg>: a labelled image, or decorative with no label. */
function svg(w: number, h: number, kind: string, label: string | null): SVGSVGElement {
  const root = el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: `glyph glyph-${kind}`, focusable: "false" });
  if (label) {
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", label);
  } else {
    root.setAttribute("aria-hidden", "true");
  }
  return root;
}

/** A rounded key outline at (x, y). */
function cap(x: number, y: number, w: number, h: number): SVGRectElement {
  return el("rect", { x: x + 0.75, y: y + 0.75, width: w - 1.5, height: h - 1.5, rx: 3, class: "glyph-line" });
}

/** A key legend centred in a key. */
function legend(text: string, cx: number, cy: number, size: number): SVGTextElement {
  const t = el("text", { x: cx, y: cy, "font-size": size, "text-anchor": "middle", "dominant-baseline": "central", class: "glyph-text" });
  t.textContent = text;
  return t;
}

/** One keycap with its legend ("E", "?", "SPACE", "ENTER"); a longer legend makes a wider key. */
export function keycap(text: string, label: string | null = text): SVGSVGElement {
  const long = text.length > 1;
  const size = long ? 9.5 : 12;
  const w = long ? Math.max(30, Math.round(text.length * 6.2 + 12)) : KEY;
  const root = svg(w, KEY, "key", label);
  root.append(cap(0, 0, w, KEY), legend(text, w / 2, KEY / 2 + 0.5, size));
  return root;
}

/** An inverted-T of four keys: the top key alone, three below. */
function cluster(kind: string, label: string, draw: (i: number, cx: number, cy: number) => SVGElement): SVGSVGElement {
  const w = 3 * CLUSTER_KEY + 2 * CLUSTER_GAP;
  const h = 2 * CLUSTER_KEY + CLUSTER_GAP;
  const root = svg(w, h, kind, label);
  const at: [number, number][] = [
    [CLUSTER_KEY + CLUSTER_GAP, 0],
    [0, CLUSTER_KEY + CLUSTER_GAP],
    [CLUSTER_KEY + CLUSTER_GAP, CLUSTER_KEY + CLUSTER_GAP],
    [2 * (CLUSTER_KEY + CLUSTER_GAP), CLUSTER_KEY + CLUSTER_GAP],
  ];
  at.forEach(([x, y], i) => {
    root.append(cap(x, y, CLUSTER_KEY, CLUSTER_KEY), draw(i, x + CLUSTER_KEY / 2, y + CLUSTER_KEY / 2));
  });
  return root;
}

/** W over A S D. */
export function wasdKeys(label = "W A S D"): SVGSVGElement {
  return cluster("wasd", label, (i, cx, cy) => legend("WASD"[i]!, cx, cy + 0.5, 9));
}

/** The four arrow keys, each with a drawn chevron (up, left, down, right). */
export function arrowKeys(label = "Arrow keys"): SVGSVGElement {
  const turn = [0, -90, 180, 90];
  return cluster("arrows", label, (i, cx, cy) =>
    el("path", {
      d: `M${cx - 3} ${cy + 1.5} L${cx} ${cy - 1.75} L${cx + 3} ${cy + 1.5}`,
      transform: `rotate(${turn[i]} ${cx} ${cy})`,
      class: "glyph-line",
    }),
  );
}

/** A mouse seen from above, its left or right button lit. */
export function mouse(button: "left" | "right", label: string | null = button === "left" ? "Left click" : "Right click"): SVGSVGElement {
  const w = 16;
  const root = svg(w, KEY, `mouse-${button}`, label);
  // The body: a 13 × 20 capsule, so each button is a quarter circle over a short straight.
  const lit =
    button === "left"
      ? "M8 1.25 A6.75 6.75 0 0 0 1.25 8 V9.5 H8 Z"
      : "M8 1.25 A6.75 6.75 0 0 1 14.75 8 V9.5 H8 Z";
  root.append(
    el("path", { d: lit, class: "glyph-hl" }),
    el("rect", { x: 1.25, y: 1.25, width: 13.5, height: 19.5, rx: 6.75, class: "glyph-line" }),
    el("path", { d: "M8 1.25 V9.5 M1.25 9.5 H14.75", class: "glyph-line" }),
  );
  return root;
}
