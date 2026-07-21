// @vitest-environment jsdom

import type { ThreadListEntry } from "@bb/domain";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    id: "thr_mobile",
    projectId: "proj_mobile",
    environmentId: null,
    providerId: "codex",
    title: "Mobile activity",
    titleFallback: "Mobile activity",
    sectionId: null,
    status: "active",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 1,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 1,
      activeGoalCount: 1,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "active",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("RootComposeMobileRecents", () => {
  it("shows runtime activity before concurrent Plan and Goal activity", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          showCreatingRow={false}
          threads={[makeThread()]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Thread working")).not.toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
    expect(screen.queryByLabelText("Goal active")).toBeNull();
  });

  it("keeps runtime activity ahead of mobile working draft state", () => {
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_mobile-thr_mobile-3",
      JSON.stringify({ text: "Keep editing", attachments: [] }),
    );

    render(
      <MemoryRouter>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          showCreatingRow={false}
          threads={[makeThread()]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Thread working")).not.toBeNull();
    expect(
      screen.queryByLabelText("Thread working with unsubmitted draft"),
    ).toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });

  it("includes only the resolved idle draft indicator in the link label", () => {
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_mobile-thr_mobile-3",
      JSON.stringify({ text: "Keep editing", attachments: [] }),
    );

    render(
      <MemoryRouter>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              status: "idle",
              activity: {
                activeWorkflowCount: 0,
                activeBackgroundAgentCount: 0,
                activeBackgroundCommandCount: 0,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
              runtime: {
                displayStatus: "idle",
                hostReconnectGraceExpiresAt: null,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", {
        name: "Open Mobile activity — Thread has unsubmitted draft",
      }),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });
});
