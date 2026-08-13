import { describe, expect, it } from "vitest";
import {
  createDesktopUpdateFeedUrl,
  resolveDesktopUpdateSupport,
} from "../src/desktop-update-provider.js";

describe("desktop update feed url", () => {
  it("gives each platform its own feed file inside one release tag", () => {
    // macOS and Linux assets share the desktop-latest release, so a single
    // feed name would make the last publish overwrite the other platform.
    expect(createDesktopUpdateFeedUrl("macos")).toBe(
      "https://github.com/get-bb/bb/releases/download/desktop-latest/desktop-version.json",
    );
    expect(createDesktopUpdateFeedUrl("linux")).toBe(
      "https://github.com/get-bb/bb/releases/download/desktop-latest/desktop-version-linux.json",
    );
  });
});

describe("desktop update support", () => {
  it("enables both update paths on macOS", () => {
    expect(resolveDesktopUpdateSupport({ env: {}, platform: "macos" })).toEqual(
      {
        autoUpdate: true,
        versionCheck: true,
      },
    );
  });

  it("installs updates on Linux only inside an AppImage", () => {
    // electron-updater replaces the running AppImage file in place. A distro
    // package or an extracted directory has nothing to replace, so it would
    // fail every download instead of quietly doing nothing.
    expect(
      resolveDesktopUpdateSupport({
        env: { APPIMAGE: "/home/user/Apps/bb-0.37.0-x86_64.AppImage" },
        platform: "linux",
      }),
    ).toEqual({ autoUpdate: true, versionCheck: true });
    expect(resolveDesktopUpdateSupport({ env: {}, platform: "linux" })).toEqual(
      {
        autoUpdate: false,
        versionCheck: true,
      },
    );
    expect(
      resolveDesktopUpdateSupport({
        env: { APPIMAGE: "  " },
        platform: "linux",
      }),
    ).toEqual({ autoUpdate: false, versionCheck: true });
  });
});
