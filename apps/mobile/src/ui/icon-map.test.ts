import { describe, expect, it } from "vitest";
import { ICON_MAP, isIconName } from "./icon-map";

describe("ICON_MAP", () => {
  it("every entry is non-empty svg element data", () => {
    for (const [name, glyph] of Object.entries(ICON_MAP)) {
      expect(Array.isArray(glyph), name).toBe(true);
      expect(glyph.length, name).toBeGreaterThan(0);
      for (const [tag, attrs] of glyph) {
        expect(typeof tag).toBe("string");
        expect(typeof attrs).toBe("object");
      }
    }
  });

  it("isIconName narrows strings without walking the prototype", () => {
    expect(isIconName("Plus")).toBe(true);
    expect(isIconName("toString")).toBe(false);
    expect(isIconName("")).toBe(false);
    expect(isIconName(42)).toBe(false);
  });
});
