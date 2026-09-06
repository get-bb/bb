import { describe, expect, it } from "vitest";
import {
  createDesktopAutoUpdateFeedConfig,
  createDesktopAutoUpdateFeedConfigForChannel,
  createDesktopReleaseInfo,
  createDesktopUpdateFeedUrl,
  createDesktopUpdateFeedUrlForChannel,
  resolveDesktopUpdateSupport,
} from "../src/desktop-update-provider.js";

describe("desktop release info", () => {
  it("keeps the Windows feed in its own tag namespace per channel", () => {
    expect(createDesktopReleaseInfo("latest")).toMatchObject({
      releaseTag: "desktop-latest",
      updateReleaseBaseUrl:
        "https://github.com/get-bb/bb/releases/download/desktop-latest/",
      windowsReleaseTag: "desktop-win-latest",
      windowsUpdateReleaseBaseUrl:
        "https://github.com/get-bb/bb/releases/download/desktop-win-latest/",
    });
    expect(createDesktopReleaseInfo("nightly")).toMatchObject({
      releaseTag: "desktop-nightly",
      updateReleaseBaseUrl:
        "https://github.com/get-bb/bb/releases/download/desktop-nightly/",
      windowsReleaseTag: "desktop-win-nightly",
      windowsUpdateReleaseBaseUrl:
        "https://github.com/get-bb/bb/releases/download/desktop-win-nightly/",
    });
  });
});

describe("desktop update feed url", () => {
  it("gives each platform its own feed file inside one release tag", () => {
    expect(createDesktopUpdateFeedUrl("macos")).toBe(
      "https://github.com/get-bb/bb/releases/download/desktop-latest/desktop-version.json",
    );
    expect(createDesktopUpdateFeedUrl("linux")).toBe(
      "https://github.com/get-bb/bb/releases/download/desktop-latest/desktop-version-linux.json",
    );
  });

  it("polls the Windows moving tag instead of the shared release tag", () => {
    expect(createDesktopUpdateFeedUrl("windows")).toBe(
      "https://github.com/get-bb/bb/releases/download/desktop-win-latest/",
    );
  });

  it("resolves the version feed url per platform and channel", () => {
    expect(createDesktopUpdateFeedUrlForChannel("macos", "latest")).toBe(
      "https://github.com/get-bb/bb/releases/download/desktop-latest/desktop-version.json",
    );
    expect(createDesktopUpdateFeedUrlForChannel("macos", "nightly")).toBe(
      "https://github.com/get-bb/bb/releases/download/desktop-nightly/desktop-version.json",
    );
    expect(createDesktopUpdateFeedUrlForChannel("linux", "latest")).toBe(
      "https://github.com/get-bb/bb/releases/download/desktop-latest/desktop-version-linux.json",
    );
    expect(createDesktopUpdateFeedUrlForChannel("linux", "nightly")).toBe(
      "https://github.com/get-bb/bb/releases/download/desktop-nightly/desktop-version-linux.json",
    );
    expect(createDesktopUpdateFeedUrlForChannel("windows", "latest")).toBe(
      "https://github.com/get-bb/bb/releases/download/desktop-win-latest/",
    );
    expect(createDesktopUpdateFeedUrlForChannel("windows", "nightly")).toBe(
      "https://github.com/get-bb/bb/releases/download/desktop-win-nightly/",
    );
  });
});

describe("desktop auto-update feed config", () => {
  it("points macOS and Linux at the shared release tag", () => {
    expect(createDesktopAutoUpdateFeedConfig("macos")).toEqual({
      channel: "latest",
      provider: "generic",
      url: "https://github.com/get-bb/bb/releases/download/desktop-latest/",
    });
    expect(createDesktopAutoUpdateFeedConfig("linux")).toEqual({
      channel: "latest",
      provider: "generic",
      url: "https://github.com/get-bb/bb/releases/download/desktop-latest/",
    });
  });

  it("points Windows at its own moving tag so installs can find a feed", () => {
    expect(createDesktopAutoUpdateFeedConfig("windows")).toEqual({
      channel: "latest",
      provider: "generic",
      url: "https://github.com/get-bb/bb/releases/download/desktop-win-latest/",
    });
  });

  it("resolves the auto-update base url per platform and channel", () => {
    expect(
      createDesktopAutoUpdateFeedConfigForChannel("macos", "latest"),
    ).toEqual({
      channel: "latest",
      provider: "generic",
      url: "https://github.com/get-bb/bb/releases/download/desktop-latest/",
    });
    expect(
      createDesktopAutoUpdateFeedConfigForChannel("macos", "nightly"),
    ).toEqual({
      channel: "nightly",
      provider: "generic",
      url: "https://github.com/get-bb/bb/releases/download/desktop-nightly/",
    });
    expect(
      createDesktopAutoUpdateFeedConfigForChannel("linux", "nightly"),
    ).toEqual({
      channel: "nightly",
      provider: "generic",
      url: "https://github.com/get-bb/bb/releases/download/desktop-nightly/",
    });
    expect(
      createDesktopAutoUpdateFeedConfigForChannel("windows", "latest"),
    ).toEqual({
      channel: "latest",
      provider: "generic",
      url: "https://github.com/get-bb/bb/releases/download/desktop-win-latest/",
    });
    expect(
      createDesktopAutoUpdateFeedConfigForChannel("windows", "nightly"),
    ).toEqual({
      channel: "nightly",
      provider: "generic",
      url: "https://github.com/get-bb/bb/releases/download/desktop-win-nightly/",
    });
  });
});

const APP_IMAGE_PATH = "/home/user/Apps/bb-0.37.0-x86_64.AppImage";
const alwaysReplaceable = () => true;
const neverReplaceable = () => false;

describe("desktop update support", () => {
  it("enables both update paths on macOS", () => {
    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: neverReplaceable,
        env: {},
        platform: "macos",
      }),
    ).toEqual({ autoUpdate: true, versionCheck: true });
  });

  it("installs updates on Linux only inside an AppImage", () => {
    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: alwaysReplaceable,
        env: { APPIMAGE: APP_IMAGE_PATH },
        platform: "linux",
      }),
    ).toEqual({ autoUpdate: true, versionCheck: true });
    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: alwaysReplaceable,
        env: {},
        platform: "linux",
      }),
    ).toEqual({ autoUpdate: false, versionCheck: true });
    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: alwaysReplaceable,
        env: { APPIMAGE: "  " },
        platform: "linux",
      }),
    ).toEqual({ autoUpdate: false, versionCheck: true });
  });

  it("refuses to install into an AppImage it cannot replace", () => {
    const checked: Array<string> = [];

    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: (path) => {
          checked.push(path);
          return false;
        },
        env: { APPIMAGE: APP_IMAGE_PATH },
        platform: "linux",
      }),
    ).toEqual({ autoUpdate: false, versionCheck: true });
    expect(checked).toEqual([APP_IMAGE_PATH]);
  });

  it("serves Windows updates through the installer without the version feed", () => {
    let consulted = false;

    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: () => {
          consulted = true;
          return false;
        },
        env: { APPIMAGE: APP_IMAGE_PATH },
        platform: "windows",
      }),
    ).toEqual({ autoUpdate: true, versionCheck: false });
    expect(consulted).toBe(false);
  });

  it("does not consult the filesystem on macOS", () => {
    let consulted = false;

    resolveDesktopUpdateSupport({
      canReplaceAppImage: () => {
        consulted = true;
        return true;
      },
      env: { APPIMAGE: APP_IMAGE_PATH },
      platform: "macos",
    });

    expect(consulted).toBe(false);
  });
});
