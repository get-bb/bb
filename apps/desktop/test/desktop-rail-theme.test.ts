import { describe, expect, it } from "vitest";
import {
  DEFAULT_RAIL_THEME_DARK,
  DEFAULT_RAIL_THEME_LIGHT,
  resolveRailTheme,
  themeModeFromPayload,
} from "../src/desktop-rail-theme.js";

describe("resolveRailTheme", () => {
  it("fills default anchors for legacy light/dark strings", () => {
    expect(resolveRailTheme("dark")).toEqual(DEFAULT_RAIL_THEME_DARK);
    expect(resolveRailTheme("light")).toEqual(DEFAULT_RAIL_THEME_LIGHT);
  });

  it("passes through resolved payloads", () => {
    const resolved = {
      canvasColor: "oklch(0.3 0.05 250)",
      inkColor: "oklch(0.9 0.02 250)",
      mode: "dark" as const,
    };
    expect(resolveRailTheme(resolved)).toEqual(resolved);
  });

  it("falls back to mode defaults when colors are blank", () => {
    expect(
      resolveRailTheme({
        canvasColor: "  ",
        inkColor: "oklch(0.81 0 0)",
        mode: "dark",
      }),
    ).toEqual(DEFAULT_RAIL_THEME_DARK);
  });
});

describe("themeModeFromPayload", () => {
  it("reads mode from either shape", () => {
    expect(themeModeFromPayload("light")).toBe("light");
    expect(
      themeModeFromPayload({
        canvasColor: "oklch(1 0 0)",
        inkColor: "oklch(0.3 0 0)",
        mode: "dark",
      }),
    ).toBe("dark");
  });
});
