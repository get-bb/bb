import { describe, expect, it } from "vitest";
import {
  resolveDesktopBridgePath,
  type DesktopPathContext,
} from "../src/app-paths.js";

describe("desktop app paths", () => {
  it("resolves the development bb-app bridge beside the app path", () => {
    const paths: DesktopPathContext = {
      appPath: "/repo/apps/desktop",
      isPackaged: false,
      resourcesPath: "/repo/apps/desktop",
    };

    expect(resolveDesktopBridgePath({ paths })).toBe(
      "/repo/apps/desktop/dist/bb-app-bridge.mjs",
    );
  });

  it("resolves the packaged bb-app bridge beside the active asar", () => {
    const paths: DesktopPathContext = {
      appPath: "/Applications/bb.app/Contents/Resources/app.asar",
      isPackaged: true,
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
      resourcesPath: "/Applications/bb.app/Contents/Resources",
    };

    expect(resolveDesktopBridgePath({ paths })).toBe(
      "/Applications/bb.app/Contents/Resources/app-arm64.asar.unpacked/dist/bb-app-bridge.mjs",
    );
  });
});
