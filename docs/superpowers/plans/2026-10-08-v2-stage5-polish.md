# V2 Stage 5 (Polish: user feedback 2026-10-08) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the user's feedback from playing V2:
1. English copy everywhere, keeping only the team names AZUL vs ROJO;
2. controls shortcuts visible to every player;
3. a court and cage whose dimensions match the regulation court, especially glass versus mesh, in both the visuals and the physics;
4. a much prettier join ("Enter a nickname") screen;
5. far nicer fault animations (double bounce, net, out, on the full, double hit).

**Architecture:** One shared cage description (`packages/shared/src/court.ts`) drives both the client meshes and the server colliders, so what you see is what the ball hits. Fault highlights carry every relevant position (protocol v5), and a new client module animates them in the broadcast language. Copy lives in `hud/copy.ts` (client) and `match.ts` text (server).

**Tech Stack:** TypeScript, three.js 0.186, Rapier 0.18.0 (pinned), Vitest, DOM/CSS with the stage-4 `hud.css` tokens.

**Spec:** `docs/superpowers/specs/2026-10-07-v2-redesign.md`, as amended by the user's 2026-10-08 feedback (this plan). Direction contract: `packages/client/.impeccable/surfaces/packages-client-index-html.md`.

## Global Constraints

- Gate: `pnpm typecheck && pnpm test && pnpm build`. Bump `PROTOCOL_VERSION` to **5** in Task 4, the first wire change.
- **Copy:** English broadcast copy everywhere. The ONLY Spanish words left are the team names `AZUL` and `ROJO`. Nothing else, in client or server.
- Tokens and visual language follow stage 4 (`hud/hud.css`): navy, white, team colours, optic as an accent only, Barlow Condensed. No emoji icons; use inline SVG.
- The budget still holds: ≤ 180 draw calls and ≤ 450k triangles at high. No per-frame allocations in render paths.
- Rapier stays pinned at 0.18.0. Collider changes go through `world.ts` only.
- Verify every visual change with `pnpm shoot` (dev server running), and look at the PNGs.

## Review Focus

- **The ball over the 3 m side mesh in the middle of the court** must be out ("over the cage"). The same ball near the back walls rebounds below 4 m (Task 4 test).
- **A ball hitting the side mesh** rebounds lower and slower than off glass, deterministically (Task 4 test).
- **A double bounce right after a net cord or a wall rebound:** both bounce markers sit at the true bounce points (Task 5 test with the recorded positions).
- **Shortcut legend vs the rally-clean rule:** the compact legend stays visible during play, but it is quiet and never over the court centre (Task 2 screenshot).
- **The join screen at 1280×720 and 2560×1440,** with a 16-character name and with the "new version" reload state (Task 3 screenshots).

---

### Task 1: English copy everywhere (team names stay AZUL / ROJO)

**Files:**
- `packages/client/src/hud/copy.ts` and its test:

  | Function | Change |
  |---|---|
  | `scoreCall` | LOVE / FIFTEEN / THIRTY / FORTY, "<X> ALL", "GOLDEN POINT" at 40–40, tiebreak digits, server's score first, en dash between |
  | `bannerFor` | GAME, SET & MATCH, FAULT, DOUBLE FAULT, LET (sub "REPLAY THE SERVE"), MATCH (sub "AZUL vs ROJO"), RESET; the golden-point banner title becomes "GOLDEN POINT" |
  | `teamLabel` | unchanged (AZUL/ROJO) |

  "Ad" becomes "ADVANTAGE".
- The score bug's warm-up header becomes "WARM-UP"; "FINAL" stays.
- Every other client string: grep `packages/client/src` and `index.html` for Spanish words (CALENTAMIENTO, NADA, QUINCE, TREINTA, CUARENTA, IGUALES, PUNTO, JUEGO, PARTIDO, FALTA, DOBLE, REPETIR, REINICIO, GANA, REVANCHA, GOLPES, REMATES, RALLY MÁS, ¿) and translate each one.
- `packages/server/src/match.ts`: the event text becomes `POINT — AZUL`, `GAME — AZUL`, `SET & MATCH — AZUL`, `FAULT`, `DOUBLE FAULT`, `LET`, `MATCH`, `RESET`. The `reason` strings become short English broadcast copy:

  | Reason | Text |
  |---|---|
  | serve long | "SERVE LONG" |
  | serve wide (wrong box) | "SERVE OUT — WRONG BOX" |
  | serve hit the wall first | "SERVE HIT THE GLASS FIRST" |
  | missed toss | "MISSED THE TOSS" |
  | into the net | "INTO THE NET" |
  | double bounce / not returned | "DOUBLE BOUNCE" |
  | on the full | "HIT THE GLASS ON THE FULL" (or "…THE FENCE…" when the contact was mesh) |
  | out over the cage | "OUT — OVER THE CAGE" |
  | out off the bounce | "OUT OFF THE BOUNCE" |
  | double hit | "DOUBLE HIT" |
  | didn't reach the other side | "SHORT — DIDN'T CROSS" |

  Keep every reason under about 28 characters.
- `packages/server/test/*`: update every assertion that matches on text.
- `CONTEXT.md`: the Score call example becomes "Thirty–Fifteen". Golden point, Banner and Final card examples move to English, and the language rule is noted: "English broadcast copy; team names AZUL/ROJO".
- The spec and the stage-4 plan's Global Constraints copy bullet each get a one-line amendment note: "Superseded 2026-10-08: English copy except team names".

- [ ] **Step 1:** Update the tests to the English expectations first, and watch them fail.
- [ ] **Step 2:** Implement. Grep is clean: run `grep -rniE "calentamiento|nada|quince|treinta|cuarenta|iguales|punto|juego|partido|falta|doble|repetir|reinicio|gana|revancha|golpes|remates|¿" packages/*/src packages/client/index.html` and expect no matches.
- [ ] **Step 3:** Run `pnpm shoot --autoserve --out .shots/s5t1` and look at it. Then run the gate and commit: `English broadcast copy everywhere; team names stay Azul and Rojo`.

---

### Task 2: Show the controls (shortcut legend plus first-time controls card)

**Files:**
- Create: `packages/client/src/hud/controls.ts`, `packages/client/test/controls.test.ts`
- Modify: `main.ts`, `hud.css`, `index.html`, which removes the old one-line `#hint`

**Design:**

**(a) Controls card, first time.** It shows after the first Welcome as a player, centred and above the lower third, in the broadcast panel style. It has two columns.
- MOVE: a WASD keycap cluster plus the arrow keys.
- HIT: a mouse SVG with the left button highlighted in optic, labelled "DRIVE", and a second mouse SVG with the right button highlighted, labelled "LOB". Under them: "SMASH: automatic when the ball is high".
- A row below covers SERVE ("SPACE to toss · CLICK at the top"), E react, M sound, ENTER skip replay, and B / N add / clear bots.
- A primary "Got it" button closes it, and so do Esc and the first serve. It is remembered in `localStorage("mpc-controls-seen")`, with try/catch.

**(b) Compact legend, always.** Bottom-right, above the hint area, quiet. A small "?" keycap button toggles the full card back at any time; the ? key does too.
- Next to it, a two-line mini legend: a left-click mouse icon with "DRIVE", a right-click mouse icon with "LOB", and a SPACE keycap with "SERVE".
- It is dimmed to 55% opacity during the rally, and it is never placed over the court centre.

**(c) Spectators** see only "?" with the spectator controls (TAKE SEAT and M), with no hit or serve rows.

```ts
export interface ControlRow { keys: string[]; label: string }
export function controlRows(role: Role): { move: ControlRow[]; hit: ControlRow[]; other: ControlRow[] } // pure
export function shouldShowCard(seen: boolean, role: Role): boolean; // pure
```

- [ ] **Step 1:** Write failing tests for `controlRows` (the player and spectator variants) and `shouldShowCard`.
- [ ] **Step 2:** Implement. The mouse and keycap glyphs are inline SVG with `currentColor`, about 22 px, with no emoji. Shoot the card open (with a dev param `?controls=1`) and the compact legend during a rally, at 1280 and 2560. Run the gate, then commit: `Show the controls: first-time card and an always-on compact legend`.

---

### Task 3: A much prettier join screen (comp-led)

**Inputs:** the controller provides the approved comp at `docs/design/v2-comp-join.png` before dispatch, and the brief names it.

**Files:** `index.html` and `hud.css` (the nickname and loading overlays), plus `main.ts` wiring if needed.

**Requirements:**
- Match the approved comp's composition, type scale and materials. The comp is law; English UI copy.
- The arena keeps rendering behind the screen: a translucent navy with backdrop blur shows the live floodlit arena.
- Contents:
  - the wordmark "MEUSS PADEL CLUB";
  - a short tagline ("2v2 padel · open room · first four play");
  - the nickname field, with a 16-character counter and focus state;
  - a primary PLAY button (optic accent, Enter submits);
  - a quiet line with the current room status when known ("3 playing · 1 watching");
  - the controls preview: tiny mouse glyphs for "Left click DRIVE · Right click LOB".
- The loading state and the "New version" reload state use the same shell.
- Motion: one orchestrated entrance (wordmark, then field, then button, about 400 ms total), with `prefers-reduced-motion` respected.
- Accessibility: a label for the input, a visible focus ring, and a button contrast ratio of at least 4.5:1.

- [ ] **Step 1:** Implement. Shoot at 1280×720 and 2560×1440 with `--no-join` (add the flag if missing), with the loading state, and with a 16-character name typed in. Compare the shots against the comp in your report. Run the gate, then commit: `A broadcast-quality join screen`.

---

### Task 4: Regulation court and cage: glass vs mesh in visuals AND physics (protocol v5)

**Regulation geometry** (padel federation standard; the reference article confirms the court is 20×10 m, the net 0.88 m centre and 0.92 m at the posts, glass to 3 m, mesh to 4 m):

| Element | Spec |
|---|---|
| Court | 20 × 10 m inside the walls; lines 5 cm white |
| Service lines | 6.95 m from the net, plus the centre service line |
| Net | 10 m wide, 0.88 m at the centre, 0.92 m at the posts (sagging slightly); posts at the side walls |
| Back walls (each end) | glass 3.0 m high across the full 10 m; metal mesh above, from 3.0 to 4.0 m |
| Side walls, 0–2 m from each back wall | glass 3.0 m high; mesh above to 4.0 m |
| Side walls, 2–4 m from each back wall | glass 2.0 m high; mesh above to 3.0 m |
| Side walls, central 12 m | metal mesh 0 → 3.0 m. Two access gates per side are drawn as mesh panels with a frame (0.82 m wide × 2.0 m high), centred 0.6 m either side of the net. They are closed, so the ball rebounds off them like mesh. |
| Above all these heights | open, so a ball crossing it leaves the cage |

**Files:**
- Create: `packages/shared/src/court.ts`, exporting `CAGE: CageSegment[]`. Each segment is `{ side: "back" | "left" | "right"; end?: -1 | 1; z0, z1 (or x0, x1); y0, y1; material: "glass" | "mesh" }`, plus a pure `surfaceAt(x, y, z): "glass" | "mesh" | null` and `cageTopAt(x, z): number`. Tests: `packages/shared/test/court.test.ts`.
- Modify: `packages/server/src/world.ts`. Build the colliders from `CAGE`, one cuboid per segment, with restitution and friction per material: glass keeps today's values; mesh gets `MESH.restitution` = 0.45 and `MESH.friction` = 0.6, both in constants. Contacts report the material.
- Modify: `packages/server/src/room.ts` / `match.ts`:
  - the contact surface comes from the collider material, not from y;
  - "out over the cage" uses `cageTopAt`;
  - glass versus fence on the full uses the material.
- Modify: `packages/client/src/world/court.ts`. Build the meshes from `CAGE`: glass panels, mesh panels, the stepped side glass, the gates with frames, posts at every segment boundary, and a top rail that follows the stepped heights. Keep the merged-geometry budget and the end-wall cutaway.
- Bump `PROTOCOL_VERSION` to 5 here. The `ContactSurface` "glass" | "fence" maps from the material, so no wire change is needed, but bump it because Task 5 changes `FaultHighlight` in the same release.

- [ ] **Step 1:** Write failing tests:
  - `CAGE` covers every perimeter metre exactly once per height band, with no gaps or overlaps;
  - `surfaceAt` and `cageTopAt` at sample points, e.g. (5, 2.5, 0) mesh, (5, 2.5, 9) glass, (5, 3.5, 0) null (out), (0, 3.5, 10) mesh;
  - physics: a ball thrown at the central side mesh at 2.5 m rebounds slower than the same ball at the back glass; a ball lobbed over the side at 3.2 m in the middle leaves the cage and the point ends "out over the cage".
- [ ] **Step 2:** Implement and shoot (player and spectator). The stepped glass, the mesh bands and the gates must read clearly. Check the stats budget. Re-run the seeded bot matches and report the point-ending distribution, which should not regress badly. Run the gate, then commit: `Regulation cage: stepped side glass, mesh bands and gates, shared by visuals and physics`.

---

### Task 5: Fault animations worth watching

**Files:**
- `packages/shared/src/messages.ts`: `FaultHighlight` gains `points?: Vec3[]`, the relevant positions: double bounce gives both bounces, net gives the contact, out gives the exit point, and so on. Also `surface?: "glass" | "mesh" | "net" | "floor"`.
- `packages/server/src/match.ts`: record bounce positions per rally (the first bounce on the target side and the second), the net contact point, and the exit point, and fill `points`.
- Create: `packages/client/src/world/faultfx.ts`, replacing `scene.showFault` and the old red ring, sphere and plane markers.
- Test: `packages/client/test/faultfx.test.ts` (pure timeline), plus server tests for `points`.

**Design** (broadcast replay-graphics style, crisp and bloom-friendly; the colours are `--rojo` for faults and white for neutral marks; everything eases, nothing pops):

| Fault | Animation |
|---|---|
| Double bounce | Two impact decals drawn in sequence: an expanding thin ring plus a soft disc on the turf at bounce 1, labelled "1", then bounce 2, labelled "2", 250 ms apart. A dashed arc traces the ball path between them. Bounce 2 pulses red, then everything fades out over 1.8 s. |
| Net | The net band briefly lights along its top tape (an emissive sweep from the contact point outward). A small ripple decal sits on the net mesh at the contact, and the ball ghost hangs at the contact for 0.6 s. |
| Out | A ring at the exit point on the cage top, or at the landing spot outside the line, with an "OUT" chip sprite and a faint line back to the last bounce. |
| On the full (glass or mesh) | A glass "impact star" decal (radial lines) or a mesh "rattle" highlight (a small rectangle glow on the mesh panel), plus the ghost ball. |
| Double hit | A ring around the offending player with a "2×" chip. |
| Serve fault | The same as out or net as appropriate, plus a service-box outline flashing on the target box. |

Every animation lasts 1.8 to 2.2 s, is pooled, allocates nothing per frame, and respects the draw-call budget.

```ts
export type FaultFx = { kind: FaultKind; points: Vec3[]; surface?: string };
export function faultTimeline(fx: FaultFx): { at: number; action: "ring" | "label" | "arc" | "pulse" | "sweep" | "chip" | "ghost"; index: number }[]; // pure
```

- [ ] **Step 1:** Write failing tests: `faultTimeline` for each kind (ordering and timings), and the server double bounce `points` length 2 with the true positions, taken from a scripted physics scenario.
- [ ] **Step 2:** Implement, then capture each fault with a dev param `?fault=<kind>` that renders a synthetic fault at sample positions (DEV-only). Shoot every kind, look at them, and put the crop paths in the report. Run the gate, then commit: `Broadcast-style fault animations: double bounce, net, out, on the full, double hit`.
