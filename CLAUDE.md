# Meuss Padel Club

Formerly named "Padel 2v2" (the old name may still appear in git history, the repo name and deploy URLs).

Browser 2v2 padel game. One global room: the first four connections play, everyone
else spectates. The **server is authoritative**: it runs physics, scoring and bots;
the client only sends input and renders interpolated snapshots.

pnpm workspace, Node 24 (`.node-version`). Scripts live in the root `package.json`;
`pnpm dev` runs client (:5173) and server (:8080) together. Before calling work done,
run `pnpm typecheck && pnpm test && pnpm build` (the same gate as CI).

## Packages

- `packages/shared`: ships TypeScript source with no build step. Vite
  (`packages/client/vite.config.ts`) and Vitest (`vitest.config.ts`) alias
  `@padel/shared` to `src/index.ts`, and the server reads it through `tsx`. If you
  add a new consumer, give it the same alias.
  - `messages.ts`: the wire protocol (protocol v5, `PROTOCOL_VERSION` in `constants.ts`).
  - `constants.ts`: court, tick and tuning constants; documents the coordinate system.
  - `court.ts`: `CAGE`, the regulation glass-and-mesh cage and the single source for
    both the server's colliders and the client's cage meshes. `netHeightAt(x)` (net sag)
    is shared the same way.
  - `gameplay.ts` (movement, `swingConnects`), `shots.ts` (Shot kinds, Timing, shot
    velocities, toss and serve math), `replay.ts` (which points are notable, clip
    length; used by the client's director and the server's bot toss hold),
    `names.ts` (nickname cleaning).
- `packages/server`: `index.ts` (HTTP: `/health`, and `GET /status` →
  `{ playing, watching }` for the join screen; WebSocket dispatch) → `room.ts` (60 Hz
  fixed-step loop, seats, Take seat, votes, idle-kick, replay hold) → `world.ts`
  (Rapier court + ball, contacts tagged by surface and cage material), `match.ts`
  (rules: serve, faults, scoring, side changes, fault highlights), `bots.ts` (Bot
  movement, Shots and serves), `stats.ts` (Final card stats), `history.ts` (ball
  history for lag-compensated hits) and `rng.ts` (seeded PRNG for bots).
- `packages/client`: `main.ts` (bootstrap and HUD wiring), `net.ts` (socket +
  reconnect), `interp.ts` (snapshot buffer, renders `INTERP_DELAY_MS` behind),
  `predict.ts` (local movement prediction), `events.ts` (releases snapshot Shots and
  contacts when the render time reaches them), `input.ts`, `scene.ts` (Three.js),
  `dev.ts` (dev query params, see below).
  - `world/`: the 3D scene: `arena`, `court`, `avatar`, `cameras`, `boards` (LED
    ribbon), `feedback` (Timing arc, trail, puffs), `faultfx` (fault animations),
    `selfmarker`, `quality` (auto fallback), `palette`.
  - `hud/`: DOM graphics: `scorebug`, `banner`, `finalcard`, `votepanel`, `controls`
    (card + legend), `join`, `overlays` (name tags, reactions, emote tray), `copy`
    (English broadcast copy), `glyphs`, `button`, `hud.css` (tokens).
  - `replay/`: Instant replay: `recorder`, `director` (pure), `player`, `controller`.
  - `audio/`: synthesized Web Audio (`engine`, `voices`); no sound files.
  - `public/models/` holds the CC0 player model, with its `SOURCE.md`.

## Conventions

- Relative imports use `.js` extensions (`./room.js`) and type-only imports use
  `import type`; `verbatimModuleSyntax` and `noUncheckedIndexedAccess` are on.
- Gameplay tuning goes in `shared/src/constants.ts`, the single source of truth
  for both sides. Pure logic belongs in `shared/src` (`gameplay.ts`, `shots.ts`,
  `replay.ts`), where it is unit testable without Rapier or the DOM.
- All copy is English broadcast copy; the Teams are AZUL / ROJO, the only non-English
  words. Client copy lives in `hud/copy.ts`, the server's event and fault reasons in
  `match.ts`. Terms follow `CONTEXT.md`.
- Changing a message: edit the types in `shared/src/messages.ts`, then handle it
  on both sides (server dispatch is in `server/src/index.ts`, client dispatch in
  `client/src/net.ts`). `PROTOCOL_VERSION` is sent on join; the server answers a
  mismatch with `outdated` and closes, and the client shows a reload screen. Bump
  it whenever the wire format changes.
- Movement input is in the **player's frame** (x = strafe, z = toward the net); the
  room maps it to world axes from the half the player currently defends, so it
  stays correct after ends-swaps. Use the `side` sign rather than the team.
- `stepPlayer()` in `shared/src/gameplay.ts` is the only movement integrator. The
  server applies one queued input per tick and echoes its `seq` as `ack`; the
  client predicts with the same function and replays unacked inputs
  (`client/src/predict.ts`). Change movement there, never on one side only.
- Players are not physics bodies. Hits are resolved by proximity
  (`swingConnects`); only the ball is simulated. A swing is judged against the ball
  the player saw: the room rewinds to the input's `view` (at most
  `LAG.maxRewindMs`) through `server/src/history.ts`, and misses if anyone has hit
  the ball since.
- One clock: snapshot `serverTime`, `InputMsg.view`, the ball history and every
  `now` given to `MatchEngine` are the room's simulated clock (`Room.serverTime`,
  `TICK_MS` per step), never `Date.now()`.
- Reaction images live in `packages/client/public/reactions/<id>.png` and must
  match `REACTIONS` in `messages.ts`. The root `images/` folder holds the source
  copies.
- `pnpm shoot` (dev server running) renders the game in headless Chrome (SwiftShader,
  slow) and writes screenshots + `stats.json` to `.shots/`; use it to verify visual
  changes. Flags: `--out dir`, `--wait ms`, `--width n --height n`, `--spectator` (adds a
  spectator page), `--autoserve` (the player serves by itself, so bots rally),
  `--quality high|low|auto`, `--no-join [--type text]` (the join screen), `--url u`, and
  `--query k=v&…` for the dev params read by `dev.ts`: `banner=<kind>`, `forceReplay=1`,
  `fault=<kind>[&faultAt=ms]`, `finalCard=1`, `controls=1`, `vote=reset|rematch`,
  `tray=1`, `joinView=loading|outdated`, `roomStatus=<playing>,<watching>`. All dev
  code sits behind `import.meta.env.DEV`. If the shared dev room is stuck in "over",
  reset it with a throwaway WebSocket client that joins and votes.
- Tests: `packages/**/test/*.test.ts`, run with Vitest from the root. `Room.create()`
  works headless with fake sockets (`server/test/fakes.ts`); `room.debugPlaceBall()`
  sets up a shot.

## Gotchas

- **Rapier is pinned to exactly `0.18.0`.** From 0.18.1 onwards, floor bounces
  lose about twice as much horizontal speed, so rallies die faster. Before
  upgrading, compare a fixed ball launch through `PhysicsWorld` across the two
  versions and retune friction/restitution in `world.ts` if needed.
- The "using deprecated parameters for the initialization function" log at server
  start comes from Rapier's `init()`. It is harmless.
- Serves are a toss (Space) then a click at the top of the toss; Bots serve
  automatically with perfect timing. Run end-to-end checks with one real client
  plus bots (`B`).
- Under `pnpm shoot` (SwiftShader) the join screen's `/status` reading usually times
  out behind the first render, so it shows the default room line; real browsers get
  the counts.
- The server deliberately ignores the per-frame `input` stream for idle detection.
  Only explicit messages (`activity`, `react`, votes, bot commands) reset the 60 s
  idle-kick timer.
- pnpm blocks dependency build scripts by default. Allow new ones in
  `allowBuilds` in `pnpm-workspace.yaml`.

## Deploy

- Client → GitHub Pages (`.github/workflows/deploy-pages.yml`). The build needs
  `VITE_BASE=/<repo>/` and `VITE_SERVER_URL` (a `wss://` URL, set as a repo
  variable). Without it the client falls back to `ws://localhost:8080`.
- Server → Render free tier (`render.yaml`). It sleeps when idle; the client's
  loading screen covers the 30–60 s wake-up. Render's bundled pnpm is unpinned, so
  `buildCommand` runs `npx pnpm@<version>`. **Keep that version equal to
  `packageManager` in the root `package.json`.**
- When `PROTOCOL_VERSION` changes, redeploy the server (Render) before or together
  with the client (Pages). A newer client talking to an older server is rejected or
  mispredicts, and old cached clients loop on reconnect until reloaded.
