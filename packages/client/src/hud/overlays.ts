/**
 * The DOM overlays over the 3D court: name tags above the avatars, emote reactions floating over
 * them, and the emote tray (the reactions in a strip, toggled with E by Players). Each frame
 * main.ts hands them the avatars' positions; they project them to the screen.
 */
import { PLAYER, REACTIONS, type Slot, type Team } from "@padel/shared";
import { blurAfterClick } from "./button.js";
import { nameTagText } from "./copy.js";

/** World to screen, as the scene projects it. */
export type Project = (x: number, y: number, z: number) => { x: number; y: number; visible: boolean };

/** A reaction's image, under the site's base path. */
const reactionSrc = (base: string, id: string) => `${base}reactions/${id}.png`;

// ── Name tags above avatars ──────────────────────────────────────────────────

export class NameTags {
  private readonly tags = new Map<Slot, HTMLDivElement>();

  constructor(
    private readonly root: HTMLElement,
    private readonly project: Project,
    /** The seated player's name, team and kind, or undefined for a seat no one holds. */
    private readonly nameOf: (slot: Slot) => { name: string; team: Team; isBot: boolean } | undefined,
  ) {}

  /** Name tags show between points only: they fade out when a rally starts. */
  setRally(rally: boolean): void {
    this.root.classList.toggle("rally", rally);
  }

  /** Place `slot`'s tag above its avatar at (x, z) this frame. */
  update(slot: Slot, x: number, z: number): void {
    const info = this.nameOf(slot);
    if (!info) {
      this.remove(slot);
      return;
    }
    let el = this.tags.get(slot);
    if (!el) {
      el = document.createElement("div");
      el.className = `nametag ${info.team}`;
      this.root.appendChild(el);
      this.tags.set(slot, el);
    }
    el.textContent = nameTagText(info.name, info.isBot);
    const p = this.project(x, PLAYER.height + 0.55, z);
    if (p.visible) {
      el.style.display = "block";
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    } else {
      el.style.display = "none";
    }
  }

  remove(slot: Slot): void {
    const el = this.tags.get(slot);
    if (el) {
      el.remove();
      this.tags.delete(slot);
    }
  }
}

// ── Emote reactions over avatars ─────────────────────────────────────────────

interface ActiveReaction {
  slot: Slot;
  el: HTMLImageElement;
  born: number;
}

export class Reactions {
  private readonly list: ActiveReaction[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly base: string,
    private readonly project: Project,
  ) {}

  show(slot: Slot, id: string): void {
    // One reaction per player at a time — replace any existing.
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i]!.slot === slot) {
        this.list[i]!.el.remove();
        this.list.splice(i, 1);
      }
    }
    const img = document.createElement("img");
    img.className = "reaction";
    img.src = reactionSrc(this.base, id);
    this.root.appendChild(img);
    this.list.push({ slot, el: img, born: performance.now() });
  }

  /** Once per frame: float each reaction over its avatar (`framePos`), fading it out at the end. */
  update(framePos: Map<string, { x: number; z: number }>): void {
    const now = performance.now();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i]!;
      const age = now - r.born;
      if (age > 2600) {
        r.el.remove();
        this.list.splice(i, 1);
        continue;
      }
      const pos = framePos.get(r.slot);
      if (!pos) {
        r.el.style.display = "none";
        continue;
      }
      const p = this.project(pos.x, PLAYER.height + 1.4, pos.z);
      if (!p.visible) {
        r.el.style.display = "none";
        continue;
      }
      r.el.style.display = "block";
      r.el.style.left = `${p.x}px`;
      r.el.style.top = `${p.y}px`;
      r.el.style.opacity = age > 2200 ? String(1 - (age - 2200) / 400) : "1";
    }
  }
}

// ── Emote tray ───────────────────────────────────────────────────────────────

export class EmoteTray {
  constructor(
    private readonly root: HTMLElement,
    base: string,
    /** A reaction was picked: send it. */
    onPick: (id: string) => void,
  ) {
    for (const id of REACTIONS) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "rb-item";
      item.title = id;
      item.setAttribute("aria-label", id);
      const img = document.createElement("img");
      img.src = reactionSrc(base, id);
      img.alt = "";
      item.append(img);
      item.addEventListener("click", () => {
        onPick(id);
        this.set(false);
      });
      blurAfterClick(item);
      root.append(item);
    }
  }

  get open(): boolean {
    return this.root.classList.contains("open");
  }

  set(open: boolean): void {
    this.root.classList.toggle("open", open);
    document.body.classList.toggle("tray-open", open);
  }
}
