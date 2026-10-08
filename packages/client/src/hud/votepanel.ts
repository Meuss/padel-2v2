/**
 * The vote panel: the lower third asking the seated Players to accept a reset of the set (or the
 * Rematch). votePanelView decides what it shows (pure, unit tested); VotePanel draws it, rebuilding
 * only when that changes, so a focused button keeps its focus across match updates.
 */
import type { VoteMsg } from "@padel/shared";
import { button } from "./button.js";

export interface VotePanelView {
  kind: VoteMsg["kind"];
  initiator: string;
  accepted: number;
  needed: number;
  /** We accepted it already: the Accept button settles. */
  acceptedByMe: boolean;
}

/**
 * What the panel shows, or null to hide it: an open vote, to a Player, between points, and not
 * while the Final card is up or due (its footer carries the vote then). Pure.
 */
export function votePanelView(
  v: VoteMsg | null,
  at: { player: boolean; finalPhase: boolean; rally: boolean },
  acceptedByMe: boolean,
): VotePanelView | null {
  if (!v || !v.active || !at.player || at.finalPhase || at.rally) return null;
  return { kind: v.kind, initiator: v.initiator, accepted: v.accepted, needed: v.needed, acceptedByMe };
}

/** Changes exactly when the panel must be rebuilt. Pure. */
export function votePanelKey(view: VotePanelView): string {
  return `${view.kind}|${view.initiator}|${view.accepted}/${view.needed}|${view.acceptedByMe}`;
}

export class VotePanel {
  /** What is drawn now, or null while hidden. */
  private key: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: { accept: () => void; decline: () => void },
  ) {}

  render(view: VotePanelView | null): void {
    if (!view) {
      this.root.classList.remove("show");
      this.key = null;
      return;
    }
    const key = votePanelKey(view);
    if (key === this.key) return;
    this.key = key;
    const rule = document.createElement("div");
    rule.className = "vt-rule";
    const title = document.createElement("div");
    title.className = "vt-title";
    title.textContent = view.kind === "rematch" ? "REMATCH?" : "RESET THE SET?";
    // The initiator's nickname is user input: textContent only.
    const who = document.createElement("span");
    who.className = "vt-who";
    who.textContent = view.initiator;
    const n = document.createElement("b");
    n.textContent = `${view.accepted}/${view.needed}`;
    const count = document.createElement("span");
    count.className = "vt-count";
    count.append(n, " accepted");
    const sub = document.createElement("div");
    sub.className = "vt-sub";
    sub.append(who, count);
    const accept = button("primary-btn", view.acceptedByMe ? "Accepted" : "Accept", this.handlers.accept);
    accept.disabled = view.acceptedByMe;
    const decline = button("ghost-btn", "Decline", this.handlers.decline);
    const actions = document.createElement("div");
    actions.className = "vt-actions";
    actions.append(accept, decline);
    this.root.replaceChildren(rule, title, sub, actions);
    this.root.classList.add("show");
  }
}
