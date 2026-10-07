/**
 * Local input capture for a player: WASD/arrows for movement, the mouse pointer
 * for aim (point at where on the court to hit), left-click for a Drive,
 * right-click for a Lob, Space to toss the serve (then click to strike it). No
 * pointer lock — the cursor position over the canvas is what aims.
 *
 * `move` is in the player's own frame (x = strafe right, z = forward toward the
 * net); the server maps it to world axes using the half they defend, so it stays
 * correct after an ends-swap and there is no left/right inversion to get wrong.
 */
import type { Vec2 } from "@padel/shared";

export interface InputState {
  move: Vec2;
  pointer: { x: number; y: number };
  /** Shot clicked since the last poll: left = Drive, right = Lob. */
  shot: "drive" | "lob" | null;
  serve: boolean;
}

export class Input {
  private keys = new Set<string>();
  private pointer = { x: 0, y: 0 };
  private shotQueued: "drive" | "lob" | null = null;
  private serveQueued = false;

  constructor(private dom: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    this.dom.addEventListener("mousedown", this.onMouseDown);
    this.dom.addEventListener("contextmenu", this.onContextMenu);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (e.code === "Space") {
      this.serveQueued = true;
      e.preventDefault(); // don't scroll the page
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    const r = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.shotQueued = "drive";
    else if (e.button === 2) this.shotQueued = "lob";
  };

  /** Right-click is the Lob: keep the browser menu off the canvas. */
  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  poll(): InputState {
    const up = this.keys.has("KeyW") || this.keys.has("ArrowUp");
    const down = this.keys.has("KeyS") || this.keys.has("ArrowDown");
    const left = this.keys.has("KeyA") || this.keys.has("ArrowLeft");
    const right = this.keys.has("KeyD") || this.keys.has("ArrowRight");

    const forward = (up ? 1 : 0) - (down ? 1 : 0);
    const strafe = (right ? 1 : 0) - (left ? 1 : 0);

    const shot = this.shotQueued;
    const serve = this.serveQueued;
    this.shotQueued = null;
    this.serveQueued = false;
    return { move: { x: strafe, z: forward }, pointer: { ...this.pointer }, shot, serve };
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.dom.removeEventListener("mousedown", this.onMouseDown);
    this.dom.removeEventListener("contextmenu", this.onContextMenu);
  }
}
