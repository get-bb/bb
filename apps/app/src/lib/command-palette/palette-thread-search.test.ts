import type { ThreadListEntry } from "@bb/domain";
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
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    queuedWork: "none",
    ...overrides,
  };
}

function build(
  overrides: Partial<Parameters<typeof buildPaletteThreadSearchRows>[0]> = {},
) {
  return buildPaletteThreadSearchRows({
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
      searchResponse,
    });

    expect(result.rows.map((row) => row.lifecycle)).toEqual([
      "active",
      "archived",
    ]);
    expect(result.rows.map((row) => row.thread)).toEqual([active, archived]);
    expect(result.rows.map((row) => row.metadataText)).toEqual([
      "Palette project · just now",
      "Palette project · just now",
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
      metadataText: "Original title · Palette project · just now",
      messageSeq: 42,
      highlightRanges: [{ start: 4, end: 12 }],
    });
  });

  it("uses active recents before typing and does not reuse them for a one-character query", () => {
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
    expect(build({ query: "m", recentThreads: [active] })).toMatchObject({
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
});
