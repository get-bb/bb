// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards the boot-path split of the shared `Icon`: the core map renders
 * synchronously from the boot chunk, everything else comes from the lazily
 * loaded extended registry with a same-size placeholder in the meantime, and
 * the two halves stay disjoint and complete. The test setup file preloads the
 * extended registry for every other test, so these tests reset the module
 * graph to observe the cold state the app is in before a route chunk loads.
 */

const require = createRequire(import.meta.url);
const sharedUiIconDir = dirname(require.resolve("@bb/shared-ui/icon"));

type IconModule = typeof import("@bb/shared-ui/icon");
type IconRegistryModule = typeof import("@bb/shared-ui/icon-registry");
type IconExtendedModule = typeof import("@bb/shared-ui/icon-extended");

async function freshIconModules(): Promise<{
  icon: IconModule;
  registry: IconRegistryModule;
}> {
  vi.resetModules();
  const [icon, registry] = await Promise.all([
    import("@bb/shared-ui/icon"),
    import("@bb/shared-ui/icon-registry"),
  ]);
  return { icon, registry };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("Icon core/extended split", () => {
  it("renders a core glyph synchronously before the extended registry loads", async () => {
    const { icon, registry } = await freshIconModules();
    expect(registry.getExtendedIcons()).toBeNull();

    const view = render(<icon.Icon name="ChevronRight" aria-hidden />);
    const svg = view.container.querySelector("svg[data-icon=ChevronRight]");
    expect(svg).not.toBeNull();
    expect(svg?.childElementCount).toBeGreaterThan(0);
    expect(svg?.hasAttribute("data-icon-pending")).toBe(false);
    // Rendering only core glyphs must not pull the extended registry in.
    expect(registry.getExtendedIcons()).toBeNull();
  });

  it("renders an extended glyph as a same-size placeholder, then fills it in when the registry loads", async () => {
    const { icon, registry } = await freshIconModules();

    const view = render(<icon.Icon name="Palette" aria-hidden />);
    const pending = view.container.querySelector("svg[data-icon=Palette]");
    expect(pending).not.toBeNull();
    expect(pending?.hasAttribute("data-icon-pending")).toBe(true);
    expect(pending?.childElementCount).toBe(0);
    // Same box as a loaded glyph, so nothing shifts when the artwork lands.
    expect(pending?.getAttribute("width")).toBe("24");
    expect(pending?.getAttribute("height")).toBe("24");

    // Rendering the placeholder is what kicks off the on-demand load: no
    // caller preloads here, so a regression that stops `Icon` from requesting
    // the registry would leave this waiting forever.
    await act(async () => {
      await vi.waitUntil(() => registry.getExtendedIcons() !== null, {
        timeout: 5000,
      });
    });

    expect(registry.getExtendedIcons()).not.toBeNull();
    // Idempotent once the registry is in: resolves without a second load.
    await expect(icon.preloadExtendedIcons()).resolves.toBeUndefined();
    const loaded = view.container.querySelector("svg[data-icon=Palette]");
    expect(loaded?.hasAttribute("data-icon-pending")).toBe(false);
    expect(loaded?.childElementCount).toBeGreaterThan(0);
  });

  it("keeps ICON_NAMES equal to the disjoint union of the core and extended maps", async () => {
    const { icon, registry } = await freshIconModules();
    const extended: IconExtendedModule =
      await import("@bb/shared-ui/icon-extended");

    const extendedKeys = Object.keys(extended.EXTENDED_ICON_MAP).sort();
    expect(extendedKeys).toEqual([...registry.EXTENDED_ICON_NAMES].sort());
    expect(new Set(icon.ICON_NAMES).size).toBe(icon.ICON_NAMES.length);
    for (const name of registry.EXTENDED_ICON_NAMES) {
      expect(icon.ICON_NAMES).toContain(name);
    }
    // Every extended name resolves to real artwork once registered.
    for (const name of registry.EXTENDED_ICON_NAMES) {
      expect(extended.EXTENDED_ICON_MAP[name].length).toBeGreaterThan(0);
    }
  });

  // The whole point of the split is that the boot chunk carries only the core
  // map: `icon.tsx` may reach the extended registry through `import()` alone,
  // and the names-only registry module must not import any artwork.
  it("keeps the extended artwork off the static import graph of the boot modules", () => {
    const iconSource = readFileSync(join(sharedUiIconDir, "icon.tsx"), "utf8");
    const registrySource = readFileSync(
      join(sharedUiIconDir, "icon-registry.ts"),
      "utf8",
    );

    expect(iconSource).not.toMatch(/from\s+["']\.\/icon-extended["']/);
    expect(iconSource).toMatch(/import\(\s*["']\.\/icon-extended["']\s*\)/);
    expect(registrySource).not.toMatch(/@hugeicons\/core-free-icons/);
    expect(registrySource).not.toMatch(/from\s+["']\.\/icon-extended["']/);
  });
});
