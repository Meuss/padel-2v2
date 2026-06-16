# Padel 2v2

A browser-based 2v2 online padel game — server-authoritative physics over
WebSockets, rendered with Three.js. First four visitors play (2v2), everyone else
spectates.

![Padel 2v2](screenshot.png)

## Run locally

```bash
npm install
npm run dev   # client on :5173, server on :8080
```

Open http://localhost:5173.

**Controls:** `WASD` move · mouse to aim · click to swing · `Space` serve ·
`E` react · `B` add bot · `N` clear bots.

## Stack

TypeScript monorepo: Three.js + Vite client, Node + `ws` + Rapier server, shared
types and rules.

## Deploy

Client → GitHub Pages, server → Render (free), via
[`.github/workflows`](.github/workflows) and [`render.yaml`](render.yaml).
