import { describe, expect, it } from "vitest";

import { parseChangelog } from "./changelog";

const SAMPLE = `# Changelog

## 0.0.30

This release introduces multi-machine workflows.
It also adds more ways to customize bb.

### Work across machines

- Multi-machine support lets you add computers to bb.
- bb Connect lets you securely access bb from other devices
  and share previews from any enrolled machine.

### Fixes and polish

- Fixed microphone input in signed macOS desktop builds.

## 0.0.29

This release expands agent and model support.

### Experiments

New experiment to let you connect to bb from other computers.
`;

describe("parseChangelog", () => {
  it("splits releases and keeps section structure", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases.map((release) => release.version)).toEqual([
      "0.0.30",
      "0.0.29",
    ]);

    const [latest, prior] = releases;
    expect(latest.lede).toEqual([
      {
        kind: "paragraph",
        text: "This release introduces multi-machine workflows. It also adds more ways to customize bb.",
      },
    ]);
    expect(latest.sections.map((section) => section.title)).toEqual([
      "Work across machines",
      "Fixes and polish",
    ]);
    expect(prior.sections).toHaveLength(1);
  });

  it("joins indented bullet continuation lines", () => {
    const [latest] = parseChangelog(SAMPLE);
    const [firstSection] = latest.sections;
    expect(firstSection.blocks).toEqual([
      {
        kind: "list",
        items: [
          "Multi-machine support lets you add computers to bb.",
          "bb Connect lets you securely access bb from other devices and share previews from any enrolled machine.",
        ],
      },
    ]);
  });

  it("keeps a bare paragraph inside a section (0.0.29 Experiments shape)", () => {
    const [, prior] = parseChangelog(SAMPLE);
    expect(prior.sections[0].blocks).toEqual([
      {
        kind: "paragraph",
        text: "New experiment to let you connect to bb from other computers.",
      },
    ]);
  });
});
