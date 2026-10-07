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
