import type { ThreadListEntry } from "@bb/domain";
import type { ThreadSearchResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { buildPaletteGoToResults, type PaletteGoToItem } from "./palette-go-to";
import type { PalettePlace } from "./palette-places";
import type { PaletteVisit } from "./palette-visits";

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
    lastReadAt: 1,
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

function place(id: string, title: string): PalettePlace {
  return { id, kind: "page", title, icon: "Zap", split: null, scope: null, run: () => {} };
}

function labelOf(item: PaletteGoToItem): string {
  return item.type === "thread" ? `thread:${item.row.threadId}` : `place:${item.place.id}`;
}

function build({
  query,
  threads = [],
  places = [],
  visits = [],
  searchResponse,
}: {
  query: string;
  threads?: ThreadListEntry[];
  places?: PalettePlace[];
  visits?: PaletteVisit[];
  searchResponse?: ThreadSearchResponse;
}) {
  return buildPaletteGoToResults({
    activeThreads: threads,
    now: NOW,
    places,
    projectNamesById: new Map(),
    query,
    searchResponse,
    searchResultsAreCurrent: true,
    visits,
  });
}

describe("buildPaletteGoToResults", () => {
  it("returns nothing before typing", () => {
    expect(build({ query: "  ", places: [place("tools:plugins", "Plugins")] })).toEqual([]);
  });

  it("matches threads and places on the first keystroke with highlights", () => {
    const results = build({
      query: "a",
      threads: [makeThread("thr_1", { title: "Auth bug" })],
      places: [place("plugin-page:automations/main", "Automations")],
    });
    expect(results.map(labelOf).sort()).toEqual([
      "place:plugin-page:automations/main",
      "thread:thr_1",
    ]);
    for (const item of results) {
      const ranges = item.type === "thread" ? item.row.highlightRanges : item.highlightRanges;
      expect(ranges.length).toBeGreaterThan(0);
    }
  });

  it("breaks ties by visit recency across kinds", () => {
    const results = build({
      query: "docs",
      threads: [makeThread("thr_1", { title: "Docs" })],
      places: [place("plugin-page:docs/main", "Docs")],
      visits: [
        { kind: "page", id: "plugin-page:docs/main", visitedAt: 20 },
        { kind: "thread", id: "thr_1", visitedAt: 10 },
      ],
    });
    expect(results.map(labelOf)).toEqual([
      "place:plugin-page:docs/main",
      "thread:thr_1",
    ]);
  });

  it("puts server-only threads after the first three loaded results without duplicates", () => {
    const loaded = ["thr_1", "thr_2", "thr_3", "thr_4"].map((id) =>
      makeThread(id, { title: `Deploy ${id}` }),
    );
    const serverOnly = makeThread("thr_9", { title: "Weekly notes" });
    const results = build({
      query: "deploy",
      threads: loaded,
      searchResponse: {
        active: {
          total: 2,
          results: [
            { thread: loaded[0], matches: [] },
            { thread: serverOnly, matches: [] },
          ],
        },
        archived: { total: 0, results: [] },
      },
    });
    const labels = results.map(labelOf);
    expect(labels.indexOf("thread:thr_9")).toBe(3);
    expect(labels.filter((label) => label === "thread:thr_1")).toHaveLength(1);
    expect(labels).toHaveLength(5);
  });
});
