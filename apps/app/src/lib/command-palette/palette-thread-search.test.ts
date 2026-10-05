import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type { ThreadSearchResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { buildPaletteThreadSearchRows } from "./palette-thread-search";

const NOW = 1_000_000;

function makeThread(
  id: string,
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id,
    projectId: "project-1",
    environmentId: null,
    providerId: "codex",
    title: `Title ${id}`,
    titleFallback: `Fallback ${id}`,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: NOW,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentPath: null,
    environmentProviderId: null,
    environmentIsWorktree: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: { displayStatus: "idle" },
    queuedWork: "none",
    ...overrides,
  };
}

function build(
  overrides: Partial<Parameters<typeof buildPaletteThreadSearchRows>[0]> = {},
) {
  return buildPaletteThreadSearchRows({
    lifecycles: ["active"],
    now: NOW,
    projectNamesById: new Map([["project-1", "Palette project"]]),
    query: "match",
    recentThreads: [],
    searchResponse: {
      active: { results: [], total: 0 },
      archived: { results: [], total: 0 },
    },
    searchResultsAreCurrent: true,
    ...overrides,
  });
}

describe("buildPaletteThreadSearchRows", () => {
  it("orders archived recents by archive time instead of last update", () => {
    const result = build({
      query: "",
      lifecycles: ["archived"],
      recentThreads: [
        makeThread("updated-latest", { archivedAt: 1, updatedAt: NOW }),
        makeThread("archived-latest", { archivedAt: 2, updatedAt: 1 }),
      ],
    });
    expect(result.rows.map((row) => row.threadId)).toEqual([
      "archived-latest",
      "updated-latest",
    ]);
  });

  it("keeps saved-message threads in Active recents", () => {
    const saved = makeThread("saved", { status: "pending", updatedAt: NOW });
    const archived = makeThread("archived", { archivedAt: 1, updatedAt: 2 });
    const active = Array.from({ length: 25 }, (_, index) => makeThread(`active-${index}`, { updatedAt: 1 }));
    const recentThreads = [...active, saved, archived];
    const result = build({ query: "", recentThreads, lifecycles: ["active", "archived"] });
    expect(result.rows).toHaveLength(21);
    expect(result.rows[0]).toMatchObject({ threadId: "saved", lifecycle: "active" });
    expect(result.rows[20]).toMatchObject({ threadId: "archived", lifecycle: "archived" });
  });

  it("keeps saved-message snippets in the owning thread result without inventing an event anchor", () => {
    const result = build({
      lifecycles: ["active"],
      searchResponse: {
        active: {
          total: 1,
          results: [{
            thread: makeThread("saved", { status: "pending" }),
            matches: [{ sourceKind: "user_message", text: "matching saved message", highlightRanges: [{ start: 0, end: 5 }], sourceSeq: null }],
          }],
        },
        archived: { total: 0, results: [] },
      },
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ threadId: "saved", lifecycle: "active", primaryText: "matching saved message", messageSeq: null });
  });

  it("preserves active and archived server matches in their ranked order", () => {
    const active = makeThread("active");
    const archived = makeThread("archived", { archivedAt: NOW - 1 });
    const searchResponse: ThreadSearchResponse = {
      active: {
        total: 1,
        results: [{ thread: active, matches: [] }],
      },
      archived: {
        total: 1,
        results: [{ thread: archived, matches: [] }],
      },
    };

    const result = build({
      lifecycles: ["active", "archived"],
      searchResponse,
    });

    expect(result.rows.map((row) => row.lifecycle)).toEqual([
      "active",
      "archived",
    ]);
    expect(result.rows.map((row) => row.thread)).toEqual([active, archived]);
    expect(result.rows.map((row) => row.projectName)).toEqual([
      "Palette project",
      "Palette project",
    ]);
    expect(result.rows.map((row) => row.threadId)).toEqual([
      "active",
      "archived",
    ]);
  });

  it("uses the matched message as primary while retaining title, project, and time metadata", () => {
    const thread = makeThread("message", { title: "Original title" });
    const result = build({
      searchResponse: {
        active: {
          total: 1,
          results: [
            {
              thread,
              matches: [
                {
                  sourceKind: "user_message",
                  text: "the matching message",
                  highlightRanges: [{ start: 4, end: 12 }],
                  sourceSeq: 42,
                },
              ],
            },
          ],
        },
        archived: { results: [], total: 0 },
      },
    });

    expect(result.rows[0]).toMatchObject({
      primaryText: "the matching message",
      secondaryTitle: "Original title",
      projectName: "Palette project",
      relativeTime: "just now",
      messageSeq: 42,
      highlightRanges: [{ start: 4, end: 12 }],
    });
  });

  it("uses active recents before typing and only title matches once typing starts", () => {
    const active = makeThread("recent-active");
    const archived = makeThread("recent-archived", { archivedAt: NOW - 1 });
    const recents = build({
      query: "",
      searchResponse: {
        active: { total: 0, results: [] },
        archived: { total: 1, results: [{ thread: archived, matches: [] }] },
      },
      recentThreads: [active],
    });
    expect(recents).toMatchObject({
      isRecent: true,
      rows: [{ id: "active:recent-active" }],
    });
    expect(build({ query: "z", recentThreads: [active] })).toMatchObject({
      isRecent: false,
      rows: [],
    });
  });
  it("does not show stale server matches while a new query is debouncing", () => {
    const thread = makeThread("stale");
    expect(
      build({
        searchResultsAreCurrent: false,
        searchResponse: {
          active: { total: 1, results: [{ thread, matches: [] }] },
          archived: { total: 1, results: [{ thread, matches: [] }] },
        },
      }).rows,
    ).toEqual([]);
  });
  it("omits project metadata for personal or unresolved projects", () => {
    const result = build({
      query: "",
      recentThreads: [
        makeThread("personal", { projectId: PERSONAL_PROJECT_ID }),
        makeThread("unresolved", { projectId: "unknown-project" }),
      ],
    });
    expect(result.rows.map((row) => row.projectName)).toEqual([null, null]);
  });
  it("orders active recents by update time across projects without prioritizing pinned threads", () => {
    const older = makeThread("older", { updatedAt: NOW - 100, pinnedAt: NOW });
    const newest = makeThread("newest", {
      projectId: "project-2",
      updatedAt: NOW,
    });
    const tied = makeThread("tied", { updatedAt: NOW });
    expect(
      build({ query: "", recentThreads: [older, newest, tied] }).rows.map(
        (row) => row.id,
      ),
    ).toEqual(["active:newest", "active:tied", "active:older"]);
  });

  it("chooses the newest threads before applying the recent limit", () => {
    const recentThreads = Array.from({ length: 21 }, (_, index) =>
      makeThread(String(index), { updatedAt: NOW + index }),
    );
    const rows = build({ query: "", recentThreads }).rows;
    expect(rows).toHaveLength(20);
    expect(rows[0]?.threadId).toBe("20");
    expect(rows.at(-1)?.threadId).toBe("1");
    expect(recentThreads[0]?.id).toBe("0");
  });

  describe("loaded title matches", () => {
    const titled = (id: string, title: string, updatedAt = NOW) =>
      makeThread(id, { title, updatedAt });

    it("matches loaded active titles from one character with highlight ranges", () => {
      const result = build({
        query: " q",
        searchResponse: undefined,
        recentThreads: [
          titled("quick", "Quick switcher"),
          titled("other", "Release notes"),
        ],
      });
      expect(result.isRecent).toBe(false);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        threadId: "quick",
        primaryText: "Quick switcher",
        highlightRanges: [{ start: 0, end: 1 }],
        messageSeq: null,
      });
    });

    it("lists a project's threads after title matches when a word in its name starts with the query", () => {
      const result = build({
        query: "pal",
        projectNamesById: new Map([
          ["project-1", "Palette project"],
          ["project-2", "Other"],
        ]),
        recentThreads: [
          titled("in-project", "Unrelated"),
          titled("title-hit", "Pale ale"),
          makeThread("elsewhere", { projectId: "project-2", title: "Nothing" }),
        ],
      });
      expect(result.rows.map((row) => row.threadId)).toEqual([
        "title-hit",
        "in-project",
      ]);
      expect(result.rows[1]?.highlightRanges).toEqual([]);
      expect(result.rows[0]?.projectHighlightRanges).toEqual([]);
      expect(result.rows[1]?.projectHighlightRanges).toEqual([
        { start: 0, end: 3 },
      ]);
    });

    it("highlights the project-name word that starts with the query", () => {
      const result = build({
        query: "proj",
        recentThreads: [titled("in-project", "Unrelated")],
      });
      expect(result.rows[0]?.projectHighlightRanges).toEqual([
        { start: 8, end: 12 },
      ]);
    });

    it("does not match a project on letters inside a word", () => {
      expect(
        build({
          query: "lette",
          recentThreads: [titled("a", "Unrelated")],
        }).rows,
      ).toEqual([]);
    });

    it("ranks by match quality, then update time", () => {
      const result = build({
        query: "fix",
        recentThreads: [
          titled("fuzzy", "Find it x", NOW + 100),
          titled("older", "Fix older", NOW),
          titled("newer", "Fix newer", NOW + 10),
        ],
      });
      expect(result.rows.map((row) => row.threadId)).toEqual([
        "newer",
        "older",
        "fuzzy",
      ]);
    });

    it("shows no loaded matches when only Archived is selected", () => {
      expect(
        build({
          query: "fix",
          lifecycles: ["archived"],
          recentThreads: [titled("a", "Fix it")],
        }).rows,
      ).toEqual([]);
    });

    it("inserts server-only rows after three loaded rows and merges threads found both ways", () => {
      const local = Array.from({ length: 6 }, (_, index) =>
        titled(`local-${index}`, `Fix ${index}`, NOW - index),
      );
      const messageOnly = titled("message-only", "Weekly sync");
      const result = build({
        query: "fix",
        recentThreads: local,
        searchResponse: {
          active: {
            total: 2,
            results: [
              {
                thread: messageOnly,
                matches: [
                  {
                    sourceKind: "assistant_message",
                    text: "we should fix it",
                    highlightRanges: [{ start: 10, end: 13 }],
                    sourceSeq: 7,
                  },
                ],
              },
              {
                thread: titled("local-4", "Fix 4", NOW - 4),
                matches: [
                  {
                    sourceKind: "user_message",
                    text: "please fix 4",
                    highlightRanges: [{ start: 7, end: 10 }],
                    sourceSeq: 12,
                  },
                ],
              },
            ],
          },
          archived: { total: 0, results: [] },
        },
      });
      expect(result.rows.map((row) => row.threadId)).toEqual([
        "local-0",
        "local-1",
        "local-2",
        "message-only",
        "local-3",
        "local-4",
        "local-5",
      ]);
      expect(result.rows[5]).toMatchObject({
        id: "active:local-4",
        primaryText: "please fix 4",
        secondaryTitle: "Fix 4",
        messageSeq: 12,
        highlightRanges: [{ start: 7, end: 10 }],
      });
    });

    it("keeps loaded matches while server results are stale", () => {
      const result = build({
        query: "fix",
        searchResultsAreCurrent: false,
        recentThreads: [titled("a", "Fix it")],
        searchResponse: {
          active: {
            total: 1,
            results: [{ thread: titled("stale", "Stale"), matches: [] }],
          },
          archived: { total: 0, results: [] },
        },
      });
      expect(result.rows.map((row) => row.threadId)).toEqual(["a"]);
    });
  });
});
