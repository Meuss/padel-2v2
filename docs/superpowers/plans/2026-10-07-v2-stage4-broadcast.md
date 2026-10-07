# V2 Stage 4 (Broadcast layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the match in TV graphics and a complete match flow:
- a pro-tour score bug matching the approved comp, with the Score call;
- the between-point Banner;
- an Instant replay of notable points;
- nickname tags only between points, plus your own marker;
- the Final card with stats and an automatic Rematch vote;
- a "Take seat" button for spectators;
- every leftover V1 HUD element (debug status box, top scoreboard, flash text, nickname card, loading card) replaced with the broadcast language.

The stage ends with the real V2 screenshots, the impeccable finish review and DESIGN.md.

**Architecture:**
- **Server:** match events become structured (`eventKind`, `eventTeam`), with Azul/Rojo text. The server also adds match stats, the automatic Rematch vote, Take seat and a replay-skip relay (protocol v4).
- **Client:** the HUD moves out of `main.ts` into `packages/client/src/hud/`. Each module owns its own DOM, has a small pure view-model function that is unit tested, and draws its tokens from one stylesheet, `hud/hud.css`, which Vite imports. Replays are recorded client-side from snapshots and played back through the Broadcast cam.

**Tech Stack:** TypeScript, DOM/CSS (no framework), three.js 0.186, Vitest, and Google Fonts (Barlow Condensed) loaded in `index.html`.

**Spec:** `docs/superpowers/specs/2026-10-07-v2-redesign.md` (stage 4). Comps:
- `docs/design/v2-comp-clean-feed.png`: the in-rally layout, with the score bug in the bottom-left;
- `.impeccable/mocks/comp-3-between-points.png`: the Banner and REPLAY tag. Copy it to `docs/design/v2-comp-between-points.png` in Task 4.

Glossary: `CONTEXT.md`.

## Global Constraints

- Gate: `pnpm typecheck && pnpm test && pnpm build`. Bump `PROTOCOL_VERSION` to **4** in Task 1.
- **Copy:** Spanish broadcast vocabulary for match graphics. The Teams are AZUL and ROJO. Score words are NADA / QUINCE / TREINTA / CUARENTA / IGUALES / PUNTO DE ORO / JUEGO / SET Y PARTIDO / FALTA / DOBLE FALTA / LET / REPETIR. UI chrome stays in English: buttons, prompts, the nickname screen and the loading screen. _Superseded 2026-10-08: English copy except team names._
- **Design tokens** live in `packages/client/src/hud/hud.css` as CSS custom properties on `:root`:

  | Token | Value |
  |---|---|
  | `--bug-navy` | `#0f1a33` |
  | `--bug-navy-2` | `#16244a` |
  | `--bug-white` | `#f4f7ff` |
  | `--bug-ink` | `#0b1020` |
  | `--azul` | the Azul kit colour from `world/palette.ts` |
  | `--rojo` | `#d8383a` |
  | `--optic` | `#e4f23a` (serve dot and accent lines only) |
  | `--font-broadcast` | `"Barlow Condensed", "Arial Narrow", sans-serif` |
  | `--font-ui` | `system-ui, -apple-system, "Segoe UI", sans-serif` |

  Weights are 600 and 700 only. Numbers use tabular figures (`font-variant-numeric: tabular-nums`).
- **No user text through `innerHTML`.** Nicknames reach the DOM through `textContent` or `append(string)` only.
- **The rally screen stays clean.** During `phase === "rally"`, only the score bug, your own marker, the Timing arc and reactions show. No banners, tags or prompts.
- **Desktop only.** The layout must hold from 1280×720 to 2560×1440. Size the HUD with `clamp()` and `vh`/`vw`.
- **Verify with `pnpm shoot`:** use `--autoserve` for rallies and `--spectator` for the spectator view. Look at every screenshot.

## Review Focus

- **A Take seat request mid-rally:** it is queued and applied at the next point break, with no teleport mid-point. If a human takes the seat first, the queued request is dropped (Task 1 test).
- **A rematch while some humans have left:** the vote only counts the humans still seated, and the bots don't vote (Task 1 test).
- **A replay that is still playing when the serve toss starts:** it cuts immediately to live and the toss is visible (Task 5 test of the pure replay state machine).
- **A very long nickname or an emoji name on the Final card or name tags:** it is truncated with an ellipsis and never breaks the layout (Task 6 screenshot with a 16-character name).
- **Window resize mid-match (1280 → 2560 wide):** the score bug keeps its bottom-left anchoring and proportions (Task 3 screenshot at both sizes).

---

### Task 1: Server match flow for the broadcast layer (protocol v4)

**Files:**
- `packages/shared/src/messages.ts`:
  - `MatchMsg` gains `eventKind: MatchEventKind | null`, `eventTeam: Team | null` and `stats: MatchStats | null` (set when phase is `over`);
  - `PlayerInfo` gains `isBot: boolean`;
  - `RosterMsg` gains `seatOpen: boolean`;
  - `VoteMsg` gains `kind: "reset" | "rematch"`;
  - new client message `TakeSeatMsg { t: "takeseat" }`;
  - new client message `SkipReplayMsg { t: "skipreplay" }`;
  - new server message `ReplaySkipMsg { t: "replayskip" }`;
  - constants: `PROTOCOL_VERSION = 4`.
- `packages/server/src/match.ts`: set `eventKind` and `eventTeam` everywhere `event` is set, and change the `event` text to Spanish broadcast copy _(superseded 2026-10-08: English copy except team names)_:

  | Situation | `event` | `eventKind` |
  |---|---|---|
  | point won | `PUNTO — AZUL` | `"point"` |
  | game won | `JUEGO — AZUL` | `"game"` |
  | set won | `SET Y PARTIDO — AZUL` | `"set"` |
  | first-serve fault | `FALTA` | `"fault"` |
  | double fault | `DOBLE FALTA` | `"fault"`, with eventTeam = the team that won the point |
  | let | `LET` | `"let"` |
  | match start | `PARTIDO` | `"start"` |
  | set reset | `REINICIO` | `"reset"` |

  Remove `TEAM_NAME` (Blue/Red).
- `packages/server/src/stats.ts` (new): `MatchStatsTracker`, fed with shot events and points.
- `packages/server/src/room.ts`: when the match goes `over`, open a vote of kind "rematch" (all seated humans, 45 s timeout); when it passes, `resetMatch`. Add `takeSeat(clientId)`, `skipReplay(clientId)`, roster `isBot` and `seatOpen`. Feed the stats tracker.
- `packages/server/src/index.ts`: dispatch `takeseat` and `skipreplay`.
- `packages/client/src/net.ts`: dispatch `replayskip` (`onReplaySkip`).
- Client compile fixes only:
  - `main.ts` cheer and celebrate use `eventKind`/`eventTeam`;
  - `audio/` `crowdReaction` maps from `eventKind` (point, game or set → cheer; fault → ooh), not from the English event text;
  - delete `teamFromEvent` from `boards.ts` and its test;
  - `boardMessages` gets team names from its state as now;
  - grep the client for `"Point"`, `"Game"`, `"Set & Match"`, `"Fault"`, `Blue` and `Red`: nothing may still parse event text.
- Carried over from stage 3 (controller ruling):
  - before adding the new flow, move the bot logic out of `room.ts` into `packages/server/src/bots.ts` (`updateBots`, swing timing, aim, serve), a pure refactor with tests unchanged and green. Then, as a separate commit, aim bot Smashes down the middle (|x| ≤ 1.5) so early Smashes stop ending on the side glass on the full;
  - on Welcome, the client resets the feedback trail and ground marker (`scene.resetFeedback()`);
  - the audio rally counter resets on `eventKind` (any kind ends a rally) rather than on the serve phase.
- Tests: `packages/server/test/flow.test.ts`

**Interfaces:**

```ts
export type MatchEventKind = "point" | "game" | "set" | "fault" | "let" | "start" | "reset";
export interface TeamStats { shots: number; perfect: number; smashes: number; points: number }
export interface MatchStats { A: TeamStats; B: TeamStats; longestRally: number; durationS: number }
```

Rules:
- **Take seat.** `takeSeat(clientId)` applies only to a connected client with no seat. If a seat is free, or held by a Bot, and the phase is not `"rally"`, seat the client at once: remove that Bot, fill its slot, send a fresh `WelcomeMsg` with `role: "player"`, and broadcast the roster. During a rally, remember the request and apply it at the next non-rally tick. Prefer a free seat over a Bot seat, and among Bot seats prefer the team with fewer humans.
- **seatOpen** is true when a seat is free or held by a Bot.
- **Rematch vote.** It is the existing vote machinery with `kind: "rematch"` and initiator "MEUSS PADEL CLUB". It needs every seated human, and bots don't vote. On timeout nothing happens: the match stays `over`, and any player can still start a reset vote.
- **skipReplay(clientId)** applies to seated players only, rate-limited to one per second. It broadcasts `{t:"replayskip"}`.

- [ ] **Step 1: Failing tests** in `flow.test.ts`, using the existing fakes:
  - events carry `eventKind`/`eventTeam` (play a point with bots and assert `"point"` and the winner);
  - stats count shots and longest rally;
  - a match that ends opens a rematch vote with `kind: "rematch"`, and its acceptance resets the match;
  - take-seat replaces a bot between points; the same request during a rally is deferred until the point ends;
  - `seatOpen` toggles;
  - `skipreplay` from a spectator is ignored, and from a player it is broadcast.

  Add `room.debugEndMatch(winner)`, test-only, to reach `over` quickly.
- [ ] **Step 2:** Implement. Run the tests, then the gate, then commit: `Broadcast match flow: structured events, stats, rematch vote, take seat (protocol v4)`.

---

### Task 2: HUD foundation (module split, tokens, fonts, cleanup)

**Files:**
- Create: `packages/client/src/hud/hud.css` (tokens plus the shared HUD primitives), imported from `main.ts`
- Create: `packages/client/src/hud/copy.ts`, the pure Spanish broadcast copy _(superseded 2026-10-08: English except team names)_, with `scoreCall`, `bannerFor` and `teamLabel`
- Test: `packages/client/test/copy.test.ts`
- Modify: `packages/client/index.html`:
  - add `<link rel="preconnect">` plus the Google Fonts stylesheet for Barlow Condensed 600/700 with `display=swap`;
  - move the inline `<style>` rules for elements that later tasks replace into `hud.css`, or delete them;
  - remove the `#hud` debug box markup.
- Modify: `packages/client/src/main.ts`:
  - delete `renderHud` and the debug status box;
  - add a small connection indicator (a dot plus "Reconnecting…", top-left, shown only when not `open`);
  - add a "N watching" pill (top-right, spectators count, hidden when 0);
  - restyle the controls hint into a single subtle bottom-centre line that fades out after the first serve or 12 s;
  - the "Reset set" button becomes a small ghost button top-right, under the watching pill.

**Interfaces (exact):**

```ts
/** Spanish score call, server's score first. pointServer/pointReceiver are MatchMsg point labels. */
export function scoreCall(pointServer: string, pointReceiver: string, tiebreak: boolean): string;
// "0"→"NADA","15"→"QUINCE","30"→"TREINTA","40"→"CUARENTA"; equal non-40 → "<X> IGUALES"; "40"-"40" → "PUNTO DE ORO";
// tiebreak → "<a> – <b>" with digits; otherwise "<SERVER> – <RECEIVER>" with an en dash.
export interface BannerCopy { title: string; sub: string | null; tone: "team" | "fault" | "neutral"; team: Team | null }
export function bannerFor(kind: MatchEventKind, team: Team | null, gamesA: number, gamesB: number, reason: string | null): BannerCopy | null;
// point → null (points don't get a banner, only the score bug updates + Score call),
// game → {title:"JUEGO", sub:"AZUL 4 – 3 ROJO"}, set → {title:"SET Y PARTIDO", sub: winner line},
// fault → {title:"FALTA" | "DOBLE FALTA", sub: reason}, let → {title:"LET", sub:"REPETIR SAQUE"},
// start → {title:"PARTIDO", sub:"AZUL vs ROJO"}, reset → {title:"REINICIO", sub:null}
export function teamLabel(t: Team): "AZUL" | "ROJO";
```

The golden-point Banner ("PUNTO DE ORO") is computed by Task 4 from the score state, not from an event.

- [ ] **Step 1:** Write failing tests for `scoreCall`, covering every mapping row, the server-first order, deuce → PUNTO DE ORO, tiebreak digits and the 0-0 → "NADA IGUALES" edge. Also `bannerFor`, covering every kind, and `teamLabel`.
- [ ] **Step 2:** Implement `copy.ts`. Create `hud.css` with the tokens and primitives: a `.bug-panel` base, the condensed type scale (`--t-xs` to `--t-xl` with `clamp`), and a `.ghost-btn`. Then do the cleanup above.
- [ ] **Step 3:** Run `pnpm shoot --spectator --out .shots/s4t2`. The debug box should be gone, the watching pill visible on the spectator page, and nothing broken. Run the gate, then commit: `HUD foundation: broadcast tokens, Spanish copy, remove the V1 debug HUD`.

---

### Task 3: The score bug and the Score call

**Files:**
- Create: `packages/client/src/hud/scorebug.ts`
- Test: `packages/client/test/scorebug.test.ts` (the view model)
- Modify: `main.ts` replaces `renderScoreboard`, `renderServing` and the serve prompt with the score bug and a lower-third prompt. Delete the old `#scoreboard` and `#serving` elements.

**Design:** measure it from `docs/design/v2-comp-clean-feed.png`, where the bug sits bottom-left on a 1376×768 frame.

- **Anchor:** `left: 4.9vw; bottom: 4.6vh`.
- **Width:** about 18.2vw, with a minimum of 260px.
- **Header strip:** `--bug-white` background, `--bug-ink` text, "MEUSS PADEL CLUB" set in `--font-broadcast` 700, uppercase, letter-spacing 0.04em. Its height is about 3.1vh.
- **Two team rows**, each about 4.2vh tall, on a `--bug-navy` background, laid out left to right as:
  - a 0.35vw team-colour bar (`--azul`/`--rojo`);
  - a serve-dot slot, a 0.7vh `--optic` dot on the serving team;
  - the team name, AZUL/ROJO in white, 700;
  - a games cell on `--bug-navy-2` with white tabular digits;
  - a points cell on `--bug-white` with `--bug-ink` tabular digits, holding the MatchMsg point label (`"Ad"` never occurs with the golden point).
- **Tiebreak:** the points cell shows tiebreak points, and a small "TB" tag sits in the header.
- **Score call:** after every point, a thin strip under the bug (the same width, `--bug-navy` at 92% opacity, white condensed caps) shows `scoreCall(...)` for 2.5 s. It slides up 6px and fades in over 150 ms.
- **Value changes:** changed cells flash their background slightly brighter for 300 ms. No scaling bounce.
- **Phases:** in warm-up, the bug shows "CALENTAMIENTO" in place of the rows. When the match is over, the header reads "FINAL".

**Interface:**

```ts
export interface BugRow { team: Team; label: "AZUL" | "ROJO"; games: number; points: string; serving: boolean }
export interface BugModel { header: string; tiebreak: boolean; rows: [BugRow, BugRow] | null; call: string | null }
export function bugModel(m: MatchMsg | null, prev: MatchMsg | null): BugModel; // pure; call set when a point was just won
export class ScoreBug { constructor(root: HTMLElement); render(model: BugModel): void }
```

- **Serve prompt:** a lower-third pill, bottom-centre, `--bug-navy` with an optic accent line at the top.
  - The server sees "PRESS SPACE TO TOSS" and, while tossing, "CLICK TO SERVE".
  - Others see "<NAME> TO SERVE", with the name from the roster via `textContent`.
  - It is hidden during the rally.

- [ ] **Step 1:** Write failing tests for `bugModel`: warm-up, a normal score, the serving flag, tiebreak, `over` → "FINAL", and `call` present only on the transition where a point was won, computed with the server's score first.
- [ ] **Step 2:** Implement and wire it. Run `pnpm shoot --autoserve --out .shots/s4t3` and also `--width 2560 --height 1440 --out .shots/s4t3-big`. Compare the bug against the comp's bottom-left crop and against both sizes. Run the gate, then commit: `Pro-tour score bug with the Spanish score call`.

---

### Task 4: Banner, name tags between points, own marker

**Files:**
- Create: `packages/client/src/hud/banner.ts`
- Copy: `.impeccable/mocks/comp-3-between-points.png` → `docs/design/v2-comp-between-points.png`
- Modify: `main.ts`: replace `maybeFlash` and the `#flash` element with the Banner; tags are visible only when `phase !== "rally"`
- Modify: `packages/client/src/scene.ts` / `world/`: `setSelfMarker(slot | null)` draws a subtle ring (team colour at 55% opacity plus a small chevron) under the local player
- Test: `packages/client/test/banner.test.ts` (pure timing and queue logic)

**Banner design (from comp 3):**
- A lower-third band centred horizontally, about 56vw wide, with its bottom at 12vh.
- The top band is `--bug-navy` with a 0.35vh `--optic` line on top. The title is in white `--font-broadcast` 700 at about 7.5vh, letter-spaced.
- The sub-band below it is `--bug-navy-2` with the sub line at about 3.4vh.
- `tone: "team"` adds a 0.6vw team-colour block at the left edge. `tone: "fault"` uses `--rojo` for the optic line.
- **Motion:** it wipes in from left to right over 220 ms (a `clip-path` inset transition), holds, and wipes out over 180 ms. Respect `prefers-reduced-motion` with a fade instead.
- **Duration:** 1.6 s for fault and let, 2.2 s for game, start and reset; the Set Banner stays until the Final card appears.
- **PUNTO DE ORO:** when a point makes the score 40–40 (golden point), show the Banner `{title: "PUNTO DE ORO", sub: "AZUL 40 – 40 ROJO", tone: "neutral"}`.
- **Queue:** when a new Banner arrives while one is showing, it replaces it, never stacks.

```ts
export interface BannerItem { copy: BannerCopy; durationMs: number }
export class BannerQueue { show(item: BannerItem, nowMs: number): void; current(nowMs: number): BannerItem | null } // pure
```

- **Name tags:** reuse the existing label DOM, restyled as small condensed caps on `--bug-navy` with a team-colour underline. They show only outside rallies and fade over 200 ms.
- **Own marker:** always visible in Player cam, hidden in Broadcast cam.

- [ ] **Step 1:** Write failing tests for `BannerQueue`: replace, never stack, expiry, and the durations per kind.
- [ ] **Step 2:** Implement, then run `pnpm shoot --autoserve --wait 9000 --out .shots/s4t4`. Shoot until one PNG catches a Banner, up to 3 tries; the dev param `?banner=JUEGO` that forces a Banner may help. Compare it with comp 3. Run the gate, then commit: `Between-point Banner, name tags only between points, own marker`.

---

### Task 5: Instant replay

**Files:**
- Create: `packages/client/src/replay/recorder.ts`: keeps the last 8 s of snapshots (shallow copies) plus shot events, and marks point starts at the serve ShotEvent
- Create: `packages/client/src/replay/director.ts`: a pure state machine deciding whether and what to replay
- Create: `packages/client/src/replay/player.ts`: drives the scene from recorded snapshots
- Test: `packages/client/test/replay.test.ts`
- Modify: `main.ts`, `scene.ts`: while replaying, render recorded positions with the Broadcast cam and a REPLAY tag; live input still flows; a `replayskip` from the server ends it

**Rules:**
- A point is **notable** when:
  - its rally had at least 6 shots; or
  - the point-winning team's last shot was a Smash; or
  - it was the golden point; or
  - it was the set point that ended the match.
- The replay starts 1.0 s after the point ends, after the Banner's entry. It plays the point from 0.6 s before its last 4 s up to the end, so at most 4.5 s, at 0.85× speed.
- It ends on any of the following:
  - the end of the clip;
  - `replayskip` from the server;
  - the phase becoming `serve` with `tossing: true`;
  - the phase becoming `"rally"`.
- **Skip:** a seated player presses **Enter** to skip, which sends `skipreplay`. It is not Space, so serving still works. The tag shows "REPLAY · ENTER TO SKIP" for players, and only "REPLAY" for spectators.
- **REPLAY tag:** top-right, `--rojo` with a small white dot and condensed 700 caps, as in comp 3.
- A replay never starts while a replay or the Final card is showing.

```ts
export type DirectorState = { mode: "live" } | { mode: "replay"; fromMs: number; toMs: number; startedAtMs: number };
export function isNotable(p: { shots: number; lastWinnerShot: ShotKind | null; goldenPoint: boolean; matchPoint: boolean }): boolean;
export function nextState(s: DirectorState, ev: DirectorEvent, nowMs: number): DirectorState; // pure
```

- [ ] **Step 1:** Write failing tests:
  - `isNotable` for each rule;
  - `nextState`:
    - live goes to replay on a notable point end, after the delay;
    - a toss cuts it, a skip ends it, and a rally start ends it;
    - no replay starts over the Final card;
  - the recorder keeps 8 s and drops older frames.
- [ ] **Step 2:** Implement and wire it. Verify with `pnpm shoot --autoserve --spectator --wait 20000 --out .shots/s4t5`, shooting up to 3 times to catch a replay; add a `?forceReplay=1` dev param if needed. Run the gate, then commit: `Instant replay of notable points through the broadcast camera`.

---

### Task 6: The Final card and the Rematch vote; vote panel and emote bar restyle

**Files:**
- Create: `packages/client/src/hud/finalcard.ts`
- Test: `packages/client/test/finalcard.test.ts` (the view model)
- Modify: `main.ts` `renderVote`, restyled into the broadcast language (a lower-third, no innerHTML); the `#reactbar` restyle

**Final card:**
- A centred broadcast card about 46vw wide, appearing 1.2 s after the Set Banner.
- The header strip is `--bug-white` with "SET Y PARTIDO".
- The winner line is "AZUL GANA" (or "ROJO GANA") at about 6vh in the team colour.
- The set score is shown as large tabular digits "6 – 4".
- Under it are the winner team's names, then a 3-row stats table, Azul vs Rojo, with these rows:

  | Row | Value per team |
  |---|---|
  | GOLPES PERFECTOS | perfect/shots as a % |
  | REMATES | smashes |
  | RALLY MÁS LARGO | one shared number, longestRally |

- The footer is the Rematch vote: "¿REVANCHA?", an accept count, an "Accept" button (primary, optic outline) and "Decline" (ghost). Spectators see "Waiting for the players…".
- When the vote passes, the card wipes out and a "PARTIDO" Banner shows.

```ts
export interface FinalModel { winner: Team; setScore: [number, number]; names: string[]; rows: { label: string; a: string; b: string }[] }
export function finalModel(m: MatchMsg, names: Map<Slot, { name: string; team: Team }>): FinalModel | null; // null unless over with stats
```

- **Vote panel (reset or rematch):** a lower-third in the Banner style. The initiator's name goes through `textContent`. The title is "¿REINICIAR EL SET?" or "¿REVANCHA?".
- **Emote bar:** a horizontal tray on `--bug-navy`, bottom-centre above the hint, holding 8 reactions with a hover lift of 2px. E still toggles it.

- [ ] **Step 1:** Write failing tests for `finalModel`: null when not over, the percentages rounded, names truncated to 14 characters with an ellipsis, and the winner from stats/games.
- [ ] **Step 2:** Implement. Verify with the dev param `?finalCard=1`, which renders the card with synthetic stats (dev only), then `pnpm shoot --out .shots/s4t6`. Also use a 16-character nickname via `?join=ABCDEFGHIJKLMNOP` to check truncation. Run the gate, then commit: `Final card with match stats and the rematch vote; broadcast vote panel and emote tray`.

---

### Task 7: Take seat; the nickname and loading screens

**Files:**
- Modify: `main.ts`. For spectators with `roster.seatOpen`, show a "TAKE SEAT" primary button (bottom-right, above the watching pill) that sends `takeseat`. After clicking, it shows "Joining next point…" until the Welcome with `role: "player"` arrives.
- Modify: `index.html` and `hud.css`. Restyle the nickname and loading screens into the broadcast language:
  - a full-screen `--bug-navy` gradient over a blurred render of the arena behind (the live scene already renders behind the overlay, so use `backdrop-filter: blur(6px)` on a translucent navy);
  - a wordmark "MEUSS PADEL CLUB" in `--font-broadcast` 700, very large and tracked, with a thin optic rule under it;
  - the nickname field and a primary "Play" button;
  - the loading state with the same wordmark, a slim indeterminate bar instead of the spinner, and the existing explanation copy for the free-tier wake-up;
  - the "New version" reload state keeps working.

- [ ] **Step 1:** Implement. Verify with `pnpm shoot --spectator --out .shots/s4t7`. The spectator page should show the Take seat button when a bot holds a seat (the first page adds 3 bots, so seats are bot-held). Also screenshot the nickname screen by loading without `?join`; add `--no-join` to shoot if needed. Run the gate, then commit: `Take seat for spectators; broadcast-style nickname and loading screens`.

---

### Task 8: Finish: V2 screenshots, docs, finish review, DESIGN.md

**Files:**
- `docs/screenshots/v2.png`: the in-rally player view with the score bug, a real render via `pnpm shoot --autoserve`.
- `docs/screenshots/v2-broadcast.png`: a spectator view, ideally catching a Banner or REPLAY.
- `README.md`: in the V1 → V2 table the V2 cell shows `v2.png`; a second row shows `v2-broadcast.png`. Replace the "in progress" caption with the shipped feature list, kept short and factual. Update "How to play":
  - left-click Drive, right-click Lob, Smash automatic;
  - Space tosses, click to serve;
  - Enter skips a replay;
  - M mutes;
  - E reacts;
  - Take seat.
- `CLAUDE.md`: the hud/ and replay/ modules, and that protocol v4 carries structured events.
- `CONTEXT.md`: check every glossary term against what shipped. Add "Score bug" and "Watching pill" only if they are domain terms; otherwise leave them out.

- [ ] **Step 1:** Make the screenshots and doc updates. Run the gate, then commit: `Final V2 screenshots and docs`.
- [ ] **Step 2: Controller-run finish.** The controller, not the implementer, runs the impeccable finish review (`impeccable-finish-reviewer`) against the direction contract and both comps, then the documenter (`impeccable-documenter`), which writes `DESIGN.md`. Fixes from the review go into one batch.
