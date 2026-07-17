import { describe, expect, it } from "vitest";
import {
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
  COARSE_POINTER_HEADER_REDUCED_GLYPH_ICON_BUTTON_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { HEADER_MAXIMIZE_ICON_BUTTON_CLASS } from "./AppPageHeader";

// Guards the shared header-control geometry that BB-63 depends on: the reduced
// glyph variant (used by the pane maximize/restore control) must keep the exact
// same button box — and therefore the pointer/focus hit target — as the
// standard header icon button, only painting the glyph smaller. Asserted at the
// token level rather than via a brittle full-class snapshot.

// The box tokens whose equality across variants preserves the hit target.
const BOX_TOKENS = [
  "h-[28px]",
  "w-[28px]",
  "rounded-md",
  "p-0",
  "max-md:pointer-coarse:h-[36px]",
  "max-md:pointer-coarse:w-[36px]",
];

function tokens(cls: string): Set<string> {
  return new Set(cls.split(/\s+/).filter(Boolean));
}

describe("header icon button sizing contract", () => {
  it("shares the standard button box (hit target) across the reduced variant", () => {
    const standard = tokens(COARSE_POINTER_HEADER_ICON_BUTTON_CLASS);
    const reduced = tokens(COARSE_POINTER_HEADER_REDUCED_GLYPH_ICON_BUTTON_CLASS);
    for (const token of BOX_TOKENS) {
      expect(standard.has(token), `standard missing ${token}`).toBe(true);
      expect(reduced.has(token), `reduced missing ${token}`).toBe(true);
    }
  });

  it("paints the reduced glyph smaller than the standard glyph in both pointer modes", () => {
    const standard = tokens(COARSE_POINTER_HEADER_ICON_BUTTON_CLASS);
    const reduced = tokens(COARSE_POINTER_HEADER_REDUCED_GLYPH_ICON_BUTTON_CLASS);

    // Fine pointer: standard 16px, reduced 13px.
    expect(standard.has("[&_svg]:size-[16px]")).toBe(true);
    expect(reduced.has("[&_svg]:size-[13px]")).toBe(true);
    expect(reduced.has("[&_svg]:size-[16px]")).toBe(false);

    // Coarse pointer: standard 20px, reduced 16px.
    expect(standard.has("max-md:pointer-coarse:[&_svg]:size-[20px]")).toBe(true);
    expect(reduced.has("max-md:pointer-coarse:[&_svg]:size-[16px]")).toBe(true);
    expect(reduced.has("max-md:pointer-coarse:[&_svg]:size-[20px]")).toBe(false);
  });

  it("wires the pane maximize control to the reduced-glyph geometry", () => {
    expect(HEADER_MAXIMIZE_ICON_BUTTON_CLASS).toBe(
      COARSE_POINTER_HEADER_REDUCED_GLYPH_ICON_BUTTON_CLASS,
    );
  });
});
