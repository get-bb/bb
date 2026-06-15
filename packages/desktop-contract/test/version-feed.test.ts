import { describe, expect, it } from "vitest";
import {
  bbDesktopInfoSchema,
  bbDesktopThemeSchema,
  bbDesktopVersionFeedSchema,
} from "../src/index.js";

const checkedAt = "2026-05-21T00:00:00.000Z";

describe("desktop info schema", () => {
  it("accepts the desktop update info payload", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        lastCheckedAt: checkedAt,
        latestVersion: "0.0.2",
        pendingVersion: null,
        platform: "macos",
        updateAvailable: true,
        updateDownloaded: false,
        version: "0.0.1",
      }).success,
    ).toBe(true);
  });

  it("accepts the desktop theme values", () => {
    expect(bbDesktopThemeSchema.safeParse("dark").success).toBe(true);
    expect(bbDesktopThemeSchema.safeParse("system").success).toBe(false);
  });
});

describe("desktop version feed schema", () => {
  it("accepts a valid desktop-version.json payload", () => {
    expect(
      bbDesktopVersionFeedSchema.safeParse({
        channel: "latest",
        files: [
          {
            sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
            size: 123456789,
            url: "bb-0.0.2-universal.zip",
          },
        ],
        minimumSystemVersion: null,
        path: "bb-0.0.2-universal.zip",
        platform: "macos",
        releaseDate: checkedAt,
        releaseName: "bb desktop 0.0.2",
        releaseNotes: null,
        schemaVersion: 1,
        sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
        stagingPercentage: null,
        version: "0.0.2",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed version feed payloads", () => {
    expect(
      bbDesktopVersionFeedSchema.safeParse({
        channel: "latest",
        files: [],
        minimumSystemVersion: null,
        path: "bb-0.0.2-universal.zip",
        platform: "macos",
        releaseDate: checkedAt,
        releaseName: "bb desktop 0.0.2",
        releaseNotes: null,
        schemaVersion: 1,
        sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
        stagingPercentage: null,
        version: "0.0.2",
      }).success,
    ).toBe(false);
  });
});
