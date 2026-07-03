// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ThreadListEntry } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadSearchResultRow } from "./ThreadSearchResultRow";

function createThread(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id: "thr_search_result_test",
    projectId: "proj_test",
    environmentId: null,
    providerId: "codex",
    title: "Search result thread",
    titleFallback: "Search result thread",
    folderId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    activity: { activeWorkflowCount: 0 },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

afterEach(cleanup);

describe("ThreadSearchResultRow", () => {
  it("shows workflow activity instead of the generic runtime spinner", () => {
    render(
      <ThreadSearchResultRow
        id="row-workflow"
        isActive={false}
        matches={[]}
        onActive={vi.fn()}
        onSelect={vi.fn()}
        projectName="bb"
        thread={createThread({
          status: "active",
          activity: { activeWorkflowCount: 1 },
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
        })}
      />,
    );

    expect(screen.getByLabelText("Workflow running")).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
  });
});
