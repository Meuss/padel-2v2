# Meuss Padel Club

Formerly named "Padel 2v2" (the old name may still appear in git history, the repo name and deploy URLs).

Browser 2v2 padel game. One global room: the first four connections play, everyone
else spectates. The **server is authoritative**: it runs physics, scoring and bots;
the client only sends input and renders interpolated snapshots.

pnpm workspace, Node 24 (`.node-version`). Scripts live in the root `package.json`;
`pnpm dev` runs client (:5173) and server (:8080) together. Before calling work done,
run `pnpm typecheck && pnpm test && pnpm build` (the same gate as CI).

## Packages

- `packages/shared`: wire protocol (`messages.ts`), court/tick constants
  (`constants.ts`, which also documents the coordinate system), and pure gameplay
  math (`gameplay.ts`). Ships TypeScript source with no build step: Vite
  (`packages/client/vite.config.ts`) and Vitest (`vitest.config.ts`) alias
  `@padel/shared` to `src/index.ts`, and the server reads it through `tsx`. If you
  add a new consumer, give it the same alias.
- `packages/server`: `index.ts` (HTTP `/health` + WebSocket dispatch) → `room.ts`
  (60 Hz fixed-step loop, slots, bots, votes, idle-kick) → `world.ts` (Rapier
  court + ball, surfaces contacts) and `match.ts` (rules: serve, faults, scoring,
  side changes).
- `packages/client`: `main.ts` (bootstrap, HUD/DOM), `net.ts` (socket + reconnect),
  `interp.ts` (snapshot buffer, renders `INTERP_DELAY_MS` behind), `scene.ts`
  (Three.js), `input.ts`.

## Conventions

- Relative imports use `.js` extensions (`./room.js`) and type-only imports use
  `import type`; `verbatimModuleSyntax` and `noUncheckedIndexedAccess` are on.
- Gameplay tuning goes in `shared/src/constants.ts`, the single source of truth
  for both sides. Pure logic belongs in `shared/src/gameplay.ts`, where it is unit
  testable without Rapier or the DOM.
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
  (`swingConnects`); only the ball is simulated.
- Reaction images live in `packages/client/public/reactions/<id>.png` and must
  match `REACTIONS` in `messages.ts`. The root `images/` folder holds the source
  copies.
- `pnpm shoot` (dev server running) renders the game in headless Chrome and writes screenshots + render stats to `.shots/`; use it to verify visual changes.
- Tests: `packages/**/test/*.test.ts`, run with Vitest from the root. `Room.create()`
  works headless with fake sockets (see `server/test/roster.test.ts`).

## Gotchas

- **Rapier is pinned to exactly `0.18.0`.** From 0.18.1 onwards, floor bounces
  lose about twice as much horizontal speed, so rallies die faster. Before
  upgrading, compare a fixed ball launch through `PhysicsWorld` across the two
  versions and retune friction/restitution in `world.ts` if needed.
- The "using deprecated parameters for the initialization function" log at server
  start comes from Rapier's `init()`. It is harmless.
- Bots never serve; a human must press Space. Run end-to-end checks with one real
  client plus bots (`B`).
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
