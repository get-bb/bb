import { describe, expect, it } from "vitest";
import {
  bbDesktopCliCommandInstallResultSchema,
  bbDesktopInfoSchema,
} from "../src/info.js";

const baseInfo = {
  lastCheckedAt: null,
  latestVersion: "0.0.32",
  pendingVersion: null,
  platform: "macos",
  updateAvailable: true,
  updateDownloaded: false,
  version: "0.0.31",
} as const;

describe("bbDesktopInfoSchema", () => {
  it("accepts both explicit download state and legacy shell payloads", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        downloadState: "downloading",
      }).success,
    ).toBe(true);
    expect(bbDesktopInfoSchema.safeParse(baseInfo).success).toBe(true);
  });

  it("rejects an unknown download state", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        downloadState: "available",
      }).success,
    ).toBe(false);
  });

  it("accepts linux", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        platform: "linux",
      }).success,
    ).toBe(true);
  });

  it("rejects win32", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        platform: "win32",
      }).success,
    ).toBe(false);
  });
});

const baseCliCommandStatus = {
  binDir: "/home/user/.bb/bin",
  commandName: "bb",
  matches: [] as string[],
  onPath: false,
  ownEntryWins: false,
  wrapperInstalled: false,
};

describe("bbDesktopCliCommandInstallResultSchema", () => {
  it("accepts every outcome, with detail present where it carries meaning", () => {
    for (const outcome of ["written", "unchanged", "foreign-file"] as const) {
      expect(
        bbDesktopCliCommandInstallResultSchema.safeParse({
          detail: "/home/user/.bb/bin/bb",
          outcome,
          status: baseCliCommandStatus,
        }).success,
      ).toBe(true);
    }
    expect(
      bbDesktopCliCommandInstallResultSchema.safeParse({
        detail: "EACCES: permission denied",
        outcome: "failed",
        status: baseCliCommandStatus,
      }).success,
    ).toBe(true);
  });

  it("accepts 'unsupported' with no detail, for a build with no install target", () => {
    expect(
      bbDesktopCliCommandInstallResultSchema.safeParse({
        outcome: "unsupported",
        status: baseCliCommandStatus,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown outcome", () => {
    expect(
      bbDesktopCliCommandInstallResultSchema.safeParse({
        outcome: "success",
        status: baseCliCommandStatus,
      }).success,
    ).toBe(false);
  });

  it("rejects a missing status", () => {
    expect(
      bbDesktopCliCommandInstallResultSchema.safeParse({
        outcome: "written",
      }).success,
    ).toBe(false);
  });
});
