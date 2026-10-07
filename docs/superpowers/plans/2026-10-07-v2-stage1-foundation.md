# V2 Stage 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the V1 game safe, responsive and ready for the V2 redesign. This covers V1/V2 framing in the README, nickname sanitising, bot control limited to seated players, a court built only once, protocol version enforcement, and client-side prediction for the local player.

**Architecture:** The server stays authoritative. Movement becomes deterministic and shared: `stepPlayer()` in `@padel/shared` is the only movement integrator. The server consumes exactly one queued input per 60 Hz tick and reports the last applied input `seq` as `ack` in each snapshot. The client sends inputs on the same fixed 60 Hz clock, applies them locally through `stepPlayer()`, and reconciles on each snapshot by replaying the unacknowledged inputs. A decaying offset smooths small corrections.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`), pnpm workspace, Vitest, Node 24 + `ws` + Rapier 0.18.0 (server), Vite + Three.js (client).

**Spec:** `docs/superpowers/specs/2026-10-07-v2-redesign.md` (stage 1). Glossary: `CONTEXT.md`. Product: `PRODUCT.md`.

## Global Constraints

- Gate before calling any task done: `pnpm typecheck && pnpm test && pnpm build` (the same gate as CI).
- Relative imports use `.js` extensions; type-only imports use `import type` (or inline `type` specifiers).
- Gameplay tuning lives in `packages/shared/src/constants.ts`. Pure logic lives in `packages/shared/src/` so it can be unit tested without Rapier or the DOM.
- Changing a message means editing `packages/shared/src/messages.ts` and handling it in both `packages/server/src/index.ts` and `packages/client/src/net.ts`.
- Movement input is in the player's frame (x = strafe, z = toward the net). Map it with the `side` sign, never the team.
- Rapier stays pinned at exactly `0.18.0`. Do not touch dependencies in this stage.
- Nickname maximum: 16 characters (the client `maxlength` is already 16).
- Any user-supplied text (nicknames) reaches the DOM only through `textContent` or `append(string)`, never `innerHTML`.
- User-facing team names: **Azul / Rojo**. Code identifiers `"A" | "B"` stay as they are in this stage.
- The README must not say which model or tool built V1. V2 is "built with Claude Opus 5.5".

## Review Focus

- **Ends swap during a rally or between games:** the local player must not jump or slide across the court. The predictor uses the side passed at reconcile time (test in Task 6).
- **Hidden tab, then return:** the client must not send a burst of hundreds of inputs. At most `MAX_STEPS_PER_FRAME` steps run per frame and the backlog is dropped (test in Task 6).
- **Reconnect mid-match:** pending predicted inputs are discarded, the court is not built twice, and the player is placed at the server's position (predictor reset test in Task 6, scene check in Task 3).
- **Hostile or odd nicknames** (`<img src=x onerror=…>`, 40 emoji, control characters, only spaces): they are shown literally, capped at 16 code points, and fall back to a default name (tests in Task 2).
- **Serve lock:** while you are the server waiting to serve, WASD must not move you locally and then snap back. The predictor honours `locked` (test in Task 6, manual check in Task 6 step 9).

---

### Task 1: V1/V2 framing in the README, and repo hygiene

**Files:**
- Move: `screenshot.png` → `docs/screenshots/v1.png`
- Create: `docs/design/v2-comp-clean-feed.png` (copy of `.impeccable/mocks/comp-1-minimal.png`)
- Modify: `README.md` (title and screenshot block, lines 1–9)
- Modify: `.gitignore`
- Modify: `docs/superpowers/specs/2026-10-07-v2-redesign.md` (comp path)
- Commit as well: `PRODUCT.md`, `CONTEXT.md`, `.impeccable/config.json`, `docs/superpowers/`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/screenshots/v1.png`, which Stage 2 sits next to with `docs/screenshots/v2.png`.

- [ ] **Step 1: Move the V1 screenshot and copy the approved comp**

```bash
mkdir -p docs/screenshots docs/design
git mv screenshot.png docs/screenshots/v1.png
cp .impeccable/mocks/comp-1-minimal.png docs/design/v2-comp-clean-feed.png
```

- [ ] **Step 2: Replace the README header (lines 1–9, from `# Padel 2v2` through the `![Padel 2v2](screenshot.png)` line) with:**

```markdown
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
```

- [ ] **Step 3: Append to `.gitignore`**

```gitignore
# Impeccable design tooling: local working files (approved comp is copied to docs/design/)
.impeccable/mocks/
.impeccable/review/
.impeccable/build/
.impeccable/live/
```

- [ ] **Step 4: Point the spec at the committed comp copy.** In `docs/superpowers/specs/2026-10-07-v2-redesign.md`, change ``**Approved layout comp:** `.impeccable/mocks/comp-1-minimal.png` `` to ``**Approved layout comp:** `docs/design/v2-comp-clean-feed.png` (local working copy: `.impeccable/mocks/comp-1-minimal.png`) ``.

- [ ] **Step 5: Verify the README renders the image paths**

Run: `ls docs/screenshots/v1.png docs/design/v2-comp-clean-feed.png && grep -n "screenshot.png" README.md || echo "no stale refs"`
Expected: both files are listed and the output ends with `no stale refs`.

- [ ] **Step 6: Run the gate**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all three pass, with nothing changed in code.

- [ ] **Step 7: Commit**

```bash
git add README.md .gitignore docs/ PRODUCT.md CONTEXT.md .impeccable/config.json
git commit -m "Frame the V2 redesign: V1/V2 README section, product record, glossary, spec and plan"
```

---

### Task 2: Nickname sanitising and DOM-safe rendering

**Files:**
- Modify: `packages/shared/src/constants.ts` (add `NAME_MAX_LENGTH`)
- Create: `packages/shared/src/names.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/names.test.ts`
- Modify: `packages/server/src/index.ts:60` (name assignment)
- Modify: `packages/client/src/main.ts` (`renderVote`, `maybeFlash`, `play`)

**Interfaces:**
- Consumes: nothing.
- Produces: `NAME_MAX_LENGTH: 16` and `sanitizeName(raw: unknown, fallback: string): string`, both exported from `@padel/shared`.

- [ ] **Step 1: Write the failing test** `packages/shared/test/names.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { NAME_MAX_LENGTH, sanitizeName } from "../src/index.js";

describe("sanitizeName", () => {
  it("keeps markup literally (escaping is the renderer's job)", () => {
    expect(sanitizeName("<b>x</b>", "F")).toBe("<b>x</b>");
  });

  it("trims and collapses whitespace", () => {
    expect(sanitizeName("  Ana \t  Lopez  ", "F")).toBe("Ana Lopez");
  });

  it("strips control and bidi-override characters", () => {
    expect(sanitizeName("Ro\u0000g‮er\n", "F")).toBe("Roger");
  });

  it("caps at NAME_MAX_LENGTH code points without splitting emoji", () => {
    const out = sanitizeName("😀".repeat(40), "F");
    expect(Array.from(out)).toHaveLength(NAME_MAX_LENGTH);
    expect(out).toBe("😀".repeat(NAME_MAX_LENGTH));
  });

  it("falls back when nothing usable is left", () => {
    expect(sanitizeName("   ", "Player c7")).toBe("Player c7");
    expect(sanitizeName(undefined, "Player c7")).toBe("Player c7");
    expect(sanitizeName(42, "Player c7")).toBe("Player c7");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/shared/test/names.test.ts`
Expected: FAIL (`sanitizeName` / `NAME_MAX_LENGTH` is not exported).

- [ ] **Step 3: Implement.** Add to `packages/shared/src/constants.ts`, after `MAX_PLAYERS`:

```ts
/** Longest nickname, in Unicode code points. Matches the client's input maxlength. */
export const NAME_MAX_LENGTH = 16;
```

Create `packages/shared/src/names.ts`:

```ts
/**
 * Nickname cleaning shared by client and server. Names are shown to every
 * player, so the server never trusts what a client sends. Escaping is NOT done
 * here: the client must render names with textContent, never innerHTML.
 */
import { NAME_MAX_LENGTH } from "./constants.js";

// C0/C1 control characters plus the bidi overrides/isolates used to spoof text.
const UNSAFE_CHARS = /[\p{Cc}‪-‮⁦-⁩]/gu;

/** Clean a client-supplied nickname, or return `fallback` when nothing usable is left. */
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw.replace(UNSAFE_CHARS, "").replace(/\s+/g, " ").trim();
  // Array.from splits by code point, so an emoji is never cut in half.
  const capped = Array.from(cleaned).slice(0, NAME_MAX_LENGTH).join("").trim();
  return capped || fallback;
}
```

`\t` and `\n` are control characters (`\p{Cc}`), so they are removed before whitespace collapses. That is what the tests expect.

Add to `packages/shared/src/index.ts`:

```ts
export * from "./names.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/shared/test/names.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Use it on the server.** In `packages/server/src/index.ts`, add `sanitizeName` to the `@padel/shared` import and replace

```ts
      client.name = (msg.name ?? "").trim().slice(0, 20) || `Player ${id}`;
```

with

```ts
      client.name = sanitizeName(msg.name, `Player ${id}`);
```

- [ ] **Step 6: Render names safely on the client.** In `packages/client/src/main.ts`:

Add `sanitizeName` to the `@padel/shared` import. Replace the whole `renderVote` function with:

```ts
function renderVote(active: boolean, initiator = "", accepted = 0, needed = 0): void {
  if (!(active && role === "player")) {
    votepanel.style.display = "none";
    return;
  }
  // Built with DOM nodes: the initiator's nickname is user input.
  const who = document.createElement("strong");
  who.textContent = initiator;
  const line = document.createElement("div");
  line.append(who, " wants to reset the set.");
  const count = document.createElement("div");
  count.style.cssText = "opacity:.8;margin-top:4px";
  count.textContent = `${accepted}/${needed} players accepted`;
  const accept = document.createElement("button");
  accept.className = "accept";
  accept.textContent = "Accept";
  accept.addEventListener("click", () => net.send({ t: "votereset" }));
  const decline = document.createElement("button");
  decline.className = "decline";
  decline.textContent = "Decline";
  decline.addEventListener("click", () => net.send({ t: "votedecline" }));
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(accept, decline);
  votepanel.replaceChildren(line, count, actions);
  votepanel.style.display = "block";
}
```

In `maybeFlash`, replace the `flash.innerHTML = …;` statement with:

```ts
  const title = document.createElement("div");
  title.textContent = e;
  flash.replaceChildren(title);
  if (match.reason) {
    const why = document.createElement("div");
    why.style.cssText = "font-size:16px;font-weight:600;opacity:.9;margin-top:6px";
    why.textContent = match.reason;
    flash.append(why);
  }
```

In `play()`, replace `const name = nickInput.value.trim().slice(0, 16) || "Player";` with:

```ts
  const name = sanitizeName(nickInput.value, "Player");
```

- [ ] **Step 7: Check that no innerHTML interpolates user text**

Run: `grep -n "innerHTML" packages/client/src/*.ts`
Expected: only `renderHud` and `renderScoreboard` remain. Neither interpolates a nickname: `renderHud` uses the connection status, role and slot, and `renderScoreboard` uses numbers and fixed labels.

- [ ] **Step 8: Manual check.** Run `pnpm dev` and open two tabs at http://localhost:5173. In tab 1, join as `<i>evil</i>`. In tab 2, join as `Ana`. Press B once in tab 1 so that tab 2 is a player too, then click "Reset set" in tab 1.
Expected: tab 2's vote panel reads `<i>evil</i> wants to reset the set.` literally, not in italics.

- [ ] **Step 9: Gate and commit**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: PASS.

```bash
git add packages/shared packages/server/src/index.ts packages/client/src/main.ts
git commit -m "Sanitise nicknames on the server and render user text without innerHTML"
```

---

### Task 3: Seated-only bot control, and build the court once

**Files:**
- Modify: `packages/server/src/room.ts:131-162` (`addBot`, `clearBots`, new `isSeated`)
- Modify: `packages/server/src/index.ts:89-95` (pass the requester)
- Create: `packages/server/test/fakes.ts`
- Test: `packages/server/test/bots.test.ts`
- Modify: `packages/client/src/main.ts` (B/N keys and HUD hint for players only; dev handle on the scene)
- Modify: `packages/client/src/scene.ts:110` (`buildCourt` guard)

**Interfaces:**
- Consumes: nothing.
- Produces: `Room.addBot(requesterId: string): boolean`, `Room.clearBots(requesterId: string): boolean`, and the test helper `fakeClient(id)` from `packages/server/test/fakes.ts` returning `{ client: Client; messages(): ServerMessage[]; last<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | null }` (used again in Task 5).

- [ ] **Step 1: Write the shared test helper** `packages/server/test/fakes.ts`

```ts
import { decodeServer, type ServerMessage } from "@padel/shared";
import type { Client } from "../src/room.js";

/** A Client whose socket records everything the room sends it. */
export function fakeClient(id: string) {
  const sent: string[] = [];
  const ws = { readyState: 1, OPEN: 1, send: (d: string) => sent.push(d), close: () => {} };
  const client: Client = { id, ws: ws as unknown as Client["ws"], name: id, lastActivity: Date.now() };
  const messages = (): ServerMessage[] => sent.map((d) => decodeServer(d));
  function last<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | null {
    const all = messages();
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i]!;
      if (m.t === t) return m as Extract<ServerMessage, { t: T }>;
    }
    return null;
  }
  return { client, messages, last };
}
```

- [ ] **Step 2: Write the failing test** `packages/server/test/bots.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { Room } from "../src/room.js";
import { fakeClient } from "./fakes.js";

describe("bot control", () => {
  it("only seated players can add or clear bots", async () => {
    const room = await Room.create();
    const player = fakeClient("p1");
    const watcher = fakeClient("w1");
    room.addClient(player.client);
    room.claimSlot("p1", "Ana");
    room.addClient(watcher.client); // connected, never seated

    expect(room.addBot("w1")).toBe(false);
    expect(player.last("roster")?.players).toHaveLength(1);

    expect(room.addBot("p1")).toBe(true);
    expect(player.last("roster")?.players).toHaveLength(2);

    expect(room.clearBots("w1")).toBe(false);
    expect(player.last("roster")?.players).toHaveLength(2);

    expect(room.clearBots("p1")).toBe(true);
    expect(player.last("roster")?.players).toHaveLength(1);
    room.stop();
  });

  it("refuses a bot when every seat is taken", async () => {
    const room = await Room.create();
    const p = fakeClient("p1");
    room.addClient(p.client);
    room.claimSlot("p1", "Ana");
    expect(room.addBot("p1")).toBe(true);
    expect(room.addBot("p1")).toBe(true);
    expect(room.addBot("p1")).toBe(true);
    expect(room.addBot("p1")).toBe(false);
    room.stop();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run packages/server/test/bots.test.ts`
Expected: FAIL. Typecheck errors aside, `addBot` returns `undefined` rather than `false` or `true`.

- [ ] **Step 4: Implement in `packages/server/src/room.ts`.** Replace `addBot` and `clearBots` with:

```ts
  /** Spawn an AI bot into a free seat. Only a seated human may ask. */
  addBot(requesterId: string): boolean {
    if (!this.isSeated(requesterId)) return false;
    const used = new Set(
      [...this.slots.values()].filter((p) => p.isBot).map((p) => p.name),
    );
    const choices = BOT_NAMES.filter((n) => !used.has(`Bot ${n}`));
    this.botCounter++;
    const name = choices.length
      ? `Bot ${choices[Math.floor(Math.random() * choices.length)]!}`
      : `Bot ${this.botCounter}`;
    const ps = this.fillSlot(`bot-${this.botCounter}`, name, true);
    if (ps) console.log(`[bot] spawned ${ps.name} as ${ps.slot}`);
    return ps !== null;
  }

  /** Remove all AI bots. Only a seated human may ask. */
  clearBots(requesterId: string): boolean {
    if (!this.isSeated(requesterId)) return false;
    let removed = false;
    for (const [slot, ps] of [...this.slots]) {
      if (ps.isBot) {
        this.slots.delete(slot);
        removed = true;
      }
    }
    if (removed) {
      this.syncMatchRoster();
      this.broadcastRoster();
    }
    return removed;
  }

  /** Whether this connection holds a seat (bots never count as requesters). */
  private isSeated(clientId: string): boolean {
    for (const ps of this.slots.values()) {
      if (ps.clientId === clientId && !ps.isBot) return true;
    }
    return false;
  }
```

In `packages/server/src/index.ts`, change `room.addBot();` to `room.addBot(id);` and `room.clearBots();` to `room.clearBots(id);`.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run packages/server`
Expected: PASS (`roster.test.ts` plus 2 new tests).

- [ ] **Step 6: Client: bot keys and hint for players only.** In `packages/client/src/main.ts`, in the `keydown` listener, change

```ts
  if (e.code === "KeyB") net.send({ t: "addbot" });
  else if (e.code === "KeyN") net.send({ t: "clearbots" });
```

to

```ts
  if (e.code === "KeyB" && role === "player") net.send({ t: "addbot" });
  else if (e.code === "KeyN" && role === "player") net.send({ t: "clearbots" });
```

In `renderHud`, replace the last `<div style="margin-top:4px;opacity:.7;font-size:12px">…</div>` block with

```ts
    ${
      state.role === "player"
        ? `<div style="margin-top:4px;opacity:.7;font-size:12px">
      <strong>B</strong> add bot · <strong>N</strong> clear bots
    </div>`
        : ""
    }
```

- [ ] **Step 7: Build the court once.** In `packages/client/src/scene.ts`, make the first lines of `buildCourt` read:

```ts
  buildCourt(court: CourtConfig): void {
    // The court is static and a Welcome arrives on every (re)connect: build once.
    if (this.court) return;
    this.court = court;
```

In `packages/client/src/main.ts`, right after `const scene = new PadelScene(app);`, add a dev-only handle for console checks:

```ts
if (import.meta.env.DEV) (window as unknown as { __padelScene: PadelScene }).__padelScene = scene;
```

- [ ] **Step 8: Manual check of the reconnect.** Run `pnpm dev` and join at http://localhost:5173. In the browser console, run `__padelScene.scene.children.length` and note the number. Stop the server with Ctrl-C and restart it with `pnpm dev`. Wait for the HUD to show "connected" again, then run the same command.
Expected: the same number. Also, as a spectator (a 5th tab, or any tab once 4 seats are full), pressing B does nothing.

- [ ] **Step 9: Gate and commit**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: PASS.

```bash
git add packages/server packages/client/src/main.ts packages/client/src/scene.ts
git commit -m "Limit bot commands to seated players and build the court only once"
```

---

### Task 4: Enforce the protocol version

**Files:**
- Modify: `packages/shared/src/constants.ts` (`PROTOCOL_VERSION = 2`)
- Modify: `packages/shared/src/messages.ts` (`OutdatedMsg`, and add it to `ServerMessage`)
- Modify: `packages/server/src/index.ts` (join handling)
- Modify: `packages/client/src/net.ts` (dispatch, no reconnect)
- Modify: `packages/client/src/main.ts` (reload screen)
- Modify: `CLAUDE.md` (remove "the server does not check it yet")

**Interfaces:**
- Consumes: nothing.
- Produces: `OutdatedMsg { t: "outdated"; serverVersion: number }` and `NetHandlers.onOutdated?: () => void`.

- [ ] **Step 1: Shared types.** In `packages/shared/src/constants.ts`, set `export const PROTOCOL_VERSION = 2;` (snapshots gain `ack` in Task 5, and input semantics change in Task 6). In `packages/shared/src/messages.ts`, add the following before `export type ServerMessage`:

```ts
/** Sent instead of a Welcome when the client speaks another protocol version; the server then closes. */
export interface OutdatedMsg {
  t: "outdated";
  serverVersion: number;
}
```

and add `| OutdatedMsg` to the `ServerMessage` union.

- [ ] **Step 2: Server.** In `packages/server/src/index.ts`, add `type OutdatedMsg` to the import. In the `join` branch, directly after `if (joined) return;`, insert:

```ts
      if (msg.version !== PROTOCOL_VERSION) {
        const out: OutdatedMsg = { t: "outdated", serverVersion: PROTOCOL_VERSION };
        ws.send(encode(out));
        ws.close();
        console.log(`[ws] ${id} rejected: client protocol v${msg.version}, server v${PROTOCOL_VERSION}`);
        return;
      }
```

- [ ] **Step 3: Client net.** In `packages/client/src/net.ts`, add `onOutdated?: () => void;` to `NetHandlers`. In `dispatch`, add:

```ts
      case "outdated":
        // Reconnecting would only be rejected again: stop, like a kick.
        this.kicked = true;
        this.handlers.onOutdated?.();
        break;
```

- [ ] **Step 4: Client screen.** In `packages/client/src/main.ts`, add `let outdated = false;` next to the other top-level `let`s, and add this handler to the `new Net({…})` object:

```ts
  onOutdated: () => {
    outdated = true;
    hideLoading();
    nickInput.style.display = "none";
    nickGo.textContent = "Reload";
    nickMsg.textContent = "A new version of Meuss Padel Club is out.";
    nickname.style.display = "flex";
  },
```

Make `play()` begin with:

```ts
  if (outdated) {
    location.reload();
    return;
  }
```

- [ ] **Step 5: Manual check with an old client.** Run `pnpm dev:server`. In a second terminal:

```bash
pnpm --filter @padel/server exec node -e "const W=require('ws');const s=new W('ws://localhost:8080');s.on('open',()=>s.send(JSON.stringify({t:'join',version:1,name:'old'})));s.on('message',m=>console.log(String(m)));s.on('close',()=>console.log('closed'))"
```

Expected: `{"t":"outdated","serverVersion":2}` followed by `closed`, and a `rejected` log line on the server. Then run `pnpm dev` and join normally from the browser: it works as before.

- [ ] **Step 6: Update `CLAUDE.md`.** Replace the sentence `` `PROTOCOL_VERSION` is sent on join but the server does not check it yet. `` with `` `PROTOCOL_VERSION` is sent on join; the server answers a mismatch with `outdated` and closes, and the client shows a reload screen. Bump it whenever the wire format changes. ``

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: PASS.

```bash
git add packages/shared packages/server/src/index.ts packages/client/src CLAUDE.md
git commit -m "Reject outdated clients with a reload screen (protocol v2)"
```

---

### Task 5: Deterministic shared movement, server input queue and ack

**Files:**
- Modify: `packages/shared/src/gameplay.ts` (`PLAYER_BOUNDS`, `stepPlayer`)
- Modify: `packages/shared/src/messages.ts` (`PlayerState.ack`)
- Test: `packages/shared/test/gameplay.test.ts` (append)
- Modify: `packages/server/src/room.ts` (`PlayerSlot`, `handleInput`, `integratePlayers`, `buildPlayerStates`, `update` → public `step`, remove `MARGIN`/`HALF_BOUNDS`)
- Test: `packages/server/test/movement.test.ts`

**Interfaces:**
- Consumes: `fakeClient` from `packages/server/test/fakes.ts` (Task 3).
- Produces:
  - `PLAYER_BOUNDS: HalfBounds` and `stepPlayer(pos: Vec2, move: Vec2, side: -1 | 1, dt: number): Vec2` from `@padel/shared`.
  - `PlayerState.ack?: number`: the seq of the last input the server applied for that player (humans only).
  - `Room.step(): void`, one 60 Hz tick (also used by `start()`).

- [ ] **Step 1: Write the failing shared test.** Append to `packages/shared/test/gameplay.test.ts`, and add `stepPlayer`, `PLAYER_BOUNDS`, `PLAYER` and `TICK_DT` to its existing multi-line import (same module path as `confineToHalf`).

```ts
describe("stepPlayer", () => {
  it("moves forward toward the net in the player's frame", () => {
    // Side -1 defends z<0, so "forward" is +z.
    const p = stepPlayer({ x: 0, z: -5 }, { x: 0, z: 1 }, -1, TICK_DT);
    expect(p.z).toBeCloseTo(-5 + PLAYER.speed * TICK_DT, 10);
    expect(p.x).toBe(0);
    // Side +1 defends z>0, so "forward" is -z and strafe-right is -x.
    const q = stepPlayer({ x: 0, z: 5 }, { x: 1, z: 1 }, 1, TICK_DT);
    expect(q.z).toBeLessThan(5);
    expect(q.x).toBeGreaterThan(0);
  });

  it("does not move faster on diagonals", () => {
    const d = stepPlayer({ x: 0, z: -5 }, { x: 1, z: 1 }, -1, 1);
    expect(Math.hypot(d.x, d.z + 5)).toBeCloseTo(PLAYER.speed, 10);
  });

  it("keeps the player inside their half", () => {
    const p = stepPlayer({ x: 0, z: -0.6 }, { x: 0, z: 1 }, -1, 1);
    expect(p.z).toBe(-PLAYER_BOUNDS.netGap);
    const q = stepPlayer({ x: 0, z: -5 }, { x: 0, z: 0 }, 1, TICK_DT); // side just swapped
    expect(q.z).toBe(PLAYER_BOUNDS.netGap);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/shared/test/gameplay.test.ts`
Expected: FAIL (`stepPlayer` is not exported).

- [ ] **Step 3: Implement in `packages/shared/src/gameplay.ts`.** Add `import { COURT, PLAYER } from "./constants.js";` under the existing import. Then add the following after `confineToHalf`:

```ts
const PLAYER_MARGIN = PLAYER.radius + 0.15;

/** How far players may move inside their half: walls minus body radius, net gap. */
export const PLAYER_BOUNDS: HalfBounds = {
  halfW: COURT.width / 2 - PLAYER_MARGIN,
  halfL: COURT.length / 2 - PLAYER_MARGIN,
  netGap: PLAYER.radius + 0.1,
};

/**
 * Advance a player by one movement step. This is the ONLY movement integrator:
 * the server runs it once per tick and the client replays it for prediction, so
 * both must call it with identical inputs to agree. `move` is in the player's
 * frame (x = strafe right, z = toward the net); `side` is the z-sign of the half
 * they defend.
 */
export function stepPlayer(pos: Vec2, move: Vec2, side: -1 | 1, dt: number): Vec2 {
  const m = normalizeMove(move.x, move.z);
  return confineToHalf(
    {
      x: pos.x + m.x * side * PLAYER.speed * dt,
      z: pos.z - m.z * side * PLAYER.speed * dt,
    },
    side,
    PLAYER_BOUNDS,
  );
}
```

Also update the file header comment: change "available to the client for prediction later" to "used by the client for prediction".

- [ ] **Step 4: Run the shared tests**

Run: `pnpm vitest run packages/shared`
Expected: PASS.

- [ ] **Step 5: Add `ack` to the snapshot type.** In `packages/shared/src/messages.ts`, add the following to `PlayerState` after `swing?`:

```ts
  /** Seq of the last input the server applied for this player (humans only). */
  ack?: number;
```

- [ ] **Step 6: Write the failing server test** `packages/server/test/movement.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { PLAYER, TICK_DT, type InputMsg, type Vec2 } from "@padel/shared";
import { Room } from "../src/room.js";
import { fakeClient } from "./fakes.js";

function input(seq: number, move: Vec2): InputMsg {
  return { t: "input", seq, ts: 0, move, aim: { x: 0, z: 1 }, swing: false, serve: false };
}

async function seatedRoom() {
  const room = await Room.create();
  const p = fakeClient("p1");
  room.addClient(p.client);
  room.claimSlot("p1", "Ana"); // seat A1: defends z<0, starts at (-2.5, -5)
  const me = () => p.last("snapshot")!.players.find((s) => s.slot === "A1")!;
  return { room, p, me };
}

describe("server input queue", () => {
  it("applies one queued input per tick and acks its seq", async () => {
    const { room, me } = await seatedRoom();
    for (let seq = 1; seq <= 3; seq++) room.handleInput("p1", input(seq, { x: 0, z: 1 }));
    room.step();
    room.step();
    room.step(); // a snapshot goes out every 3rd tick
    expect(me().ack).toBe(3);
    expect(me().pos.z).toBeCloseTo(-5 + 3 * PLAYER.speed * TICK_DT, 6);
    room.stop();
  });

  it("does not move when no input is queued", async () => {
    const { room, me } = await seatedRoom();
    room.handleInput("p1", input(1, { x: 0, z: 1 }));
    for (let i = 0; i < 6; i++) room.step();
    expect(me().ack).toBe(1);
    expect(me().pos.z).toBeCloseTo(-5 + PLAYER.speed * TICK_DT, 6);
    room.stop();
  });

  it("caps the queue so a flood cannot build up lag", async () => {
    const { room, me } = await seatedRoom();
    for (let seq = 1; seq <= 20; seq++) room.handleInput("p1", input(seq, { x: 0, z: 1 }));
    for (let i = 0; i < 21; i++) room.step();
    expect(me().ack).toBe(20);
    expect(me().pos.z).toBeCloseTo(-5 + 8 * PLAYER.speed * TICK_DT, 6);
    room.stop();
  });

  it("ignores input from a connection without a seat", async () => {
    const { room, p, me } = await seatedRoom();
    const w = fakeClient("w1");
    room.addClient(w.client);
    room.handleInput("w1", input(1, { x: 1, z: 1 }));
    room.step();
    room.step();
    room.step();
    expect(me().ack).toBeUndefined();
    expect(p.last("snapshot")!.players).toHaveLength(1);
    room.stop();
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm vitest run packages/server/test/movement.test.ts`
Expected: FAIL (`room.step` is not a function).

- [ ] **Step 8: Implement in `packages/server/src/room.ts`.**

1. In the `@padel/shared` import, remove `confineToHalf`, `normalizeMove` and `type HalfBounds`, and add `stepPlayer`. Delete the `MARGIN` and `HALF_BOUNDS` constants (lines 87–92).
2. Under `VOTE_TIMEOUT_MS`, add:

```ts
/** Max inputs buffered per player (~133 ms at 60 Hz); older ones are dropped. */
const MAX_QUEUED_INPUTS = 8;
```

3. In `interface PlayerSlot`, add after `input: InputMsg | null;`:

```ts
  inputQueue: InputMsg[]; // humans: one is consumed per tick, in order
  ack: number | undefined; // seq of the last input applied (humans)
```

and in `fillSlot`'s object literal, add `inputQueue: [],` and `ack: undefined,`.
4. Replace `handleInput` with:

```ts
  handleInput(clientId: string, input: InputMsg): void {
    for (const ps of this.slots.values()) {
      if (ps.clientId === clientId) {
        ps.inputQueue.push(input);
        if (ps.inputQueue.length > MAX_QUEUED_INPUTS) ps.inputQueue.shift();
        if (input.swing) ps.swingRequested = true;
        if (input.serve) ps.serveRequested = true;
        return;
      }
    }
  }
```

5. Rename `private update(): void` to `step(): void`, add the doc comment `/** Advance the room by one fixed tick (called by the loop; public for tests). */`, and change `start()` to `setInterval(() => this.step(), TICK_MS)`.
6. Replace `integratePlayers` with:

```ts
  private integratePlayers(): void {
    const server = this.match.currentServer;
    for (const ps of this.slots.values()) {
      // Humans consume exactly one queued input per tick and do NOT move when
      // the queue is empty, so the client can replay the same steps exactly.
      // Bots write `ps.input` directly every tick.
      let move = { x: 0, z: 0 };
      if (ps.isBot) {
        if (ps.input) move = ps.input.move;
      } else {
        const next = ps.inputQueue.shift();
        if (next) {
          ps.input = next;
          ps.ack = next.seq;
          move = next.move;
        }
      }
      const aim = ps.input?.aim;
      if (aim && (aim.x !== 0 || aim.z !== 0)) ps.yaw = Math.atan2(aim.x, aim.z);
      // The serving player is locked at the serve spot until they serve.
      if (this.match.phase === "serve" && ps.slot === server) continue;
      const p = stepPlayer(ps.pos, move, ps.side, TICK_DT);
      ps.pos.x = p.x;
      ps.pos.z = p.z;
    }
  }
```

7. In `buildPlayerStates`, add `ack` to the pushed object:

```ts
      out.push({
        slot: ps.slot,
        pos: { x: ps.pos.x, y: 0, z: ps.pos.z },
        yaw: ps.yaw,
        swing: ps.swung,
        ...(ps.ack !== undefined && { ack: ps.ack }),
      });
```

8. Run `grep -n "HALF_BOUNDS\|MARGIN\|confineToHalf\|normalizeMove" packages/server/src/room.ts`. Expected: no matches. If any remain, replace `HALF_BOUNDS` with `PLAYER_BOUNDS` (imported from `@padel/shared`) and keep `confineToHalf` imported only where it is still used.

- [ ] **Step 9: Run the server tests**

Run: `pnpm vitest run packages/server`
Expected: PASS (roster, bots and 4 movement tests).

- [ ] **Step 10: Manual check (no client change yet).** Run `pnpm dev` and play: movement must feel exactly as before. Today's client still sends one input per render frame, so on a 120 Hz screen the queue fills to its cap and movement lags slightly. That is expected until Task 6 lands. Don't deploy between Task 5 and Task 6.

- [ ] **Step 11: Gate and commit**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: PASS.

```bash
git add packages/shared packages/server
git commit -m "Share the movement integrator and consume one acked input per server tick"
```

---

### Task 6: Client prediction and reconciliation for the local player

**Files:**
- Create: `packages/client/src/predict.ts`
- Test: `packages/client/test/predict.test.ts`
- Modify: `packages/client/src/main.ts` (fixed-step input sending, reconcile on snapshot, render own player from the predictor)
- Modify: `CLAUDE.md` (Conventions: the movement integrator)

**Interfaces:**
- Consumes: `stepPlayer`, `TICK_DT` and `PlayerState.ack` (Task 5).
- Produces:
  - `class Predictor` with:
    - `applyInput(input: { seq: number; move: Vec2 }, side: -1 | 1, locked: boolean): void`
    - `reconcile(serverPos: Vec2, ack: number | undefined, side: -1 | 1, locked: boolean): void`
    - `renderPosition(dtSec: number): Vec2 | null`
    - `reset(): void`
  - Pure helper `fixedSteps(accumulator: number, dt: number): { steps: number; accumulator: number }`.
  - Constants `MAX_STEPS_PER_FRAME = 5`, `SNAP_DISTANCE = 1.5`, `CORRECTION_RATE = 12`.

- [ ] **Step 1: Write the failing test** `packages/client/test/predict.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { PLAYER, TICK_DT } from "@padel/shared";
import { MAX_STEPS_PER_FRAME, Predictor, fixedSteps } from "../src/predict.js";

const D = PLAYER.speed * TICK_DT; // distance of one forward tick
const FWD = { x: 0, z: 1 };

describe("fixedSteps", () => {
  it("emits whole 60 Hz ticks and keeps the remainder", () => {
    const a = fixedSteps(0, TICK_DT * 2.5);
    expect(a.steps).toBe(2);
    expect(a.accumulator).toBeCloseTo(TICK_DT * 0.5, 10);
    const b = fixedSteps(a.accumulator, TICK_DT * 0.5);
    expect(b.steps).toBe(1);
  });

  it("caps a long frame (hidden tab) and drops the backlog", () => {
    const r = fixedSteps(0, 10);
    expect(r.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(r.accumulator).toBe(0);
  });
});

describe("Predictor", () => {
  it("does nothing before the first server position", () => {
    const p = new Predictor();
    p.applyInput({ seq: 1, move: FWD }, -1, false);
    expect(p.renderPosition(0)).toBeNull();
  });

  it("moves immediately on local input", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, undefined, -1, false);
    p.applyInput({ seq: 1, move: FWD }, -1, false);
    p.applyInput({ seq: 2, move: FWD }, -1, false);
    expect(p.renderPosition(0)!.z).toBeCloseTo(-5 + 2 * D, 10);
  });

  it("replays unacked inputs on reconcile with no visible correction", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, undefined, -1, false);
    p.applyInput({ seq: 1, move: FWD }, -1, false);
    p.applyInput({ seq: 2, move: FWD }, -1, false);
    // Server has applied seq 1 only.
    p.reconcile({ x: 0, z: -5 + D }, 1, -1, false);
    const r = p.renderPosition(0)!;
    expect(r.z).toBeCloseTo(-5 + 2 * D, 10);
    expect(r.x).toBeCloseTo(0, 10);
  });

  it("smooths a small misprediction instead of snapping", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, 0, -1, false);
    p.reconcile({ x: 0.3, z: -5 }, 0, -1, false);
    expect(p.renderPosition(0)!.x).toBeCloseTo(0, 10); // still drawn where it was
    expect(p.renderPosition(1)!.x).toBeCloseTo(0.3, 3); // converged after 1 s
  });

  it("snaps on a large jump such as the serve teleport", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, 0, -1, false);
    p.reconcile({ x: 3, z: -9 }, 0, -1, false);
    expect(p.renderPosition(0)).toEqual({ x: 3, z: -9 });
  });

  it("does not move while locked (waiting to serve)", () => {
    const p = new Predictor();
    p.reconcile({ x: 1, z: -9 }, 0, -1, true);
    p.applyInput({ seq: 1, move: FWD }, -1, true);
    expect(p.renderPosition(0)).toEqual({ x: 1, z: -9 });
  });

  it("replays pending inputs with the side given at reconcile (ends swap)", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, 0, -1, false);
    p.applyInput({ seq: 1, move: FWD }, -1, false);
    // Ends swapped: the server now has us at z = +5, seq 1 not yet applied.
    p.reconcile({ x: 0, z: 5 }, 0, 1, false);
    expect(p.renderPosition(0)!.z).toBeCloseTo(5 - D, 10); // forward is -z now
  });

  it("forgets everything on reset (reconnect)", () => {
    const p = new Predictor();
    p.reconcile({ x: 0, z: -5 }, 0, -1, false);
    p.applyInput({ seq: 1, move: FWD }, -1, false);
    p.reset();
    expect(p.renderPosition(0)).toBeNull();
    p.reconcile({ x: 2, z: -3 }, 7, -1, false);
    expect(p.renderPosition(0)).toEqual({ x: 2, z: -3 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/client/test/predict.test.ts`
Expected: FAIL (cannot find `../src/predict.js`).

- [ ] **Step 3: Implement** `packages/client/src/predict.ts`

```ts
/**
 * Client-side prediction for the local player's movement. Inputs are produced
 * on the server's fixed 60 Hz tick and applied here immediately through the
 * shared `stepPlayer`, so the player moves with no network delay. Each snapshot
 * carries the seq of the last input the server applied (`ack`): we restart from
 * the server's position and replay the inputs it has not applied yet. Small
 * differences are hidden by an offset that decays to zero; large ones (serve
 * teleport, ends swap) snap. No DOM or Three.js here, so it is unit tested.
 */
import { TICK_DT, stepPlayer, type Vec2 } from "@padel/shared";

/** Most ticks run in one frame; a longer gap (hidden tab) drops the backlog. */
export const MAX_STEPS_PER_FRAME = 5;
/** Corrections larger than this (metres) snap instead of being smoothed. */
export const SNAP_DISTANCE = 1.5;
/** Exponential decay rate (1/s) of the smoothing offset. */
export const CORRECTION_RATE = 12;
/** Pending inputs kept for replay (~2 s); older ones can no longer matter. */
const MAX_PENDING = 120;

/** Split elapsed frame time (seconds) into whole simulation ticks. */
export function fixedSteps(
  accumulator: number,
  dt: number,
): { steps: number; accumulator: number } {
  let acc = accumulator + dt;
  let steps = Math.floor((acc + 1e-9) / TICK_DT);
  acc = Math.max(0, acc - steps * TICK_DT);
  if (steps > MAX_STEPS_PER_FRAME) {
    steps = MAX_STEPS_PER_FRAME;
    acc = 0;
  }
  return { steps, accumulator: acc };
}

export interface PredictedInput {
  seq: number;
  move: Vec2;
}

export class Predictor {
  private pos: Vec2 | null = null;
  private pending: PredictedInput[] = [];
  private offset: Vec2 = { x: 0, z: 0 };

  /** Apply one tick of local input now and keep it for replay. */
  applyInput(input: PredictedInput, side: -1 | 1, locked: boolean): void {
    if (!this.pos) return; // no authoritative start yet
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    if (!locked) this.pos = stepPlayer(this.pos, input.move, side, TICK_DT);
  }

  /** Restart from the server's position and replay the inputs it has not applied. */
  reconcile(serverPos: Vec2, ack: number | undefined, side: -1 | 1, locked: boolean): void {
    if (ack !== undefined) this.pending = this.pending.filter((p) => p.seq > ack);
    let next: Vec2 = { x: serverPos.x, z: serverPos.z };
    if (!locked) {
      for (const p of this.pending) next = stepPlayer(next, p.move, side, TICK_DT);
    }
    const before = this.pos;
    this.pos = next;
    if (!before) return;
    const dx = before.x - next.x;
    const dz = before.z - next.z;
    if (Math.hypot(dx + this.offset.x, dz + this.offset.z) > SNAP_DISTANCE) {
      this.offset = { x: 0, z: 0 };
    } else {
      this.offset = { x: this.offset.x + dx, z: this.offset.z + dz };
    }
  }

  /** Where to draw the player this frame; the correction offset decays. */
  renderPosition(dtSec: number): Vec2 | null {
    if (!this.pos) return null;
    const k = Math.exp(-dtSec * CORRECTION_RATE);
    this.offset = { x: this.offset.x * k, z: this.offset.z * k };
    return { x: this.pos.x + this.offset.x, z: this.pos.z + this.offset.z };
  }

  /** Forget everything (new connection or seat). */
  reset(): void {
    this.pos = null;
    this.pending = [];
    this.offset = { x: 0, z: 0 };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/client/test/predict.test.ts`
Expected: PASS (10 tests). If the smoothing test fails at `toBeCloseTo(0.3, 3)`, check that `renderPosition(1)` decays by `exp(-12)`. Do not loosen the assertion.

- [ ] **Step 5: Wire it into `packages/client/src/main.ts`.** Add the imports:

```ts
import { Predictor, fixedSteps } from "./predict.js";
```

and add `type InputMsg` to the `@padel/shared` import. Next to the other top-level state, add:

```ts
const predictor = new Predictor();
let stepAccum = 0;
let carrySwing = false;
let carryServe = false;
let selfYaw = 0;

/** z-sign of the half our team defends right now (changes on ends-swaps). */
function selfSide(): -1 | 1 {
  const sideA = match?.sideA ?? -1;
  return selfTeam === "B" ? (sideA === -1 ? 1 : -1) : sideA;
}

/** True while we are the server waiting to serve: the server pins us in place. */
function selfLocked(): boolean {
  return match !== null && match.phase === "serve" && match.serverSlot === selfSlot;
}
```

In `onWelcome`, as its first line, add:

```ts
    predictor.reset();
    stepAccum = 0;
```

In `onSnapshot`, after `interp.add(msg);`, add:

```ts
    if (selfSlot) {
      const me = msg.players.find((p) => p.slot === selfSlot);
      if (me) predictor.reconcile({ x: me.pos.x, z: me.pos.z }, me.ack, selfSide(), selfLocked());
    }
```

- [ ] **Step 6: Render your own player from the predictor.** In the `scene.start((dt) => { … })` callback, replace the `for (const p of s.players) { … }` loop body with:

```ts
    const predicted = predictor.renderPosition(dt);
    for (const p of s.players) {
      present.add(p.slot);
      seenSlots.add(p.slot);
      const mine = p.slot === selfSlot && predicted !== null;
      const x = mine ? predicted.x : p.pos.x;
      const z = mine ? predicted.z : p.pos.z;
      framePos.set(p.slot, { x, z });
      scene.setPlayer(p.slot, x, p.pos.y, z, mine ? selfYaw : p.yaw);
      updateLabel(p.slot, x, z);
      if (p.slot === selfSlot) {
        ownPos = { x, z };
        scene.focusCamera(x, p.pos.y, z);
      }
    }
```

- [ ] **Step 7: Send inputs on the fixed 60 Hz clock.** Replace the whole `if (input) { … }` block at the end of the render callback with:

```ts
  if (input) {
    const i = input.poll();
    // A click between ticks must still reach the next tick.
    carrySwing ||= i.swing;
    carryServe ||= i.serve;
    const aim =
      ownPos !== null
        ? scene.aimFromPointer(i.pointer.x, i.pointer.y, ownPos.x, ownPos.z)
        : { x: 0, z: selfTeam === "A" ? 1 : -1 };
    if (aim.x !== 0 || aim.z !== 0) selfYaw = Math.atan2(aim.x, aim.z);
    const { steps, accumulator } = fixedSteps(stepAccum, dt);
    stepAccum = accumulator;
    for (let k = 0; k < steps; k++) {
      const msg: InputMsg = {
        t: "input",
        seq: inputSeq++,
        ts: performance.now(),
        move: i.move,
        aim,
        swing: carrySwing,
        serve: carryServe,
      };
      carrySwing = false;
      carryServe = false;
      net.send(msg);
      predictor.applyInput({ seq: msg.seq, move: msg.move }, selfSide(), selfLocked());
    }
    if (i.swing && selfSlot) scene.triggerSwing(selfSlot);
  }
```

`InputMsg.seq` and `ts` are documented in `messages.ts`. Update the `seq` comment to: `// monotonic per client; one input per 60 Hz tick, echoed back as PlayerState.ack`.

- [ ] **Step 8: Document the rule in `CLAUDE.md`.** Under `## Conventions`, after the bullet about movement input, add:

```markdown
- `stepPlayer()` in `shared/src/gameplay.ts` is the only movement integrator. The
  server applies one queued input per tick and echoes its `seq` as `ack`; the
  client predicts with the same function and replays unacked inputs
  (`client/src/predict.ts`). Change movement there, never on one side only.
```

- [ ] **Step 9: Manual check.** Run `pnpm dev`, join, and press B three times.
  1. WASD movement responds instantly, with no rubber-banding while running in circles.
  2. Throttle the network in Chrome DevTools (Network → "Slow 4G"; WebSocket frames are delayed). Movement still responds instantly, and other players and the ball lag as before.
  3. When it's your serve, hold W: your player stays on the serve spot with no jitter.
  4. Play until a side change (after game 1). Your player appears on the new side without sliding across the net.
  5. Switch to another tab for 10 s and come back: no burst of motion, and no lag building up afterwards.

- [ ] **Step 10: Gate and commit**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: PASS.

```bash
git add packages/client CLAUDE.md
git commit -m "Predict the local player's movement and reconcile against server acks"
```

---

## Known trade-off carried into Stage 3

With prediction, you see yourself in the present but the ball about 100 ms in the past (interpolation). The server judges hits in its own present. Stage 3 (Shots and Timing) must decide how to handle this, either by rewinding the ball to the client's render time or by widening the Timing windows. Stage 1 deliberately leaves hit resolution unchanged.
