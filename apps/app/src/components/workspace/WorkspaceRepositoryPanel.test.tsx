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
  onCommitAndPush: vi.fn(),
  onCreatePullRequest: vi.fn(),
  onDiscardPullRequestDraft: vi.fn(),
  onOpenAllChanges: vi.fn(),
  onOpenChangedFile: vi.fn(),
  onOpenFile: vi.fn(),
  onOpenUrl: vi.fn(),
  onPullRequestDraftChange: vi.fn(),
  onSavePullRequestDraft: vi.fn(),
  pullRequestDraft: { title: "", description: "" },
  pullRequestDraftIsDirty: false,
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

  it("opens a changed file in the diff viewer", () => {
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
              {
                path: "changed.ts",
                status: "M",
                insertions: 1,
                deletions: 1,
              },
            ],
            insertions: 1,
            deletions: 1,
          },
        })}
      />,
    );

    fireEvent.click(screen.getByText("changed.ts"));

    expect(commonProps.onOpenChangedFile).toHaveBeenCalledWith("changed.ts");
    expect(commonProps.onOpenFile).not.toHaveBeenCalled();
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
    expect(screen.getByText("No PR open")).toBeTruthy();
  });

  it("shows PR preparation placeholders when no PR is open", () => {
    render(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="checks"
        pullRequestResponse={{ outcome: "absent" }}
        workspaceStatus={makeWorkspaceStatus()}
      />,
    );

    const title = screen.getByPlaceholderText("PR title");
    const description = screen.getByPlaceholderText("PR description");
    expect(title.className).toContain("text-muted-foreground/60");
    expect(description.className).toContain("text-muted-foreground/60");
  });

  it("keeps the draft action slot the same height when buttons are hidden", () => {
    const view = render(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="checks"
        pullRequestResponse={{ outcome: "absent" }}
        workspaceStatus={makeWorkspaceStatus()}
      />,
    );

    expect(
      screen.getByLabelText("Pull request draft actions").className,
    ).toContain("h-8");

    view.rerender(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="checks"
        pullRequestDraft={{ title: "Test", description: "Test description" }}
        pullRequestDraftIsDirty
        pullRequestResponse={{ outcome: "absent" }}
        workspaceStatus={makeWorkspaceStatus()}
      />,
    );

    expect(
      screen.getByLabelText("Pull request draft actions").className,
    ).toContain("h-8");
  });

  it("shows useful git status rows only when the workspace has them", () => {
    const view = render(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="checks"
        pullRequestResponse={{ outcome: "absent" }}
        workspaceStatus={makeWorkspaceStatus({
          workingTree: {
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
            files: Array.from({ length: 6 }, (_, index) => ({
              path: `file-${index}.ts`,
              status: "M" as const,
              insertions: 1,
              deletions: 0,
            })),
            insertions: 6,
            deletions: 0,
          },
          mergeBase: {
            mergeBaseBranch: "main",
            baseRef: "main",
            aheadCount: 0,
            behindCount: 1,
            hasCommittedUnmergedChanges: false,
            commits: [],
            files: [],
            insertions: 0,
            deletions: 0,
          },
        })}
      />,
    );

    expect(screen.getByText("Git status")).toBeTruthy();
    expect(screen.getByText("6 uncommitted changes")).toBeTruthy();
    expect(screen.getByText("Commit and push")).toBeTruthy();
    expect(screen.getByText("1 commit behind main")).toBeTruthy();
    expect(screen.getByText("Pull")).toBeTruthy();
    const createPullRequestButton = screen.getByRole("button", {
      name: "Create PR",
    });
    const commitAndPushButton = screen.getByRole("button", {
      name: "Commit and push",
    });
    expect(createPullRequestButton.className).toContain(
      "hover:text-foreground",
    );
    expect(createPullRequestButton.className).toContain(
      "text-muted-foreground/60",
    );
    expect(commitAndPushButton.className).toContain("hover:text-foreground");
    expect(commitAndPushButton.className).toContain("text-muted-foreground/60");
    fireEvent.click(createPullRequestButton);
    fireEvent.click(commitAndPushButton);
    expect(commonProps.onCreatePullRequest).toHaveBeenCalledOnce();
    expect(commonProps.onCommitAndPush).toHaveBeenCalledOnce();

    view.rerender(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="checks"
        pullRequestResponse={{ outcome: "absent" }}
        workspaceStatus={makeWorkspaceStatus()}
      />,
    );

    expect(screen.queryByText("uncommitted changes")).toBeNull();
    expect(screen.queryByText("behind main")).toBeNull();
  });

  it("edits the PR draft and exposes save and discard actions", () => {
    const onChange = vi.fn();
    const onDiscard = vi.fn();
    const onSave = vi.fn();
    render(
      <WorkspaceRepositoryPanel
        {...commonProps}
        activeTab="checks"
        onDiscardPullRequestDraft={onDiscard}
        onPullRequestDraftChange={onChange}
        onSavePullRequestDraft={onSave}
        pullRequestDraft={{ title: "Test", description: "Test description" }}
        pullRequestDraftIsDirty
        pullRequestResponse={{ outcome: "absent" }}
        workspaceStatus={makeWorkspaceStatus()}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "PR title" }).className,
    ).toContain("text-foreground");
    expect(
      screen.getByRole("textbox", { name: "PR description" }).className,
    ).toContain("text-muted-foreground/60");
    fireEvent.change(screen.getByRole("textbox", { name: "PR title" }), {
      target: { value: "Updated title" },
    });
    expect(onChange).toHaveBeenCalledWith({
      title: "Updated title",
      description: "Test description",
    });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("keeps commit metadata out of Checks", () => {
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

    expect(screen.getByText("Git status")).toBeTruthy();
    expect(screen.queryByText("Current commit")).toBeNull();
    expect(screen.queryByText("agent-thread-workspace-sidebar")).toBeNull();
    expect(screen.queryByText("01234567")).toBeNull();
    expect(screen.queryByText("Refine the workspace sidebar")).toBeNull();
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
