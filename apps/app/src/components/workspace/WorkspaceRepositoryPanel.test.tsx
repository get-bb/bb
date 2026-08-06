// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeWorkspaceStatus } from "@bb/test-helpers";
import type { ThreadPullRequest } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRepositoryPanel } from "./WorkspaceRepositoryPanel";

const { refreshTree } = vi.hoisted(() => ({ refreshTree: vi.fn() }));
vi.mock("./file-tree/useWorkspaceFileTree", () => ({
  useWorkspaceFileTree: () => ({ refresh: refreshTree }),
}));
vi.mock("./file-tree/WorkspaceFileTree", () => ({
  WorkspaceFileTree: () => <div>file tree</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pullRequest: ThreadPullRequest = {
  number: 42,
  title: "Workspace sidebar",
  state: "open",
  url: "https://github.com/example/bb/pull/42",
  baseRefName: "main",
  headRefName: "workspace-sidebar",
  updatedAt: "2026-08-06T00:00:00.000Z",
  checks: {
    state: "passing",
    totalCount: 1,
    passedCount: 1,
    failedCount: 0,
    pendingCount: 0,
  },
  checkItems: [
    {
      name: "test",
      status: "completed",
      conclusion: "success",
      url: "https://github.com/example/bb/actions/1",
    },
  ],
  comments: [
    {
      authorLogin: "oscar",
      authorAvatarUrl: null,
      bodySummary: "Please keep this compact, with overflow on the next line.",
      createdAt: "2026-08-06T00:00:00.000Z",
      url: "https://github.com/example/bb/pull/42#comment-1",
    },
  ],
  review: { state: "review_required", reviewRequestCount: 0 },
  mergeability: {
    state: "mergeable",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  },
  attention: "ready_to_merge",
};

const commonProps = {
  environmentId: "env_1",
  onOpenAllChanges: vi.fn(),
  onOpenFile: vi.fn(),
  onOpenUrl: vi.fn(),
};

describe("WorkspaceRepositoryPanel", () => {
  it("labels added, modified, and deleted changes without relying on colour", () => {
    render(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="changes"
        pullRequestResponse={{ outcome: "absent" }}
        workspaceStatus={makeWorkspaceStatus({
          workingTree: {
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
            files: [
              { path: "new.ts", status: "A", insertions: 1, deletions: 0 },
              { path: "changed.ts", status: "M", insertions: 1, deletions: 1 },
              { path: "gone.ts", status: "D", insertions: 0, deletions: 1 },
            ],
            insertions: 2,
            deletions: 2,
          },
        })}
      />,
    );

    expect(screen.getByLabelText("Added")).toBeTruthy();
    expect(screen.getByLabelText("Modified")).toBeTruthy();
    expect(screen.getByLabelText("Deleted")).toBeTruthy();
  });

  it("keeps comment author and summary in one two-line clamped row", () => {
    render(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="checks"
        pullRequestResponse={{ outcome: "available", pullRequest }}
        workspaceStatus={makeWorkspaceStatus()}
      />,
    );

    const summary = screen.getByText(/Please keep this compact/u).closest("p");
    expect(summary?.className).toContain("line-clamp-2");
    expect(summary?.textContent).toContain("oscar");
    fireEvent.click(screen.getByText(/Please keep this compact/u));
    expect(commonProps.onOpenUrl).toHaveBeenCalledWith(
      "https://github.com/example/bb/pull/42#comment-1",
    );
  });

  it("shows Offline separately from a missing pull request", () => {
    const view = render(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="checks"
        pullRequestResponse={{ outcome: "unavailable", message: "network" }}
        workspaceStatus={makeWorkspaceStatus()}
      />,
    );
    expect(screen.getByText("Offline")).toBeTruthy();

    view.rerender(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="checks"
        pullRequestResponse={{ outcome: "absent" }}
        workspaceStatus={makeWorkspaceStatus()}
      />,
    );
    expect(screen.getByText("No pull request")).toBeTruthy();
  });

  it("shows the branch and commit details in Checks", () => {
    render(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="checks"
        pullRequestResponse={{ outcome: "absent" }}
        workspaceStatus={makeWorkspaceStatus({
          checkout: {
            kind: "branch",
            branchName: "agent-thread-workspace-sidebar",
            headSha: "0123456789abcdef",
          },
          mergeBase: {
            mergeBaseBranch: "main",
            baseRef: "main",
            aheadCount: 1,
            behindCount: 0,
            hasCommittedUnmergedChanges: true,
            commits: [
              {
                sha: "0123456789abcdef",
                shortSha: "01234567",
                subject: "Refine the workspace sidebar",
                authorName: "Oscar",
                authoredAt: 1,
              },
            ],
            files: [],
            insertions: 0,
            deletions: 0,
          },
        })}
      />,
    );

    expect(screen.getByText("agent-thread-workspace-sidebar")).toBeTruthy();
    expect(screen.getByText("01234567")).toBeTruthy();
    expect(screen.getByText("Refine the workspace sidebar")).toBeTruthy();
  });

  it("refreshes visible files when the workspace changes", () => {
    const initialStatus = makeWorkspaceStatus();
    const view = render(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="all-files"
        pullRequestResponse={{ outcome: "absent" }}
        workspaceStatus={initialStatus}
      />,
    );
    expect(refreshTree).not.toHaveBeenCalled();

    view.rerender(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="all-files"
        pullRequestResponse={{ outcome: "absent" }}
        workspaceStatus={makeWorkspaceStatus({
          workingTree: {
            ...initialStatus.workingTree,
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
            files: [
              {
                path: "new.ts",
                status: "A",
                insertions: 1,
                deletions: 0,
              },
            ],
          },
        })}
      />,
    );
    expect(refreshTree).toHaveBeenCalledTimes(1);
  });
});
