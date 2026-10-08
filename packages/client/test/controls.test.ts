import { describe, expect, it } from "vitest";
import { controlRows, legendRows, shouldShowCard } from "../src/hud/controls.js";

const keysOf = (rows: { keys: string[] }[]) => rows.map((r) => r.keys.join("+"));

describe("controlRows", () => {
  it("gives a Player WASD and the arrow keys to move", () => {
    const { move } = controlRows("player");
    expect(keysOf(move)).toEqual(["WASD", "ARROWS"]);
  });

  it("gives a Player left click for the Drive and right click for the Lob, then the automatic Smash", () => {
    const { hit } = controlRows("player");
    expect(hit[0]).toEqual({ keys: ["LMB"], label: "Drive" });
    expect(hit[1]).toEqual({ keys: ["RMB"], label: "Lob" });
    expect(hit.some((r) => r.keys.length === 0 && r.label === "Smash: automatic when the ball is high")).toBe(true);
  });

  it("gives a Player the serve, react, sound, skip and bot keys", () => {
    const { other } = controlRows("player");
    expect(other[0]).toEqual({ keys: ["SPACE"], label: "Serve", note: "SPACE to toss · CLICK at the top" });
    expect(keysOf(other)).toEqual(["SPACE", "E", "M", "ENTER", "B+N"]);
    expect(other.map((r) => r.label)).toEqual(["Serve", "React", "Sound", "Skip replay", "Add / clear bots"]);
  });

  it("gives a Spectator only TAKE SEAT and M: nothing to move, hit or serve with", () => {
    const rows = controlRows("spectator");
    expect(rows.move).toEqual([]);
    expect(rows.hit).toEqual([]);
    expect(keysOf(rows.other)).toEqual(["TAKE SEAT", "M"]);
  });
});

describe("legendRows", () => {
  it("shows a Player the Drive, the Lob and the serve", () => {
    expect(legendRows("player")).toEqual([
      { keys: ["LMB"], label: "Drive" },
      { keys: ["RMB"], label: "Lob" },
      { keys: ["SPACE"], label: "Serve" },
    ]);
  });

  it("shows a Spectator nothing beside the ? key", () => {
    expect(legendRows("spectator")).toEqual([]);
  });
});

describe("shouldShowCard", () => {
  it("shows the card to a Player who has not seen it", () => {
    expect(shouldShowCard(false, "player")).toBe(true);
  });

  it("does not show it again once seen", () => {
    expect(shouldShowCard(true, "player")).toBe(false);
  });

  it("never opens it by itself for a Spectator", () => {
    expect(shouldShowCard(false, "spectator")).toBe(false);
    expect(shouldShowCard(true, "spectator")).toBe(false);
  });
});
