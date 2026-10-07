# V2 Stage 2 (World) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the V1 scene with the Pro Tour Broadcast world. That means a floodlit night arena, a crowd, LED boards, a black steel and tinted-glass cage on a blue court, rigged and animated mannequin players with team kits and shirt nicknames, broadcast-style cameras, and an automatic quality fallback. The README also gets its first real V2 screenshot.

**Architecture:** `packages/client/src/scene.ts` keeps its public API, so `main.ts` barely changes. Its internals move into focused modules under `packages/client/src/world/`. Pure decision logic is exported from those modules as plain functions and unit tested with Vitest; three.js math runs fine in Node. A headless-Chrome screenshot script (`scripts/shoot.mjs`) is the visual verification tool for every task, because the controller cannot rely on a visible browser.

**Tech Stack:** three.js 0.186 (GLTFLoader, SkeletonUtils, AnimationMixer, RoomEnvironment/PMREM, EffectComposer + UnrealBloomPass), Vite 8, Vitest 5, puppeteer-core driving the system Chrome with SwiftShader, and @gltf-transform for asset prep.

**Spec:** `docs/superpowers/specs/2026-10-07-v2-redesign.md` (stage 2). The approved comp is `docs/design/v2-comp-clean-feed.png`. Read it: it is the visual target. The glossary is in `CONTEXT.md`.

**Visual-work ruling:** for 3D look-and-feel tasks this plan gives exact interfaces, parameters, palette values and the pure logic as code. Mesh-building code is described precisely rather than written out line by line. Each such task ends with a headless screenshot that the implementer must look at and compare against the comp before reporting.

## Global Constraints

- The gate before calling any task done: `pnpm typecheck && pnpm test && pnpm build`.
- Relative imports use `.js` extensions, and type-only imports use `import type`. `verbatimModuleSyntax` and `noUncheckedIndexedAccess` are on.
- `PadelScene`'s public methods keep their names and signatures. They are `buildCourt`, `setBall`, `setPlayer`, `removePlayer`, `triggerSwing`, `showFault`, `setSpectatorCamera`, `setPlayerCamera`, `focusCamera`, `projectToScreen`, `aimFromPointer`, `start`, `domElement`, and the `scene` field. New methods may be added.
- The game name is **Meuss Padel Club**, and there is no company branding: the Marvelous sticker code and assets get removed. The teams are **Azul** (A) and **Rojo** (B) in all new user-facing text.
- Palette (from the comp):

  | Element | Hex |
  |---|---|
  | court turf | `#2a5fc4` |
  | court surround | `#173a7a` |
  | court lines | `#f4f7ff` |
  | cage steel | `#0d1016` |
  | glass tint | `#9fb8d8` (opacity 0.10–0.14) |
  | arena ground | `#070a12` |
  | night sky/fog | `#05070d` |
  | LED board background | `#0b1a3a` |
  | LED text | `#ffffff` |
  | Azul kit | `#2f6df6` |
  | Rojo kit | `#d8383a` |
  | mannequin joints | `#1a1d26` |
  | ball | `#e4f23a` (the only optic-yellow object) |

- Performance budget at quality "high", 4 players, in the in-match view: **≤ 180 draw calls** and **≤ 450k triangles** (`renderer.info.render`). Quality "low" must cut both, and turn off bloom and shadow-map size above 1024.
- Only CC0 assets get committed. Every committed binary asset sits next to a `SOURCE.md` giving the origin URL, licence and the processing done.
- Desktop only. No touch work.

## Review Focus

- **Model fails to load or loads slowly** (Render cold start, slow network): players must still show, using the procedural fallback avatar, and swap to the mannequin when it arrives. There must be no crash and no invisible players (test in Task 4 via `AvatarFactory` with a failing loader).
- **A player joins mid-match or a bot is cleared:** the avatar is created and removed cleanly, the animation mixer is disposed, and draw calls don't grow (Task 4 test; the Task 7 shoot stats compare before and after clearing bots).
- **Ends swap:** the Player cam swings to the other end smoothly and the shirt nickname still faces away from the net (Task 5 pure pose test).
- **A slow machine:** the quality fallback drops to "low" within about 3 s and stays there. It must not oscillate between levels (Task 6 hysteresis test).
- **A spectator joining a full room:** gets the Broadcast cam, not a stuck player camera (Task 5 test plus a Task 7 spectator screenshot).

---

### Task 1: Headless shoot tool and dev auto-join

**Files:**
- Modify: `package.json` (root): add devDependency `puppeteer-core` (latest 24.x) and a script `"shoot": "node scripts/shoot.mjs"`
- Create: `scripts/shoot.mjs`
- Modify: `packages/client/src/main.ts`: dev-only auto-join
- Modify: `packages/client/src/scene.ts`: expose `stats()`
- Modify: `CLAUDE.md`: document `pnpm shoot`

**Interfaces:**
- Produces:
  - `pnpm shoot [--out <dir>] [--wait <ms>] [--spectator] [--width 1440 --height 900] [--url http://localhost:5173]`. It writes `<out>/player.png`, `<out>/spectator.png` when `--spectator` is passed, and `<out>/stats.json` (`{ player: {calls, triangles, geometries, textures, fps}, spectator?: {...} }`). The default out dir is `.shots/` (gitignored).
  - Dev URL params: `?join=<name>&bots=<n>` auto-joins and then adds n bots once seated.
  - `PadelScene.stats(): { calls: number; triangles: number; geometries: number; textures: number }`.

- [ ] **Step 1:** Add the dependency with `pnpm add -D -w puppeteer-core@^24`. Add `.shots/` to `.gitignore`. puppeteer-core has no install script, so `allowBuilds` doesn't change.
- [ ] **Step 2: Dev auto-join in `main.ts`.** At the end of the "Nickname / connection flow" section, add:

```ts
// Dev-only: ?join=<name>&bots=<n> skips the nickname card (used by `pnpm shoot`).
let devBots = 0;
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  const auto = q.get("join");
  if (auto !== null) {
    devBots = Math.max(0, Math.min(3, Number(q.get("bots") ?? 0) || 0));
    nickInput.value = auto;
    play();
  }
}
```

Then, at the end of `onWelcome`, add:

```ts
    if (msg.role === "player" && devBots > 0) {
      for (let i = 0; i < devBots; i++) net.send({ t: "addbot" });
      devBots = 0;
    }
```

`devBots` must be declared before `net` is constructed so the handler can see it. Hoist the `let devBots = 0;` line next to the other top-level `let`s, and keep the URL-parsing block where it is.
- [ ] **Step 3: `stats()` in `scene.ts`:**

```ts
  /** Render counters from the last frame (used by the shoot tool and quality checks). */
  stats(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }
```

- [ ] **Step 4: `scripts/shoot.mjs`.** Write it as a plain ESM Node script with no TypeScript. Requirements:
  - Parse the flags above with `node:util` `parseArgs`.
  - Chrome path: `process.env.CHROME_PATH` or `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
  - Launch puppeteer-core with `headless: true`, `args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-first-run"]` and `defaultViewport: {width, height, deviceScaleFactor: 1}`.
  - Page 1 opens `${url}/?join=Shooter&bots=3`. Wait until `window.__padelScene` exists and the page has 4 `.nametag` elements, or 20 s pass. Then wait `--wait` ms (default 4000).
  - Measure fps by counting `requestAnimationFrame` callbacks for 2000 ms inside `page.evaluate`.
  - Read `__padelScene.stats()`. Screenshot to `player.png`.
  - If `--spectator` is passed, open page 2 at `${url}/?join=Watcher` (the room is full, so it becomes a spectator), wait the same, then screenshot and collect stats.
  - Write `stats.json` and print it. Exit code 1 with a clear message if any wait times out.
  - Close the browser in `finally`.
- [ ] **Step 5: Verify.** Run `pnpm dev` in the background, then `pnpm shoot --spectator --out .shots/t1`. Open `.shots/t1/player.png` and `.shots/t1/spectator.png` and confirm both show the V1 game in a match with 4 players. `stats.json` must have numbers. Kill the dev server.
- [ ] **Step 6:** Add a line to the `CLAUDE.md` Conventions section: `` `pnpm shoot` (dev server running) renders the game in headless Chrome and writes screenshots + render stats to `.shots/`; use it to verify visual changes. ``
- [ ] **Step 7:** Run the gate, then commit: `Add headless shoot tool and dev auto-join for visual verification`.

---

### Task 2: Player model asset (CC0 Quaternius mannequin, trimmed)

**Files:**
- Modify: root `package.json`: add devDependencies `@gltf-transform/core` and `@gltf-transform/functions` (latest 4.x)
- Create: `scripts/prepare-player-model.mjs`
- Create: `packages/client/public/models/player.glb` (generated)
- Create: `packages/client/public/models/SOURCE.md`

**Interfaces:**
- Produces: `/models/player.glb` (served under Vite `BASE_URL`), containing one skinned mesh `Mannequin`, materials `M_Main` and `M_Joints`, and exactly these clips: `Idle_Loop`, `Crouch_Idle_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`, `Sword_Attack`, `Punch_Cross`, `Dance_Loop`, `Jump_Start`. The bones include `DEF-hand.R` and `DEF-spine.003`.

- [ ] **Step 1: Download the source** into a scratch dir outside the repo, so it is never committed:

```bash
mkdir -p /tmp/ual && curl -sfL -o /tmp/ual/ual.zip https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip
unzip -o -q /tmp/ual/ual.zip -d /tmp/ual/x
cat "$(find /tmp/ual/x -name License.txt)"   # must say CC0 1.0
```

- [ ] **Step 2: `scripts/prepare-player-model.mjs`.** Usage: `node scripts/prepare-player-model.mjs <input.glb> <output.glb>`. Using `@gltf-transform/core` (`NodeIO`) and `@gltf-transform/functions` (`prune`, `dedup`, `quantize`):
  - Read the input.
  - Dispose every animation whose name is not in the keep list above, and fail with exit 1 if any kept name is missing.
  - Run `dedup()`, `prune()` and `quantize()`.
  - Write the output.
  - Print the output byte size, the kept clip names, and the triangle count.
- [ ] **Step 3: Run it.**

```bash
node scripts/prepare-player-model.mjs "$(find /tmp/ual/x -name '*Godot_Standard.glb')" packages/client/public/models/player.glb
```

Expected: the size is ≤ 2.5 MB and the output lists the 8 clips. If the file is bigger, add `meshopt` compression only if three's `GLTFLoader` is also given the `MeshoptDecoder` in Task 4. Note that choice in the report.
- [ ] **Step 4: `SOURCE.md`.** Record:
  - the origin ("Universal Animation Library [Standard] by Quaternius")
  - the URL https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip and the page https://quaternius.com/packs/universalanimationlibrary.html
  - the licence: CC0 1.0, as stated in the pack's License.txt
  - the processing: the exact command and the kept clip list.
- [ ] **Step 5:** Run the gate, then commit: `Add CC0 animated player model (Quaternius mannequin, trimmed)`.

---

### Task 3: Court, cage and arena: the Pro Tour Broadcast world

**Files:**
- Create: `packages/client/src/world/palette.ts`, with all hex values from Global Constraints as `export const PALETTE = { … } as const`
- Create: `packages/client/src/world/court.ts`: `buildCourt(scene, court, quality)` covering the turf, surround, lines, cage and net
- Create: `packages/client/src/world/arena.ts`: `class Arena` covering the ground, stands, crowd, floodlights and LED boards
- Create: `packages/client/src/world/boards.ts`: pure LED ticker text logic plus the canvas drawing
- Test: `packages/client/test/boards.test.ts`
- Modify: `packages/client/src/scene.ts`: delegate court building to `world/court.ts`, construct the `Arena`, remove `addStickers` / `loadSvgImage` / `makeStickerTexture` and any Marvelous asset references, replace lighting and environment
- Delete: any Marvelous sticker asset files referenced only by the removed code. Grep `packages/client` for `marvelous` and `sticker`, case-insensitive.

**Interfaces:**
- Produces:

```ts
// world/boards.ts
export interface BoardState {
  phase: "warmup" | "serve" | "rally" | "between" | "over";
  gamesA: number; gamesB: number; pointA: string; pointB: string;
  names: string[];            // seated player names, Azul first
  reaction: string | null;    // reaction id currently showing, or null
}
/** Messages the LED ribbon cycles through, in order. Pure. */
export function boardMessages(s: BoardState): string[];
// arena.ts
export class Arena {
  constructor(scene: THREE.Scene, quality: Quality);
  setBoards(s: BoardState): void;    // cheap: only redraws the canvas when messages change
  cheer(intensity: number): void;    // 0..1, crowd jumps / waves for ~2 s
  update(dtSec: number): void;       // ticker scroll + crowd animation
}
```

`Quality` is `"high" | "low"` and is exported from `world/quality.ts` (created in Task 6). For this task, create `world/quality.ts` containing only `export type Quality = "high" | "low";`.

- [ ] **Step 1: Failing tests for `boardMessages`** in `packages/client/test/boards.test.ts`:
  - warmup → `["MEUSS PADEL CLUB", "WARM-UP"]`
  - in match (gamesA 3, gamesB 2, pointA "30", pointB "15", names `["Ana","Bot Heidi","Leo","Bot Mr Bean"]`) → `["MEUSS PADEL CLUB", "AZUL 3 · 2 ROJO", "30 – 15", "ANA · BOT HEIDI  VS  LEO · BOT MR BEAN"]`
  - when `reaction` is `"gg"`, a final `"GG!"` entry is appended (the uppercase id plus `!`)
  - `phase: "over"` puts `"FINAL"` right after the club name.
  - Names are uppercased and the list never contains empty strings.
- [ ] **Step 2:** Implement `boardMessages` to pass. Then implement the canvas drawing:
  - `drawBoard(ctx, messages, scrollPx)` draws a dark `#0b1a3a` background.
  - The messages are set in a bold condensed sans (`"700 64px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif"`), white, separated by a small optic-yellow `•`. This is the only other place optic yellow may appear, and it is tiny.
  - The canvas is 2048×128 and is used as a `CanvasTexture` with `wrapS = RepeatWrapping`. Scroll by offsetting `texture.offset.x` in `update()`, never by redrawing every frame.
- [ ] **Step 3: Court** (`world/court.ts`), dimensions from `CourtConfig`, colours from `PALETTE`:
  - **Turf:** a plane with `MeshStandardMaterial` in the turf colour, roughness 0.95. Give it a procedural `CanvasTexture` (512² of fine noise, repeated 8×16) to suggest artificial grass. Also add a surround plane 3 m larger on every side, in the surround colour.
  - **Lines:** 5 cm wide, `#f4f7ff`, `MeshBasicMaterial` so they read crisply under the floodlights. Merge them into ONE `BufferGeometry` with `BufferGeometryUtils.mergeGeometries` to save draw calls.
  - **Cage:** black steel posts every 2 m along all four sides (box 0.1×4×0.1) and a top rail.
    - Glass on the back walls: full width × 3 m. Glass on the side walls: the first 4 m from each back wall, 3 m high, with the 2 m nearest the corners stepping up. Use `MeshPhysicalMaterial({ color: glassTint, transmission: 0, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0, envMapIntensity: 1.2 })` so the floodlights reflect off it through the scene environment. Glass edges get a thin black frame.
    - Mesh fence: everywhere else up to 4 m. Reuse the existing fence-texture approach, with dark wire and alpha.
    - Merge posts and rails into one mesh, and give all the glass one material.
  - **Net:** a dark mesh net with a white top tape and two black posts.
- [ ] **Step 4: Arena** (`world/arena.ts`):
  - **Ground and sky:** a ground plane 200×200 in `#070a12`, `scene.background` and `scene.fog` (`Fog`, 40–110 m) in `#05070d`.
  - **Stands:** on both long sides and both ends, 3 m outside the cage. 6 tiers stepping up 0.45 m and back 0.8 m. Dark `#10141d` boxes merged into one mesh per side.
  - **Crowd:** one `InstancedMesh` of simple low-poly figures (a capsule-ish body plus a sphere head merged into one geometry, under 60 tris). One instance every 0.7 m per tier, so 600–900 instances in "high" and 40% of them in "low". Use per-instance colour from a muted palette (navy, grey, red, white, blue-ish) and leave 15% of seats empty at random with a fixed seed.
    - `cheer(intensity)` sets a per-instance phase. `update` makes instances bob up to 0.25 m × intensity, decaying over 2 s.
    - The idle crowd makes a subtle 1–2 cm breathing bob. Update `instanceMatrix` only while the crowd is animating, and throttle idle updates to 10 Hz.
  - **Floodlights:** 4 corner towers, a black pole 14 m tall with a head of 2×4 emissive white panels (`MeshBasicMaterial`, `#ffffff`, toneMapped false so bloom catches them). Lighting:
    - one shadow-casting `DirectionalLight` (intensity 2.2, colour `#f2f6ff`) high above one long side. Shadow map 2048 on "high" and 1024 on "low", with the shadow camera tight around the court (±12 m);
    - a `HemisphereLight` (`#9fb4ff` over `#0b0f18`, 0.55);
    - two non-shadow `DirectionalLight` fills (0.6) from the opposite corners.
    - No point or spot lights: their cost per pixel is too high for the budget.
  - **LED boards:** a 0.9 m tall ribbon wrapping the perimeter at the foot of the stands, sharing ONE `CanvasTexture` (through UV offsets per side) and using `MeshBasicMaterial` so it glows. Also add one larger end-wall board behind each back glass, above the 3 m mark, reading "MEUSS PADEL CLUB", as in the comp.
  - **Environment:** create a `PMREMGenerator` environment from `RoomEnvironment` once and set `scene.environment` to it, so the glass and players get reflections.
- [ ] **Step 5: Wire it into `scene.ts`.**
  - The constructor creates `this.arena = new Arena(this.scene, "high")` and replaces `addLights` and `addSurroundings`.
  - `buildCourt` calls `world/court.ts` (and keeps the build-once guard).
  - `render()` calls `this.arena.update(dt)`. Track `dt` in `render` from `performance.now()`.
  - Add a public `setBoards(s: BoardState)` that forwards to the arena, and a public `cheer(intensity: number)`.
  - In `main.ts`, in `onMatch` and `onRoster`, build a `BoardState` from `match` + `names` and call `scene.setBoards`. When `msg.event` starts with `"Point"`, `"Game"` or `"Set"`, call `scene.cheer(msg.event.startsWith("Point") ? 0.5 : 1)`.
- [ ] **Step 6: Verify visually.** Start the dev server, then run `pnpm shoot --spectator --out .shots/t3`.
  - Open both PNGs next to `docs/design/v2-comp-clean-feed.png`. The arena must read as the comp: dark stands with crowd, bright floodlight heads, LED ribbon with white text, black cage, blue court.
  - In your report, list 3 things that match the comp and 3 that don't yet (players and camera are later tasks).
  - Check `stats.json`: player-view calls ≤ 180 and triangles ≤ 450k. If either is over, fix it before reporting.
- [ ] **Step 7:** Run the gate, then commit: `Build the Pro Tour Broadcast arena, court and cage`.

---

### Task 4: Mannequin players with animation, team kits and shirt nicknames

**Files:**
- Create: `packages/client/src/world/avatar.ts`
- Test: `packages/client/test/avatar.test.ts`
- Modify: `packages/client/src/scene.ts`: `setPlayer`, `removePlayer`, `triggerSwing`, `avatar()` delegate to `world/avatar.ts`; the procedural V1 avatar moves into `avatar.ts` as the fallback
- Modify: `packages/client/src/main.ts`: pass names to the scene (`scene.setPlayerName(slot, name)` from `onRoster`) and trigger celebrations

**Interfaces:**
- Produces:

```ts
export type Locomotion = "idle" | "ready" | "jog" | "sprint";
/** Pick the locomotion clip from ground speed (m/s) and whether the ball is on our side. Pure. */
export function pickLocomotion(speed: number, ballOnOurSide: boolean): Locomotion;
// speed < 0.35 → ballOnOurSide ? "ready" : "idle"; speed < 4.2 → "jog"; else "sprint"

export interface ModelSource { load(): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> }
export class AvatarFactory {
  constructor(source: ModelSource);
  /** Returns immediately: a fallback avatar now, upgraded in place when the model resolves. Never throws. */
  create(slot: Slot, team: Team): Avatar;
}
export class Avatar {
  readonly root: THREE.Group;          // add this to the scene
  setPose(x: number, y: number, z: number, yaw: number, dtSec: number): void; // derives speed from position delta
  setBallSide(ballOnOurSide: boolean): void;
  swing(kind: "drive" | "smash"): void; // one-shot clip, returns to locomotion
  celebrate(): void;                    // Dance_Loop for 2.5 s
  setName(name: string): void;          // shirt-back nickname decal
  update(dtSec: number): void;          // advances the mixer
  dispose(): void;                      // removes from parent, disposes mixer, cloned materials and decal texture
}
```

- [ ] **Step 1: Failing tests** in `packages/client/test/avatar.test.ts`.
  - `pickLocomotion` thresholds.
  - `AvatarFactory` with a `ModelSource` whose `load()` rejects: `create()` returns an `Avatar` whose `root` has children (the fallback), and calling `update`/`setPose`/`swing`/`dispose` does not throw.
  - `AvatarFactory` with a source that resolves to a tiny synthetic skinned rig (build in the test with `THREE.Bone`s named `DEF-hand.R` and `DEF-spine.003`, a `SkinnedMesh` with materials named `M_Main`/`M_Joints`, and one `AnimationClip` per required name with a single empty track):
    - after `await` of a flushed microtask queue, the root contains the cloned rig;
    - `M_Main` is a different material instance from the source's, and its colour is the team colour;
    - `dispose()` removes the root from its parent.
- [ ] **Step 2: Implement `avatar.ts`.**
  - **Model loading:** `GLTFLoader` behind a module-level cached promise for `${import.meta.env.BASE_URL}models/player.glb`. `AvatarFactory.create` clones it with `SkeletonUtils.clone`.
  - **Scale:** the rig height is 1.8 m (`PLAYER.height`). Compute it from the bounding box once.
  - **Materials:** clone `M_Main` and set it to the Azul or Rojo kit colour (roughness 0.6). Set `M_Joints` to the joints colour. Shadows: `castShadow` on, `receiveShadow` off.
  - **Racket:** move the existing procedural racket model into a `makeRacket()` function and parent it to the bone `DEF-hand.R`, oriented so the face points forward when the hand is at rest. Tune it by screenshot.
  - **Shirt nickname:** a 0.32×0.12 m plane parented to `DEF-spine.003`, offset to the back (−z in rig space, facing away), with a 256×96 `CanvasTexture`: white bold uppercase name, max 10 chars with an ellipsis, transparent background. It must face away from the net when the player faces the net.
  - **Animation:** one `AnimationMixer` per avatar.
    - Locomotion clips crossfade over 0.18 s. Run speed scales with ground speed: jog `timeScale = speed/3.2`, clamped 0.8–1.4.
    - `swing("drive")` plays `Sword_Attack` once with `timeScale` so it lasts 0.42 s; `swing("smash")` plays `Punch_Cross` the same way. Both run on a layered action fading in over 0.05 s and out over 0.12 s, so the legs keep running.
    - `celebrate()` plays `Dance_Loop` for 2.5 s.
  - **Fallback:** the procedural V1 avatar, recoloured with the kit palette, also gets `swing` (the old racket sweep), and `celebrate` (a little jump) when no model is loaded.
- [ ] **Step 3: Wire it into `scene.ts`.** `setPlayer` uses `factory.create` on first sight and `avatar.setPose(...)`. `removePlayer` calls `dispose()`. `triggerSwing(slot)` calls `swing("drive")`. Add `setPlayerName(slot, name)`, `celebrate(team: Team)` (celebrates every avatar of that team) and `setBallSide(ballZ: number)` (each avatar gets `sign(ballZ) === its own half's sign`, using the avatar's current z). `render()` calls `update(dt)` on every avatar.
- [ ] **Step 4: Wire it into `main.ts`.**
  - `onRoster` → `scene.setPlayerName(p.slot, p.name)` for each player.
  - Each frame after `setBall` → `scene.setBallSide(s.ball.z)`.
  - `onMatch`: when the event starts with `"Point"` or `"Game"`, celebrate the winning team. `match.ts` builds the event as ``Point — ${TEAM_NAME[w]}``, so map the name back to A/B with a small helper. Put that helper in `world/boards.ts` as `teamFromEvent(event): Team | null` and test it there.
- [ ] **Step 5: Verify.** Run `pnpm shoot --spectator --out .shots/t4` and look at both PNGs.
  - 4 mannequins in Azul or Rojo kits, holding rackets, in a ready or idle pose, readable against the blue court.
  - Stats within budget.
  - Then shoot a second time with `--wait 9000` and confirm the bots are in different poses (they are animating).
- [ ] **Step 6:** Run the gate, then commit: `Add animated mannequin players with team kits, rackets and shirt names`.

---

### Task 5: Broadcast cameras

**Files:**
- Create: `packages/client/src/world/cameras.ts`
- Test: `packages/client/test/cameras.test.ts`
- Modify: `packages/client/src/scene.ts`: `setSpectatorCamera`, `setPlayerCamera`, `focusCamera` and the camera update in `render()` delegate to `CameraRig`; the camera FOV comes from the rig

**Interfaces:**
- Produces:

```ts
export interface CamPose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }
/** Player cam: long-lens broadcast framing behind the player's own end. Pure. */
export function playerCamPose(player: {x: number; z: number}, ball: {x: number; z: number} | null, side: -1 | 1): CamPose;
/** Broadcast cam for spectators: elevated, behind the z<0 end, gently tracking the ball. Pure. */
export function broadcastCamPose(ball: {x: number; z: number} | null): CamPose;
export class CameraRig {
  constructor(camera: THREE.PerspectiveCamera);
  setMode(mode: "player" | "broadcast"): void;
  setTargets(player: {x: number; z: number} | null, ball: {x: number; z: number} | null, side: -1 | 1): void;
  update(dtSec: number): void; // critically damped smoothing toward the pose (frame-rate independent)
}
```

- [ ] **Step 1: Failing tests**, using the court numbers from `COURT` (length 20 and width 10).
  - `playerCamPose` with side −1 at the player (0, −6) without a ball: pos.z < −10 (behind the back glass), 7 ≤ pos.y ≤ 10, `look.z > player.z`, fov between 30 and 38.
  - With side +1, everything is mirrored.
  - With the ball at the far end, look.z moves toward the net but never past z=+4 for side −1.
  - Pos.x follows player.x × 0.35 and is clamped to ±3.
  - `broadcastCamPose(null)`: pos (0, ≈11, ≈−19), look (0, 0.5, ≈2), fov ≈ 36.
  - The ball at x = 4 moves look.x to at most 1.5.
  - `CameraRig.update` converges: from a far start, 3 s of 1/60 updates bring the camera within 1 cm of the target pose. 1/30 updates must give the same result within 2 cm (frame-rate independence).
- [ ] **Step 2: Implement.** Smoothing uses `1 - exp(-dt * 6)` on position and look and `1 - exp(-dt * 4)` on fov.
  - `scene.ts`: `setPlayerCamera(team)` puts the rig in "player" mode.
  - `focusCamera(x, y, z)` stores the player target. The side comes from `z < 0 ? -1 : 1`, the same as V1, so it keeps working through ends swaps.
  - `setSpectatorCamera()` puts the rig in "broadcast" mode.
  - Add `setBallTarget(x, z)`, called from `main.ts` each frame alongside `setBall`.
  - `aimFromPointer` keeps using `this.camera`.
- [ ] **Step 3: Verify.** Run `pnpm shoot --spectator --out .shots/t5`.
  - The player view should now resemble `docs/design/v2-comp-clean-feed.png`: camera behind and above the near pair, the court filling the frame, opponents beyond the net, the crowd and LED boards visible.
  - The spectator view is the elevated end-of-court broadcast angle.
  - Compare against the comp and write the differences in your report.
- [ ] **Step 4:** Run the gate, then commit: `Add broadcast-style player and spectator cameras`.

---

### Task 6: Renderer quality, bloom and automatic fallback

**Files:**
- Modify: `packages/client/src/world/quality.ts`, adding the monitor
- Test: `packages/client/test/quality.test.ts`
- Modify: `packages/client/src/scene.ts`: renderer setup, post-processing, applying quality changes

**Interfaces:**
- Produces:

```ts
export type Quality = "high" | "low";
/** Decide quality from recent frame times (ms). Pure, with hysteresis. */
export class QualityMonitor {
  constructor(initial: Quality);
  /** Feed one frame time; returns the quality to use now (may change at most once per 3 s window). */
  sample(frameMs: number, nowMs: number): Quality;
}
```

Rules:
- Ignore the first 1500 ms after construction (warm-up).
- Over each rolling 3000 ms window, compute the median frame time.
- "high" → "low" if the median is above 22 ms (below ~45 fps).
- "low" → "high" only if the median is under 12 ms for two consecutive windows.
- Never switch more than once per window.
- Once it has dropped to "low" twice, stay at "low" for the session (no oscillation).

- [ ] **Step 1: Failing tests** for each rule:
  - warm-up ignored;
  - 25 ms frames → low after one window;
  - 10 ms frames → back to high only after two windows;
  - alternating bad and good windows end pinned at "low" after the second drop;
  - a single 200 ms spike inside good frames doesn't drop.
- [ ] **Step 2: Implement** `QualityMonitor`.
- [ ] **Step 3: Renderer.**
  - Settings: `antialias: true`, `powerPreference: "high-performance"`, `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, exposure 1.0, pixel ratio `min(devicePixelRatio, 1.75)` on high and `1` on low.
  - Post-processing on "high" only: `EffectComposer` → `RenderPass` → `UnrealBloomPass(resolution/2, strength 0.55, radius 0.4, threshold 0.92)` → `OutputPass`. The bloom must catch the floodlight heads and LED boards only, not the court.
  - On "low": no composer, render directly; shadow map 1024; crowd count reduced (`Arena.setQuality`); bloom off.
  - `render()` feeds `QualityMonitor` with the real frame time and applies changes through a single `applyQuality(q)` method.
- [ ] **Step 4: Verify.** `pnpm shoot --out .shots/t6`: floodlights glow, the court is not washed out. Stats are within budget at high. Also add a `?quality=low` dev URL param that forces low. Shoot that too and confirm lower calls and triangles in `stats.json`. Report both sets of numbers.
- [ ] **Step 5:** Run the gate, then commit: `Add bloom, renderer tuning and automatic quality fallback`.

---

### Task 7: Rename to Meuss Padel Club, V2 screenshot in the README

**Files:**
- Modify: `packages/client/index.html`: `<title>Meuss Padel Club</title>`, the nickname card heading "Meuss Padel Club" (no 🎾 emoji), the loading text
- Modify: `packages/client/src/main.ts`: the HUD title reads "Meuss Padel Club"
- Modify: `CLAUDE.md`: title `# Meuss Padel Club` plus one line saying the old name was "Padel 2v2"
- Create: `docs/screenshots/v2.png`
- Modify: `README.md`: the V2 cell shows `![V2: the Pro Tour Broadcast arena](docs/screenshots/v2.png)` and the caption notes "V2 in progress: the arena and players are in; shots, sound and broadcast graphics come next."

- [ ] **Step 1:** Make the text changes above. Grep `packages/client` for `Padel 2v2` and `Padel — 2v2`. None may remain.
- [ ] **Step 2:** Run `pnpm shoot --spectator --wait 6000 --width 1600 --height 900 --out .shots/t7`. Pick whichever of player.png and spectator.png looks best, and copy it to `docs/screenshots/v2.png`. Optimize it with `sips -s format png` and keep it under 1.5 MB; resize to 1600 px wide if needed. It must be a real render of the game, never a generated image.
- [ ] **Step 3:** Update the README cell as specified. Run the gate, then commit: `Rename to Meuss Padel Club and add the first V2 screenshot`.
