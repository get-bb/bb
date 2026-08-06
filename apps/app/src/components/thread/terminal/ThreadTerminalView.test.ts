import { describe, expect, it, vi } from "vitest";
import {
  buildTerminalThemeFromCssColors,
  loadTerminalWebglRenderer,
} from "./ThreadTerminalView";

describe("buildTerminalThemeFromCssColors", () => {
  it("paints the terminal canvas and cursor cutout with the sidebar surface", () => {
    const get = vi.fn((name: string) => name);

    const theme = buildTerminalThemeFromCssColors(get);

    expect(theme.background).toBe("--sidebar");
    expect(theme.cursorAccent).toBe("--sidebar");
  });
});

describe("loadTerminalWebglRenderer", () => {
  it("loads the accelerated renderer and falls back when its context is lost", () => {
    let onContextLoss = () => {};
    const addon = {
      activate: vi.fn(),
      dispose: vi.fn(),
      onContextLoss: vi.fn((listener: () => void) => {
        onContextLoss = listener;
        return { dispose: vi.fn() };
      }),
    };
    const terminal = { loadAddon: vi.fn() };

    expect(loadTerminalWebglRenderer(terminal, () => addon)).toBe(true);
    expect(terminal.loadAddon).toHaveBeenCalledWith(addon);

    onContextLoss();

    expect(addon.dispose).toHaveBeenCalledOnce();
  });

  it("keeps the DOM renderer when WebGL addon registration fails", () => {
    const addon = {
      activate: vi.fn(),
      dispose: vi.fn(),
      onContextLoss: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const terminal = {
      loadAddon: vi.fn(() => {
        throw new Error("WebGL unavailable");
      }),
    };

    expect(loadTerminalWebglRenderer(terminal, () => addon)).toBe(false);
    expect(addon.dispose).toHaveBeenCalledOnce();
  });
});
