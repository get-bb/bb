import { describe, expect, it } from "vitest";
import {
  decorationClassName,
  decorationCss,
  resolveColor,
} from "./decoration-styles.js";

const COLORS = {
  "textLink.activeForeground": "#4daafc",
  "editor.background": "#1f1f1f",
};

describe("resolveColor", () => {
  it("passes a hex literal through", () => {
    expect(resolveColor("#FF5555", COLORS)).toBe("#FF5555");
  });

  it("passes an rgba literal through", () => {
    expect(resolveColor("rgba(255, 255, 255, 0.25)", COLORS)).toBe(
      "rgba(255, 255, 255, 0.25)",
    );
  });

  it("resolves a theme reference against the workbench colours", () => {
    expect(resolveColor("theme.textLink.activeForeground", COLORS)).toBe(
      "#4daafc",
    );
  });

  it("returns undefined for a theme reference the theme lacks", () => {
    expect(resolveColor("theme.not.a.color", COLORS)).toBeUndefined();
  });

  it("rejects a value carrying a second declaration", () => {
    expect(resolveColor("red;background:url(x)", COLORS)).toBeUndefined();
  });

  it("rejects a value that would close the rule block", () => {
    expect(resolveColor("#fff}body{display:none", COLORS)).toBeUndefined();
  });
});

describe("decorationCss", () => {
  it("marks colour important so it beats Monaco's own token rules", () => {
    expect(decorationCss({ color: "#FF5555" }, COLORS)).toBe(
      "color:#FF5555 !important",
    );
  });

  it("emits background, weight and decoration together", () => {
    expect(
      decorationCss(
        {
          backgroundColor: "#ffcc00",
          color: "#1f1f1f",
          fontWeight: "bold",
          textDecoration: "line-through",
        },
        COLORS,
      ),
    ).toBe(
      "color:#1f1f1f !important;background-color:#ffcc00;font-weight:bold;text-decoration:line-through",
    );
  });

  it("drops an unsupported font weight", () => {
    expect(decorationCss({ fontWeight: "url(x)" }, COLORS)).toBe("");
  });

  it("drops an unsupported text decoration", () => {
    expect(decorationCss({ textDecoration: "expression(x)" }, COLORS)).toBe("");
  });

  it("returns empty when nothing survives, so no class is made", () => {
    expect(decorationCss({ overviewRulerColor: "#fff" }, COLORS)).toBe("");
  });
});

describe("decorationClassName", () => {
  it("is stable for the same declarations", () => {
    expect(decorationClassName("color:red")).toBe(
      decorationClassName("color:red"),
    );
  });

  it("differs for different declarations", () => {
    expect(decorationClassName("color:red")).not.toBe(
      decorationClassName("color:blue"),
    );
  });

  it("is a valid CSS class name", () => {
    expect(decorationClassName("color:rgba(1,2,3,.5)")).toMatch(
      /^bb-notes-hl-[a-z0-9]+$/,
    );
  });
});
