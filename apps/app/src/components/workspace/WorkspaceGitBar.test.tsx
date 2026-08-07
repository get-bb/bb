// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeWorkspaceStatus } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getGitHubRepositoryUrl,
  WorkspacePullRequestButton,
} from "./WorkspaceGitBar";

afterEach(cleanup);

const workspaceStatus = makeWorkspaceStatus({
  checkout: {
    kind: "branch",
    branchName: "feature/sidebar",
    headSha: "0123456789abcdef",
  },
  branch: { currentBranch: "feature/sidebar", defaultBranch: "main" },
});

function openMenu(): void {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "More pull request actions" }),
    { button: 0, ctrlKey: false },
  );
}

describe("WorkspacePullRequestButton", () => {
  it("creates a pull request and exposes draft and manual alternatives", () => {
    const onCreate = vi.fn();
    const onOpenUrl = vi.fn();
    render(
      <WorkspacePullRequestButton
        onCreate={onCreate}
        onMerge={vi.fn()}
        onOpenUrl={onOpenUrl}
        pendingAction={null}
        pullRequestResponse={{ outcome: "absent" }}
        repositoryUrl="https://github.com/acme/example"
        workspaceStatus={workspaceStatus}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create PR" }));
    expect(onCreate).toHaveBeenCalledWith(false);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Create draft PR" }));
    expect(onCreate).toHaveBeenCalledWith(true);

    openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Create PR manually" }),
    );
    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://github.com/acme/example/compare/main...feature%2Fsidebar?expand=1",
    );
  });

  it("shows the creating state while automatic creation runs", () => {
    render(
      <WorkspacePullRequestButton
        onCreate={vi.fn()}
        onMerge={vi.fn()}
        onOpenUrl={vi.fn()}
        pendingAction="create"
        pullRequestResponse={{ outcome: "absent" }}
        repositoryUrl="https://github.com/acme/example"
        workspaceStatus={workspaceStatus}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "Creating…" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("changes to Merge when the pull request is mergeable", () => {
    const onMerge = vi.fn();
    render(
      <WorkspacePullRequestButton
        onCreate={vi.fn()}
        onMerge={onMerge}
        onOpenUrl={vi.fn()}
        pendingAction={null}
        pullRequestResponse={{
          outcome: "available",
          pullRequest: {
            number: 42,
            title: "Workspace sidebar",
            state: "open",
            url: "https://github.com/acme/example/pull/42",
            baseRefName: "main",
            headRefName: "feature/sidebar",
            updatedAt: "2026-08-06T00:00:00.000Z",
            checks: {
              state: "passing",
              totalCount: 1,
              passedCount: 1,
              failedCount: 0,
              pendingCount: 0,
            },
            checkItems: [],
            comments: [],
            review: { state: "approved", reviewRequestCount: 0 },
            mergeability: {
              state: "mergeable",
              mergeStateStatus: "CLEAN",
              mergeable: "MERGEABLE",
            },
            attention: "ready_to_merge",
          },
        }}
        repositoryUrl="https://github.com/acme/example"
        workspaceStatus={workspaceStatus}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onMerge).toHaveBeenCalledWith("merge");
  });

  it("shows Offline when GitHub status is unavailable", () => {
    render(
      <WorkspacePullRequestButton
        onCreate={vi.fn()}
        onMerge={vi.fn()}
        onOpenUrl={vi.fn()}
        pendingAction={null}
        pullRequestResponse={{ outcome: "unavailable", message: "no auth" }}
        repositoryUrl="https://github.com/acme/example"
        workspaceStatus={workspaceStatus}
      />,
    );

    expect(screen.getByRole("button", { name: "Offline" })).not.toBeNull();
  });
});

describe("getGitHubRepositoryUrl", () => {
  it.each([
    ["git@github.com:acme/example.git", "https://github.com/acme/example"],
    ["https://github.com/acme/example.git", "https://github.com/acme/example"],
    [
      "ssh://git@github.com/acme/example.git",
      "https://github.com/acme/example",
    ],
  ])("normalises %s", (remote, expected) => {
    expect(getGitHubRepositoryUrl(remote)).toBe(expected);
  });

  it("rejects non-GitHub remotes", () => {
    expect(getGitHubRepositoryUrl("https://example.com/acme/example.git")).toBe(
      null,
    );
  });
});
