import { describe, expect, it } from "vitest";

import { headingId, parseGuide } from "./parse-guide";

const SAMPLE = `---
title: bb vs Superset (2026)
description: How bb and Superset differ.
---

## At A Glance

| | bb | Superset |
| --- | --- | --- |
`;

describe("parseGuide", () => {
  it("reads front matter and builds the page path from its section", () => {
    const guide = parseGuide("compare", "bb-vs-superset", SAMPLE);
    expect(guide.path).toBe("/compare/bb-vs-superset");
    expect(guide.title).toBe("bb vs Superset (2026)");
    expect(guide.description).toBe("How bb and Superset differ.");
    expect(guide.body).toContain("| | bb | Superset |");
  });

  it("rejects an unknown section", () => {
    expect(() => parseGuide("blog", "x", SAMPLE)).toThrow(/unknown section/);
  });

  it("rejects a page without a description", () => {
    expect(() =>
      parseGuide("guides", "x", "---\ntitle: Only a title\n---\n\nBody"),
    ).toThrow(/missing title or description/);
  });
});

describe("headingId", () => {
  it("matches the anchors pages link to", () => {
    expect(headingId("Keep The Machine Awake")).toBe("keep-the-machine-awake");
    expect(headingId("What You're Signing Up For")).toBe(
      "what-youre-signing-up-for",
    );
    expect(headingId("Tailscale, SSH, And tmux")).toBe(
      "tailscale-ssh-and-tmux",
    );
  });
});
