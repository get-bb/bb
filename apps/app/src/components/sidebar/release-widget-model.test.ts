import { describe, expect, it } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import type {
  SystemAppUpdateStatus,
  SystemVersionResponse,
} from "@bb/server-contract";
import { parseChangelog } from "../../../../../changelog-parser";
import { CHANGELOG_ENTRIES } from "@/components/settings/changelog-preview";
import {
  releaseHighlights,
  releaseImage,
  resolveReleaseWidgetContent,
  resolveReleaseWidgetTargetVersion,
} from "./release-widget-model";

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

describe("resolveReleaseWidgetTargetVersion", () => {
  it("uses the desktop's downloaded release first, then its latest", () => {
    expect(
      resolveReleaseWidgetTargetVersion({
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
      resolveReleaseWidgetTargetVersion({
        ...none,
        isDesktop: true,
        desktopInfo: desktopInfo({ latestVersion: "0.48.0" }),
      }),
    ).toBe("0.48.0");
  });

  it("waits for desktop info on desktop", () => {
    expect(
      resolveReleaseWidgetTargetVersion({
        ...none,
        isDesktop: true,
        appUpdate: appUpdate(available("0.47.0")),
      }),
    ).toBeNull();
  });

  it("uses the server's available release for npm and source installs", () => {
    expect(
      resolveReleaseWidgetTargetVersion({
        ...none,
        appUpdate: appUpdate(available("0.47.0")),
        systemVersion: systemVersion({
          updateAvailable: true,
          latestVersion: "0.48.0",
        }),
      }),
    ).toBe("0.47.0");
    expect(
      resolveReleaseWidgetTargetVersion({
        ...none,
        appUpdate: appUpdate(available("0.47.0", "main")),
      }),
    ).toBe("0.47.0");
  });

  it("falls back to npm's latest release when the update status has none", () => {
    expect(
      resolveReleaseWidgetTargetVersion({
        ...none,
        appUpdate: appUpdate(null),
        systemVersion: systemVersion({
          updateAvailable: true,
          latestVersion: "0.47.0",
        }),
      }),
    ).toBe("0.47.0");
    expect(
      resolveReleaseWidgetTargetVersion({
        ...none,
        systemVersion: systemVersion({ latestVersion: "0.47.0" }),
      }),
    ).toBeNull();
  });

  it("skips nightly and other non-release versions", () => {
    expect(
      resolveReleaseWidgetTargetVersion({
        ...none,
        appUpdate: appUpdate(available("0.48.0-nightly.20261024", "nightly")),
      }),
    ).toBeNull();
    expect(
      resolveReleaseWidgetTargetVersion({
        ...none,
        appUpdate: appUpdate(available("0.48.0", "nightly")),
      }),
    ).toBeNull();
    expect(
      resolveReleaseWidgetTargetVersion({
        ...none,
        isDesktop: true,
        desktopInfo: desktopInfo({ latestVersion: "0.48.0-nightly.3" }),
      }),
    ).toBeNull();
  });

  it("never targets the installed version or an older one", () => {
    expect(
      resolveReleaseWidgetTargetVersion({
        ...none,
        appUpdate: appUpdate(available("0.46.1"), "0.46.1"),
      }),
    ).toBeNull();
    expect(
      resolveReleaseWidgetTargetVersion({
        ...none,
        appUpdate: appUpdate(available("0.46.0"), "0.46.1"),
      }),
    ).toBeNull();
    expect(
      resolveReleaseWidgetTargetVersion({
        ...none,
        isDesktop: true,
        desktopInfo: desktopInfo({ latestVersion: "0.46.1" }),
      }),
    ).toBeNull();
  });
});

const SAMPLE = parseChangelog(`# Changelog

## 0.48.0

A lede.

### Highlights

- **First highlight:** with a description.
- **Second.** with a period.
- **Third** without punctuation.
- A plain line without a bold title.
- **Fourth:** dropped, only three show.

### Fixes

- **Not a highlight:** ignored.

## 0.47.1

### Fixes

- Fixed something.
`);

describe("releaseHighlights", () => {
  it("returns up to three bold titles without their trailing punctuation", () => {
    expect(releaseHighlights(SAMPLE[0]!)).toEqual([
      "First highlight",
      "Second",
      "Third",
    ]);
  });

  it("returns nothing when a release has no Highlights section", () => {
    expect(releaseHighlights(SAMPLE[1]!)).toEqual([]);
  });

  it("reads the repo's own newest release", () => {
    const [latest] = CHANGELOG_ENTRIES;
    expect(latest).toBeDefined();
    const highlights = releaseHighlights(latest!);
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights.length).toBeLessThanOrEqual(3);
    for (const highlight of highlights) {
      expect(highlight).not.toMatch(/[*:]/);
    }
  });
});

function entryWith(body: string) {
  const [entry] = parseChangelog(`## 0.48.0\n\n${body}`);
  if (entry === undefined) {
    throw new Error("missing entry");
  }
  return entry;
}

describe("releaseImage", () => {
  it("returns the first image of the release from getbb.app/changelog", () => {
    expect(
      releaseImage(
        entryWith(`A lede.

### Highlights

- **One:** first.

![The navigation rail](https://getbb.app/changelog/0.48.0/rail.jpg)

![Second image](https://getbb.app/changelog/0.48.0/second.jpg)
`),
      ),
    ).toEqual({
      src: "https://getbb.app/changelog/0.48.0/rail.jpg",
      alt: "The navigation rail",
    });
  });

  it("reads the repo's own 0.46.0 hero image", () => {
    const entry = CHANGELOG_ENTRIES.find(
      (candidate) => candidate.version === "0.46.0",
    );
    expect(releaseImage(entry!)).toEqual({
      src: "https://getbb.app/changelog/0.46.0/navigation-rail.jpg",
      alt: "The navigation rail beside the new-thread composer",
    });
  });

  it("gives an image without alt text a descriptive one", () => {
    expect(
      releaseImage(entryWith("![](https://getbb.app/changelog/0.48.0/a.png)"))
        ?.alt,
    ).toBe("What's new in bb 0.48.0");
  });

  it.each([
    "http://getbb.app/changelog/0.48.0/a.png",
    "https://evil.example/changelog/0.48.0/a.png",
    "https://getbb.app.evil.example/changelog/a.png",
    "https://user@getbb.app/changelog/0.48.0/a.png",
    "https://getbb.app/blog/a.png",
    "https://getbb.app/changelog/../blog/a.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "/changelog/0.48.0/a.png",
  ])("rejects %s", (url) => {
    expect(releaseImage(entryWith(`![Alt](${url})`))).toBeNull();
  });

  it("is null when the release has no image", () => {
    expect(releaseImage(SAMPLE[0]!)).toBeNull();
    expect(
      releaseImage(
        entryWith(
          "Text with ![inline](https://getbb.app/changelog/a.png) image.",
        ),
      ),
    ).toBeNull();
  });
});

describe("resolveReleaseWidgetContent", () => {
  it("prefers the fetched changelog and falls back to the bundled one", () => {
    const bundled = parseChangelog(`## 0.48.0

Bundled lede.

### Highlights

- **Bundled:** older copy.

![Bundled](https://getbb.app/changelog/0.48.0/bundled.jpg)
`);
    expect(resolveReleaseWidgetContent("0.48.0", SAMPLE, bundled)).toEqual({
      highlights: ["First highlight", "Second", "Third"],
      image: null,
    });
    expect(resolveReleaseWidgetContent("0.48.0", undefined, bundled)).toEqual({
      highlights: ["Bundled"],
      image: {
        src: "https://getbb.app/changelog/0.48.0/bundled.jpg",
        alt: "Bundled",
      },
    });
  });

  it("is null when the release is missing or has no highlights", () => {
    expect(resolveReleaseWidgetContent("0.49.0", SAMPLE, [])).toBeNull();
    expect(resolveReleaseWidgetContent("0.47.1", SAMPLE, [])).toBeNull();
  });
});
