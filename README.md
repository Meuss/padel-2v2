# Meuss Padel Club

A browser-based 2v2 online padel game: server-authoritative physics over
WebSockets, rendered with Three.js. The first four visitors play, everyone else
spectates.

**Play:** https://meuss.github.io/padel-2v2/

## V1 → V2

V2 is a full redesign built with **Claude Opus 5.5** (in Claude Code). It covers
the look, how hits feel, the netcode and the match flow.

| V1 | V2 |
|---|---|
| ![V1: the original game](docs/screenshots/v1.png) | *In progress. The real in-game screenshot arrives with the new arena.* |
| The original game. | Pro-tour broadcast look, Drive / Lob / Smash with Timing, client-side prediction, instant replays, a final card and a rematch vote. |

V2 lands in stages. The live link runs whatever stage is currently deployed. The
design target for V2 is in [docs/design/v2-comp-clean-feed.png](docs/design/v2-comp-clean-feed.png)
(a generated mockup, not a screenshot).

## Run locally

Requires Node 24 (see `.node-version`) and pnpm (the version is pinned in
`package.json` → `packageManager`; `corepack enable` picks it up).

```bash
pnpm install
pnpm dev          # client on http://localhost:5173, server on :8080
```

| Command | What it does |
|---|---|
| `pnpm dev` | Client + server with reload |
| `pnpm dev:client` / `pnpm dev:server` | One side only |
| `pnpm typecheck` | `tsc` in every package |
| `pnpm test` | Vitest, all packages |
| `pnpm build` | Production client build → `packages/client/dist` |

To test a full match alone, open the game and press `B` three times to add bots.

## How to play

| Input | Action |
|---|---|
| `WASD` / arrows | Move (relative to your side of the court) |
| Mouse | Aim |
| Click | Swing |
| `Space` | Serve. Bots never serve, so a human has to |
| `E` | Reaction emote |
| `B` / `N` | Add a bot / remove all bots |

- Everyone, spectators included, is kicked after **60 s** without mouse or keyboard
  activity.
- Any human player can start a **reset vote** to restart the match. It needs every
  human player to accept; one decline cancels it, and it expires after 30 s.
- Scoring follows modern padel: golden point at deuce, sets to 6 (win by 2),
  tiebreak at 6–6.

## Project layout

```
packages/
  shared/   protocol types, court & tuning constants, pure gameplay math
  server/   Node + ws + Rapier: room loop, physics, match rules, bots
  client/   Vite + Three.js: rendering, input, interpolation, HUD
```

- Gameplay tuning (ball speed, swing power, court size, scoring rules) lives in
  `packages/shared/src/constants.ts`.
- `@padel/shared` has no build step. Both sides import its TypeScript source
  directly.
- Rapier is pinned to exactly `0.18.0`: newer versions change how the ball
  bounces. See `CLAUDE.md` before upgrading it.

## Deploy

**Pushing to `master` deploys everything.** There is no staging environment.

| What | Where | Trigger |
|---|---|---|
| CI (typecheck, test, build) | GitHub Actions, `ci.yml` | Push to `master` and every pull request |
| Client | GitHub Pages, `deploy-pages.yml` | Push to `master`, or run it manually from the Actions tab |
| Server | Render free tier, `render.yaml` | Auto-deploys on push to the branch connected in Render (`master`) |

The Pages deploy does not wait for CI, so a broken `master` still ships.
Work on a branch and open a PR to get CI first.

### Configuration to remember

- **`VITE_SERVER_URL`**: GitHub repo **variable** (Settings → Secrets and
  variables → Actions → Variables), currently
  `wss://padel-2v2-server.onrender.com`. It is baked into the client at build
  time, so after changing it, re-run the Pages workflow. If it's missing, the
  client tries `ws://localhost:8080`.
- **`VITE_BASE`**: set automatically by the workflow to `/<repo-name>/`. Renaming
  the repo changes the Pages URL.
- **GitHub Pages source** must be set to "GitHub Actions" in the repo settings.
- **Render**: the service was created from `render.yaml` (New → Blueprint).
  Edits to that file apply on the next sync. The build runs
  `npx pnpm@<version>`, so **bump it there whenever `packageManager` changes**.
  Render provides `PORT`. Locally the server defaults to 8080.
- **Cold starts**: Render's free tier sleeps after ~15 min idle. The first visitor
  waits 30–60 s, and the client shows a "waking up" screen meanwhile. Health
  check: `GET /health`.
