import { describe, expect, it } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import type {
  SystemAppUpdateStatus,
  SystemVersionResponse,
} from "@bb/server-contract";
import { parseChangelog } from "../../../../../changelog-parser";
import { CHANGELOG_ENTRIES } from "./changelog-preview";
import {
  findReleaseEntry,
  resolveReleaseUpdateVersion,
} from "./release-notes-model";

function desktopInfo(overrides: Partial<BbDesktopInfo>): BbDesktopInfo {
  return {
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: "0.46.1",
    ...overrides,
  };
}

function appUpdate(
  available: SystemAppUpdateStatus["available"],
  current = "0.46.1",
): SystemAppUpdateStatus {
  return {
    activity: { phase: "idle" },
    available,
    blocked: null,
    current: { commit: null, version: current },
    lastResult: null,
    runningThreadCount: 0,
    support: { kind: "supported", mode: "npm" },
  };
}

function available(
  version: string,
  channel: "latest" | "nightly" | "main" = "latest",
): NonNullable<SystemAppUpdateStatus["available"]> {
  return { channel, commit: null, commitCount: null, subjects: [], version };
}

function systemVersion(
  overrides: Partial<SystemVersionResponse>,
): SystemVersionResponse {
  return {
    currentCommit: null,
    installKind: "npm",
    currentVersion: "0.46.1",
    latestVersion: "0.46.1",
    source: "npm",
    updateAvailable: false,
    isDevelopment: false,
    upgradeCommand: "npx bb-app@latest",
    ...overrides,
  };
}

const none = {
  isDesktop: false,
  desktopInfo: null,
  appUpdate: undefined,
  systemVersion: undefined,
};

describe("resolveReleaseUpdateVersion", () => {
  it("uses the desktop's downloaded release first, then its latest", () => {
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        isDesktop: true,
        desktopInfo: desktopInfo({
          pendingVersion: "0.47.0",
          latestVersion: "0.48.0",
        }),
        appUpdate: appUpdate(available("0.49.0")),
      }),
    ).toBe("0.47.0");
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        isDesktop: true,
        desktopInfo: desktopInfo({ latestVersion: "0.48.0" }),
      }),
    ).toBe("0.48.0");
  });

  it("waits for desktop info on desktop", () => {
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        isDesktop: true,
        appUpdate: appUpdate(available("0.47.0")),
      }),
    ).toBeNull();
  });

  it("uses the server's available release for npm and source installs", () => {
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        appUpdate: appUpdate(available("0.47.0")),
        systemVersion: systemVersion({
          updateAvailable: true,
          latestVersion: "0.48.0",
        }),
      }),
    ).toBe("0.47.0");
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        appUpdate: appUpdate(available("0.47.0", "main")),
      }),
    ).toBe("0.47.0");
  });

  it("falls back to npm's latest release when the update status has none", () => {
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        appUpdate: appUpdate(null),
        systemVersion: systemVersion({
          updateAvailable: true,
          latestVersion: "0.47.0",
        }),
      }),
    ).toBe("0.47.0");
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        systemVersion: systemVersion({ latestVersion: "0.47.0" }),
      }),
    ).toBeNull();
  });

  it("skips nightly and other non-release versions", () => {
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        appUpdate: appUpdate(available("0.48.0-nightly.20261024", "nightly")),
      }),
    ).toBeNull();
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        appUpdate: appUpdate(available("0.48.0", "nightly")),
      }),
    ).toBeNull();
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        isDesktop: true,
        desktopInfo: desktopInfo({ latestVersion: "0.48.0-nightly.3" }),
      }),
    ).toBeNull();
  });

  it("never targets the installed version or an older one", () => {
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        appUpdate: appUpdate(available("0.46.1"), "0.46.1"),
      }),
    ).toBeNull();
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        appUpdate: appUpdate(available("0.46.0"), "0.46.1"),
      }),
    ).toBeNull();
    expect(
      resolveReleaseUpdateVersion({
        ...none,
        isDesktop: true,
        desktopInfo: desktopInfo({ latestVersion: "0.46.1" }),
      }),
    ).toBeNull();
  });
});

const FETCHED = parseChangelog(`## 0.48.0

Fetched lede.
`);

describe("findReleaseEntry", () => {
  it("prefers the fetched changelog and falls back to the bundled one", () => {
    const bundled = parseChangelog(`## 0.48.0

Bundled lede.

## 0.47.0

Older lede.
`);
    expect(findReleaseEntry("0.48.0", FETCHED, bundled)?.lede).toEqual([
      { kind: "paragraph", text: "Fetched lede." },
    ]);
    expect(findReleaseEntry("0.47.0", FETCHED, bundled)?.version).toBe(
      "0.47.0",
    );
    expect(findReleaseEntry("0.48.0", undefined, bundled)?.lede).toEqual([
      { kind: "paragraph", text: "Bundled lede." },
    ]);
  });

  it("is null when neither changelog has the release", () => {
    expect(findReleaseEntry("0.49.0", FETCHED, CHANGELOG_ENTRIES)).toBeNull();
  });

  it("covers a patch release with the newest earlier entry in its minor line", () => {
    const entries = parseChangelog(`## 0.48.0

Minor lede.

## 0.43.3

Patch lede.

## 0.43.0

Older minor lede.
`);
    expect(findReleaseEntry("0.48.1", undefined, entries)?.version).toBe(
      "0.48.0",
    );
    expect(findReleaseEntry("0.43.4", undefined, entries)?.version).toBe(
      "0.43.3",
    );
    expect(findReleaseEntry("0.43.3", undefined, entries)?.version).toBe(
      "0.43.3",
    );
    expect(findReleaseEntry("0.43.2", undefined, entries)?.version).toBe(
      "0.43.0",
    );
    expect(findReleaseEntry("0.49.1", undefined, entries)).toBeNull();
  });

  it("covers a nightly with the newest release below its next patch", () => {
    const entries = parseChangelog(`## 0.48.0

Newest lede.

## 0.47.0

Older lede.
`);
    expect(
      findReleaseEntry("0.48.2-nightly.40981326765.1", undefined, entries)
        ?.version,
    ).toBe("0.48.0");
    expect(
      findReleaseEntry("0.49.0-nightly.12.1", undefined, entries)?.version,
    ).toBe("0.48.0");
    expect(
      findReleaseEntry("0.48.0-nightly.3.1", undefined, entries)?.version,
    ).toBe("0.47.0");
    expect(findReleaseEntry("0.0.0-dev", undefined, entries)).toBeNull();
  });
});
