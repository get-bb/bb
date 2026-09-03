import { emptyPromptDraftState } from "@bb/client-core";
import type { ThreadListEntry } from "@bb/domain";
import type { ThreadSearchResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildPaletteThreadSearchRows,
  type PaletteNewThreadDraft,
} from "./palette-thread-search";

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
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    queuedWork: "none",
    ...overrides,
  };
}

function makeDraft(id: string, title: string): PaletteNewThreadDraft {
  return {
    id,
    title,
    draft: { ...emptyPromptDraftState(), text: title },
    lastEditedAt: NOW,
    destination: { projectId: "project-1", sectionId: null },
  };
}

function build(
  overrides: Partial<Parameters<typeof buildPaletteThreadSearchRows>[0]> = {},
) {
  return buildPaletteThreadSearchRows({
    drafts: [],
    now: NOW,
    projectNamesById: new Map([["project-1", "Palette project"]]),
    query: "match",
    recentArchivedThreads: [],
    recentThreads: [],
    scope: "all",
    searchResponse: {
      active: { results: [], total: 0 },
      archived: { results: [], total: 0 },
    },
    searchResultsAreCurrent: true,
    ...overrides,
  });
}

describe("buildPaletteThreadSearchRows", () => {
  it("builds one active, draft, archived list with a local draft total", () => {
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
      drafts: [makeDraft("draft", "A matching local draft")],
      searchResponse,
    });

    expect(result.rows.map((row) => row.lifecycle)).toEqual([
      "active",
      "draft",
      "archived",
    ]);
    expect(result.draftMatchCount).toBe(1);
  });

  it("narrows lifecycle immediately without changing row anatomy", () => {
    const result = build({
      drafts: [makeDraft("draft", "A matching local draft")],
      scope: "draft",
    });

    expect(result.rows).toMatchObject([
      {
        lifecycle: "draft",
        metadataText: "Palette project · just now",
        projectId: "project-1",
        draftSlotId: "draft",
      },
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
    });
  });

  it("orders active, draft, and archived recents and does not reuse them for a one-character query", () => {
    const active = makeThread("recent-active");
    const archived = makeThread("recent-archived", { archivedAt: NOW - 1 });
    const recents = build({
      drafts: [makeDraft("recent-draft", "Recent draft")],
      query: "",
      recentArchivedThreads: [archived],
      recentThreads: [active],
    });
    expect(recents).toMatchObject({
      isRecent: true,
      rows: [
        { id: "active:recent-active" },
        { id: "draft:recent-draft" },
        { id: "archived:recent-archived" },
      ],
    });
    expect(build({ query: "m", recentThreads: [active] })).toMatchObject({
      isRecent: false,
      rows: [],
    });
  });
});
