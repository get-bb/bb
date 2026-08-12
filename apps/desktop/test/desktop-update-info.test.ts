import { describe, expect, it } from "vitest";
import {
  desktopPlatformFromNode,
  type BbDesktopInfo,
} from "@bb/desktop-contract";
import { mergeDesktopUpdateInfo } from "../src/desktop-update-info.js";

function info(overrides: Partial<BbDesktopInfo> = {}): BbDesktopInfo {
  return {
    lastCheckedAt: "2026-07-19T00:00:00.000Z",
    latestVersion: "0.0.32",
    pendingVersion: null,
    platform: desktopPlatformFromNode(process.platform),
    updateAvailable: true,
    updateDownloaded: false,
    version: "0.0.31",
    ...overrides,
  };
}

describe("mergeDesktopUpdateInfo", () => {
  it("does not infer native download activity from feed availability", () => {
    const merged = mergeDesktopUpdateInfo({
      autoInfo: info({
        downloadState: "idle",
        latestVersion: null,
        updateAvailable: false,
      }),
      feedInfo: info(),
    });

    expect(merged).toMatchObject({
      downloadState: "idle",
      latestVersion: "0.0.32",
      updateAvailable: true,
      updateDownloaded: false,
    });
  });

  it("preserves native updater activity when the feed also has an update", () => {
    const merged = mergeDesktopUpdateInfo({
      autoInfo: info({ downloadState: "downloading" }),
      feedInfo: info(),
    });

    expect(merged).toMatchObject({
      downloadState: "downloading",
      updateAvailable: true,
      updateDownloaded: false,
    });
  });

  it("leaves download state unknown for a legacy feed-only shell", () => {
    const merged = mergeDesktopUpdateInfo({
      autoInfo: null,
      feedInfo: info(),
    });

    expect(merged).not.toHaveProperty("downloadState");
  });
});
