import { describe, expect, it } from "vitest";
import { parseChangelog } from "@bb/domain/changelog";
import {
  CHANGELOG_ENTRIES,
  changelogUrl,
  compareChangelogVersions,
  recordWhatsNewVersion,
  RELEASE_META,
  selectWhatsNewReleases,
  type WhatsNewVersionStorage,
} from "./changelog-preview";

const SAMPLE = `# Changelog

## 0.37.0

A much faster app on your phone, and a long list of fixes.

### Mobile is much faster

Every tap used to make bb measure the whole page.

- Taps answer at once.
- The sidebar keeps its scroll position.

### Edit a message you already sent

Turn on **Edit messages** in Settings → Experiments.

## 0.36.0

- Fixed a [crash](https://example.test) on launch.
- Tidied \`bb status\` output.
`;

describe("parseChangelog", () => {
  it("keeps a release's sections out of its version list", () => {
    const entries = parseChangelog(SAMPLE);

    expect(entries.map((entry) => entry.version)).toEqual(["0.37.0", "0.36.0"]);
    expect(entries[0].sections.map((section) => section.title)).toEqual([
      "Mobile is much faster",
      "Edit a message you already sent",
    ]);
  });

  it("keeps the website's paragraphs and lists in their release sections", () => {
    const [latest] = parseChangelog(SAMPLE);

    expect(latest.lede).toEqual([
      {
        kind: "paragraph",
        text: "A much faster app on your phone, and a long list of fixes.",
      },
    ]);
    expect(latest.sections[0]).toEqual({
      title: "Mobile is much faster",
      blocks: [
        {
          kind: "paragraph",
          text: "Every tap used to make bb measure the whole page.",
        },
        {
          kind: "list",
          items: [
            "Taps answer at once.",
            "The sidebar keeps its scroll position.",
          ],
        },
      ],
    });
  });

  it("keeps release-level bullets when there are no sections", () => {
    const [, previous] = parseChangelog(SAMPLE);

    expect(previous.sections).toEqual([]);
    expect(previous.lede).toEqual([
      {
        kind: "list",
        items: [
          "Fixed a [crash](https://example.test) on launch.",
          "Tidied `bb status` output.",
        ],
      },
    ]);
  });

  it("joins wrapped paragraph lines and indented bullet continuations", () => {
    const [entry] = parseChangelog(`## 0.0.30

This release introduces multi-machine workflows.
It also adds more ways to customize bb.

- bb Connect lets you securely access bb from other devices
  and share previews from any enrolled machine.
`);

    expect(entry.lede).toEqual([
      {
        kind: "paragraph",
        text: "This release introduces multi-machine workflows. It also adds more ways to customize bb.",
      },
      {
        kind: "list",
        items: [
          "bb Connect lets you securely access bb from other devices and share previews from any enrolled machine.",
        ],
      },
    ]);
  });
});

describe("CHANGELOG_ENTRIES", () => {
  it("reads the repo's own changelog, newest release first", () => {
    expect(CHANGELOG_ENTRIES.length).toBeGreaterThan(1);
    expect(CHANGELOG_ENTRIES[0]?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(CHANGELOG_ENTRIES[0]?.sections.length).toBeGreaterThan(0);
    expect(
      compareChangelogVersions(
        CHANGELOG_ENTRIES[0]?.version ?? "",
        CHANGELOG_ENTRIES[1]?.version ?? "",
      ),
    ).toBeGreaterThan(0);
  });

  it("has presentation metadata for the newest release", () => {
    expect(RELEASE_META[CHANGELOG_ENTRIES[0]?.version ?? ""]).toBeDefined();
  });
});

describe("compareChangelogVersions", () => {
  it("compares numerically rather than as text", () => {
    expect(compareChangelogVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareChangelogVersions("0.43.3", "0.43.10")).toBeLessThan(0);
    expect(compareChangelogVersions("0.45", "0.45.0")).toBe(0);
  });

  it("ignores prerelease suffixes on installed builds", () => {
    expect(compareChangelogVersions("0.45.0-dev.3", "0.45.0")).toBe(0);
    expect(compareChangelogVersions("v0.46.0", "0.45.0")).toBeGreaterThan(0);
  });
});

describe("changelogUrl", () => {
  it("links to the release's anchor on the website", () => {
    expect(changelogUrl("0.45.0")).toBe("https://getbb.app/changelog#0-45-0");
  });
});

const ENTRIES = parseChangelog(`## 0.5.0

Five.

## 0.4.0

Four.

## 0.3.1

Three point one.

## 0.3.0

Three.
`);

describe("selectWhatsNewReleases", () => {
  it("shows the installed release rather than a newer published one", () => {
    const releases = selectWhatsNewReleases({
      entries: ENTRIES,
      installedVersion: "0.4.0",
      previousVersion: null,
    });
    expect(releases?.current.version).toBe("0.4.0");
    expect(releases?.skipped).toEqual([]);
    expect(releases?.updatedFrom).toBeNull();
  });

  it("falls back to the nearest older release for an unlisted build", () => {
    expect(
      selectWhatsNewReleases({
        entries: ENTRIES,
        installedVersion: "0.4.2-dev.1",
        previousVersion: null,
      })?.current.version,
    ).toBe("0.4.0");
  });

  it("uses the newest release when the installed version is unknown or older than every entry", () => {
    expect(
      selectWhatsNewReleases({
        entries: ENTRIES,
        installedVersion: null,
        previousVersion: null,
      })?.current.version,
    ).toBe("0.5.0");
    expect(
      selectWhatsNewReleases({
        entries: ENTRIES,
        installedVersion: "0.1.0",
        previousVersion: null,
      })?.current.version,
    ).toBe("0.5.0");
  });

  it("lists releases skipped since the previous version, newest first", () => {
    const releases = selectWhatsNewReleases({
      entries: ENTRIES,
      installedVersion: "0.5.0",
      previousVersion: "0.3.0",
    });
    expect(releases?.current.version).toBe("0.5.0");
    expect(releases?.skipped.map((entry) => entry.version)).toEqual([
      "0.4.0",
      "0.3.1",
    ]);
    expect(releases?.updatedFrom).toBe("0.3.0");
  });

  it("ignores a previous version that is not older than the installed one", () => {
    const releases = selectWhatsNewReleases({
      entries: ENTRIES,
      installedVersion: "0.4.0",
      previousVersion: "0.5.0",
    });
    expect(releases?.skipped).toEqual([]);
    expect(releases?.updatedFrom).toBeNull();
  });

  it("returns nothing for an empty changelog", () => {
    expect(
      selectWhatsNewReleases({
        entries: [],
        installedVersion: "0.4.0",
        previousVersion: null,
      }),
    ).toBeNull();
  });
});

function memoryStorage(): WhatsNewVersionStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key, initialValue) => values.get(key) ?? initialValue,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("recordWhatsNewVersion", () => {
  it("has no previous version on the first visit", () => {
    expect(recordWhatsNewVersion(memoryStorage(), "0.4.0")).toBeNull();
  });

  it("remembers the version seen before an update across later visits", () => {
    const storage = memoryStorage();
    recordWhatsNewVersion(storage, "0.3.0");
    expect(recordWhatsNewVersion(storage, "0.5.0")).toBe("0.3.0");
    expect(recordWhatsNewVersion(storage, "0.5.0")).toBe("0.3.0");
  });

  it("moves the previous version forward on the next update", () => {
    const storage = memoryStorage();
    recordWhatsNewVersion(storage, "0.3.0");
    recordWhatsNewVersion(storage, "0.4.0");
    expect(recordWhatsNewVersion(storage, "0.5.0")).toBe("0.4.0");
  });

  it("does not report an update after a downgrade", () => {
    const storage = memoryStorage();
    recordWhatsNewVersion(storage, "0.5.0");
    expect(recordWhatsNewVersion(storage, "0.4.0")).toBeNull();
    expect(recordWhatsNewVersion(storage, "0.5.0")).toBeNull();
  });
});
