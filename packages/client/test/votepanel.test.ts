import type { VoteMsg } from "@padel/shared";
import { describe, expect, it } from "vitest";
import { votePanelKey, votePanelView } from "../src/hud/votepanel.js";

const open: VoteMsg = { t: "vote", active: true, kind: "reset", initiator: "Ana", accepted: 1, needed: 2 };
const between = { player: true, finalPhase: false, rally: false };

describe("votePanelView", () => {
  it("shows an open vote to a Player between points", () => {
    expect(votePanelView(open, between, false)).toEqual({ kind: "reset", initiator: "Ana", accepted: 1, needed: 2, acceptedByMe: false });
  });

  it("hides with no open vote, for a spectator, during a rally, and while the Final card has the vote", () => {
    expect(votePanelView(null, between, false)).toBeNull();
    expect(votePanelView({ ...open, active: false }, between, false)).toBeNull();
    expect(votePanelView(open, { ...between, player: false }, false)).toBeNull();
    expect(votePanelView(open, { ...between, rally: true }, false)).toBeNull();
    expect(votePanelView(open, { ...between, finalPhase: true }, false)).toBeNull();
  });
});

describe("votePanelKey", () => {
  it("changes with the count and our answer, and only then", () => {
    const view = votePanelView(open, between, false)!;
    expect(votePanelKey(view)).toBe(votePanelKey({ ...view }));
    expect(votePanelKey(view)).not.toBe(votePanelKey({ ...view, accepted: 2 }));
    expect(votePanelKey(view)).not.toBe(votePanelKey({ ...view, acceptedByMe: true }));
    expect(votePanelKey(view)).not.toBe(votePanelKey({ ...view, kind: "rematch" }));
  });
});
