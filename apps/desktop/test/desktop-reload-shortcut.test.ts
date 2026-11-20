import { describe, expect, it } from "vitest";
import type { AppKeybinding, AppKeybindings } from "@bb/domain";
import {
  STARTUP_RELOAD_KEYBINDINGS,
  resolveDesktopReloadShortcut,
} from "../src/desktop-reload-shortcut.js";

type ReloadInput = Parameters<typeof resolveDesktopReloadShortcut>[0];

function input(overrides: Partial<ReloadInput> = {}): ReloadInput {
  return {
    alt: false,
    code: "KeyR",
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

function binding(
  command: AppKeybinding["command"],
  key: string,
  modifiers: Partial<AppKeybinding["shortcut"]>,
): AppKeybinding {
  return {
    command,
    desktopOnly: true,
    shortcut: {
      key,
      mod: modifiers.mod ?? false,
      meta: modifiers.meta ?? false,
      control: modifiers.control ?? false,
      alt: modifiers.alt ?? false,
      shift: modifiers.shift ?? false,
    },
    when: { all: ["mainSurface"], none: [] },
  };
}

function resolveOnMac(
  keyInput: ReloadInput,
  keybindings: AppKeybindings = STARTUP_RELOAD_KEYBINDINGS,
) {
  return resolveDesktopReloadShortcut(keyInput, keybindings, "darwin");
}

const MODIFIER_COMBINATIONS = [false, true].flatMap((meta) =>
  [false, true].flatMap((control) =>
    [false, true].flatMap((alt) =>
      [false, true].map((shift) => ({ meta, control, alt, shift })),
    ),
  ),
);

describe("resolveDesktopReloadShortcut", () => {
  it("maps Cmd+R and Cmd+Shift+R to reload actions before server config loads", () => {
    expect(resolveOnMac(input())).toBe("reload");
    expect(resolveOnMac(input({ shift: true }))).toBe("force-reload");
  });

  it.each([
    { layout: "Russian", key: "к", code: "KeyR" },
    { layout: "Greek", key: "ρ", code: "KeyR" },
    { layout: "Dvorak", key: "r", code: "KeyO" },
  ])("reloads from the R key on a $layout layout", ({ key, code }) => {
    expect(resolveOnMac(input({ key, code }))).toBe("reload");
  });

  it("follows Latin layouts rather than the physical R position", () => {
    expect(resolveOnMac(input({ key: "p", code: "KeyR" }))).toBeNull();
  });

  it("ignores unrelated, repeated, and composing input", () => {
    expect(resolveOnMac(input({ key: "x" }))).toBeNull();
    expect(resolveOnMac(input({ meta: false }))).toBeNull();
    expect(resolveOnMac(input({ alt: true }))).toBeNull();
    expect(resolveOnMac(input({ isAutoRepeat: true }))).toBeNull();
    expect(resolveOnMac(input({ isComposing: true }))).toBeNull();
    expect(resolveOnMac(input({ type: "keyUp" }))).toBeNull();
  });

  it.each(["darwin", "win32", "linux"])(
    "intercepts no keystroke on %s that the keybindings do not bind",
    (platform) => {
      for (const key of ["r", "R", "к", "F5", "x"]) {
        for (const modifiers of MODIFIER_COMBINATIONS) {
          expect(
            resolveDesktopReloadShortcut(
              input({ key, ...modifiers }),
              [],
              platform,
            ),
          ).toBeNull();
        }
      }
    },
  );

  it("follows a rebound reload and releases the old shortcut to the page", () => {
    const rebound = [
      binding("window.reload", "l", { mod: true, alt: true }),
      binding("window.forceReload", "F5", {}),
    ];

    expect(resolveOnMac(input(), rebound)).toBeNull();
    expect(resolveOnMac(input({ shift: true }), rebound)).toBeNull();
    expect(
      resolveOnMac(input({ key: "l", code: "KeyL", alt: true }), rebound),
    ).toBe("reload");
    expect(
      resolveOnMac(input({ key: "F5", code: "F5", meta: false }), rebound),
    ).toBe("force-reload");
  });

  it("keeps the macOS default off Ctrl+R elsewhere, where terminals use it", () => {
    for (const platform of ["win32", "linux"]) {
      expect(
        resolveDesktopReloadShortcut(
          input({ meta: false, control: true }),
          STARTUP_RELOAD_KEYBINDINGS,
          platform,
        ),
      ).toBeNull();
    }
  });
});
