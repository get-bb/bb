import { describe, expect, it, vi } from "vitest";
import {
  createDesktopTray,
  DESKTOP_TRAY_TOOLTIP,
  shouldCreateTrayIcon,
  shouldQuitOnWindowAllClosed,
  type DesktopTrayDeps,
  type DesktopTrayHandle,
  type DesktopTrayMenuArgs,
} from "../src/desktop-tray.js";

function createFakeTray(): DesktopTrayHandle & {
  clicks: Array<() => void>;
  menus: unknown[];
  tooltips: string[];
} {
  const clicks: Array<() => void> = [];
  const menus: unknown[] = [];
  const tooltips: string[] = [];
  return {
    clicks,
    destroy() {},
    menus,
    tooltips,
    on(event, listener) {
      expect(event).toBe("click");
      clicks.push(listener);
    },
    setContextMenu(menu) {
      menus.push(menu);
    },
    setToolTip(tooltip) {
      tooltips.push(tooltip);
    },
  };
}

function createDeps(fake: DesktopTrayHandle): DesktopTrayDeps & {
  builtMenus: DesktopTrayMenuArgs[];
  createdIcons: string[];
} {
  const builtMenus: DesktopTrayMenuArgs[] = [];
  const createdIcons: string[] = [];
  return {
    builtMenus,
    createdIcons,
    buildMenu(args) {
      builtMenus.push(args);
      return { kind: "fake-menu" };
    },
    createIcon(imagePath) {
      createdIcons.push(imagePath);
      return fake;
    },
  };
}

describe("shouldQuitOnWindowAllClosed", () => {
  it("keeps macOS running with no windows", () => {
    expect(shouldQuitOnWindowAllClosed({ platform: "darwin" })).toBe(false);
  });

  it("keeps Windows running with no windows so the tray owns the lifetime", () => {
    expect(shouldQuitOnWindowAllClosed({ platform: "win32" })).toBe(false);
  });

  it("still quits Linux with no windows", () => {
    expect(shouldQuitOnWindowAllClosed({ platform: "linux" })).toBe(true);
  });
});

describe("shouldCreateTrayIcon", () => {
  it("creates a tray icon only on Windows", () => {
    expect(shouldCreateTrayIcon({ platform: "win32" })).toBe(true);
    expect(shouldCreateTrayIcon({ platform: "darwin" })).toBe(false);
    expect(shouldCreateTrayIcon({ platform: "linux" })).toBe(false);
  });
});

describe("createDesktopTray", () => {
  it("creates nothing on macOS or Linux", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const fake = createFakeTray();
      const deps = createDeps(fake);
      expect(
        createDesktopTray({
          deps,
          iconPath: "icon.png",
          onQuit: () => {},
          onShow: () => {},
          platform,
        }),
      ).toBeNull();
      expect(deps.createdIcons).toEqual([]);
    }
  });

  it("wires the Windows tray icon to show and quit", () => {
    const fake = createFakeTray();
    const deps = createDeps(fake);
    const onShow = vi.fn();
    const onQuit = vi.fn();

    const tray = createDesktopTray({
      deps,
      iconPath: "icon.png",
      onQuit,
      onShow,
      platform: "win32",
    });

    expect(tray).toBe(fake);
    expect(deps.createdIcons).toEqual(["icon.png"]);
    expect(fake.tooltips).toEqual([DESKTOP_TRAY_TOOLTIP]);
    expect(fake.menus).toEqual([{ kind: "fake-menu" }]);
    expect(fake.clicks).toHaveLength(1);

    fake.clicks[0]?.();
    expect(onShow).toHaveBeenCalledTimes(1);

    expect(deps.builtMenus).toHaveLength(1);
    deps.builtMenus[0]?.onShow();
    deps.builtMenus[0]?.onQuit();
    expect(onShow).toHaveBeenCalledTimes(2);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});
