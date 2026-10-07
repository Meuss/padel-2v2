import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PALETTE } from "../src/world/palette.js";

const css = readFileSync(new URL("../src/hud/hud.css", import.meta.url), "utf8");

function token(name: string): string | undefined {
  return new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
}

describe("HUD tokens", () => {
  it("use the world palette's team colours", () => {
    expect(token("azul")).toBe(PALETTE.azul);
    expect(token("rojo")).toBe(PALETTE.rojo);
  });

  it("use the ball's optic yellow for the accent", () => {
    expect(token("optic")).toBe(PALETTE.ball);
  });
});
