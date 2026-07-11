import { describe, expect, it } from "vitest";
import { resolveDesktopReloadShortcut } from "../src/desktop-reload-shortcut.js";

function input(
  overrides: Partial<Parameters<typeof resolveDesktopReloadShortcut>[0]> = {},
): Parameters<typeof resolveDesktopReloadShortcut>[0] {
  return {
    alt: false,
    control: false,
    isAutoRepeat: false,
    isComposing: false,
    key: "r",
    meta: true,
    shift: false,
    type: "keyDown",
    ...overrides,
  };
}

describe("resolveDesktopReloadShortcut", () => {
  it("maps Cmd+R and Cmd+Shift+R to reload actions", () => {
    expect(resolveDesktopReloadShortcut(input())).toBe("reload");
    expect(resolveDesktopReloadShortcut(input({ shift: true }))).toBe(
      "force-reload",
    );
  });

  it("ignores unrelated, repeated, and composing input", () => {
    expect(resolveDesktopReloadShortcut(input({ key: "x" }))).toBeNull();
    expect(resolveDesktopReloadShortcut(input({ meta: false }))).toBeNull();
    expect(resolveDesktopReloadShortcut(input({ alt: true }))).toBeNull();
    expect(
      resolveDesktopReloadShortcut(input({ isAutoRepeat: true })),
    ).toBeNull();
    expect(
      resolveDesktopReloadShortcut(input({ isComposing: true })),
    ).toBeNull();
    expect(resolveDesktopReloadShortcut(input({ type: "keyUp" }))).toBeNull();
  });
});
