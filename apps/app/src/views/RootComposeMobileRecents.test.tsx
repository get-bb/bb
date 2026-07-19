// @vitest-environment jsdom

import type { ThreadListEntry } from "@bb/domain";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";

function makeThread(): ThreadListEntry {
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
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("RootComposeMobileRecents", () => {
  it("does not let runtime gating conceal concurrent Plan and Goal activity", () => {
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

    expect(screen.getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByLabelText("Goal active")).toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
  });

  it("subscribes mobile recents to working draft state", () => {
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

    expect(
      screen.getByLabelText("Thread working with unsubmitted draft"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });
});
