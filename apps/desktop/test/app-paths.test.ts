import { describe, expect, it } from "vitest";
import {
  resolveDesktopBridgePath,
  resolveDesktopIconPath,
  type DesktopPathContext,
} from "../src/app-paths.js";

describe("desktop app paths", () => {
  it("resolves the packaged bb-app bridge beside the active asar", () => {
    const paths: DesktopPathContext = {
      appPath: "/Applications/bb.app/Contents/Resources/app.asar",
      isPackaged: true,
      platform: "darwin",
      resourcesPath: "/Applications/bb.app/Contents/Resources",
    };

    expect(resolveDesktopBridgePath({ paths })).toBe(
      "/Applications/bb.app/Contents/Resources/app.asar.unpacked/dist/bb-app-bridge.mjs",
    );
  });

  it("resolves the universal packaged bb-app bridge beside the selected arch asar", () => {
    const paths: DesktopPathContext = {
      appPath: "/Applications/bb.app/Contents/Resources/app-arm64.asar",
      isPackaged: true,
      platform: "darwin",
      resourcesPath: "/Applications/bb.app/Contents/Resources",
    };

    expect(resolveDesktopBridgePath({ paths })).toBe(
      "/Applications/bb.app/Contents/Resources/app-arm64.asar.unpacked/dist/bb-app-bridge.mjs",
    );
  });

  it("uses the release-specific icon inside packaged apps", () => {
    const paths: DesktopPathContext = {
      appPath: "/Applications/bb Nightly.app/Contents/Resources/app.asar",
      isPackaged: true,
      platform: "darwin",
      resourcesPath: "/Applications/bb Nightly.app/Contents/Resources",
    };

    expect(
      resolveDesktopIconPath({
        packagedIconFileName: "icon-nightly.png",
        paths,
      }),
    ).toBe(
      "/Applications/bb Nightly.app/Contents/Resources/app.asar/assets/icon-nightly.png",
    );
  });

  it("keeps the development icon independent of the release channel", () => {
    const paths: DesktopPathContext = {
      appPath: "/checkout/apps/desktop",
      isPackaged: false,
      platform: "linux",
      resourcesPath: "/checkout/apps/desktop",
    };

    expect(
      resolveDesktopIconPath({
        packagedIconFileName: "icon-nightly.png",
        paths,
      }),
    ).toBe("/checkout/apps/desktop/assets/icon-dev.png");
  });

  it("resolves the packaged bb-app bridge with Windows separators", () => {
    const paths: DesktopPathContext = {
      appPath: "C:\\Program Files\\bb wn\\resources\\app.asar",
      isPackaged: true,
      platform: "win32",
      resourcesPath: "C:\\Program Files\\bb wn\\resources",
    };

    expect(resolveDesktopBridgePath({ paths })).toBe(
      "C:\\Program Files\\bb wn\\resources\\app.asar.unpacked\\dist\\bb-app-bridge.mjs",
    );
  });

  it("resolves the development icon with Windows separators", () => {
    const paths: DesktopPathContext = {
      appPath: "C:\\checkout\\apps\\desktop",
      isPackaged: false,
      platform: "win32",
      resourcesPath: "C:\\checkout\\apps\\desktop",
    };

    expect(
      resolveDesktopIconPath({
        packagedIconFileName: "icon-nightly.png",
        paths,
      }),
    ).toBe("C:\\checkout\\apps\\desktop\\assets\\icon-dev.png");
  });
});
