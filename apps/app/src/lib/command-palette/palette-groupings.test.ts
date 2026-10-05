import { describe, expect, it } from "vitest";
import {
  buildPaletteGroupings,
  isThreadInGrouping,
  matchPaletteGroupings,
} from "./palette-groupings";

const args = {
  projects: [{ id: "project-1", name: "Web" }],
  personalProject: { id: "proj_personal", name: "My threads" },
  sections: [{ id: "sec-1", name: "Launch" }],
};

describe("buildPaletteGroupings", () => {
  it("lists projects, Personal, sections, and Pinned only when something is pinned", () => {
    expect(
      buildPaletteGroupings({ ...args, hasPinnedThreads: true }).map(
        ({ kind, id, name, icon }) => ({ kind, id, name, icon }),
      ),
    ).toEqual([
      { kind: "project", id: "project-1", name: "Web", icon: "Folder" },
      {
        kind: "project",
        id: "proj_personal",
        name: "Personal",
        icon: "Folder",
      },
      { kind: "section", id: "sec-1", name: "Launch", icon: "Layers" },
      { kind: "pinned", id: "pinned", name: "Pinned", icon: "Pin" },
    ]);
    expect(
      buildPaletteGroupings({ ...args, hasPinnedThreads: false }).map(
        (grouping) => grouping.kind,
      ),
    ).not.toContain("pinned");
  });
});

describe("matchPaletteGroupings", () => {
  it("fuzzy-matches grouping names and returns nothing for an empty query", () => {
    const groupings = buildPaletteGroupings({
      ...args,
      hasPinnedThreads: false,
    });
    expect(
      matchPaletteGroupings(groupings, "lnch").map(
        (match) => match.grouping.id,
      ),
    ).toEqual(["sec-1"]);
    expect(matchPaletteGroupings(groupings, "  ")).toEqual([]);
  });
});

describe("isThreadInGrouping", () => {
  it("matches projects by projectId, sections by sectionId, and Pinned by pinnedAt", () => {
    const [project, , section] = buildPaletteGroupings({
      ...args,
      hasPinnedThreads: true,
    });
    const thread = { projectId: "project-1", sectionId: null, pinnedAt: null };
    expect(isThreadInGrouping(thread, project)).toBe(true);
    expect(isThreadInGrouping(thread, section)).toBe(false);
    expect(isThreadInGrouping({ ...thread, sectionId: "sec-1" }, section)).toBe(
      true,
    );
    const pinned = {
      kind: "pinned",
      id: "pinned",
      name: "Pinned",
      icon: "Pin",
    } as const;
    expect(isThreadInGrouping(thread, pinned)).toBe(false);
    expect(isThreadInGrouping({ ...thread, pinnedAt: 1 }, pinned)).toBe(true);
  });
});
