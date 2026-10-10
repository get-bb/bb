import { describe, expect, it } from "vitest";
import { compareChangelogVersions, parseChangelog } from "../src/changelog.js";

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
