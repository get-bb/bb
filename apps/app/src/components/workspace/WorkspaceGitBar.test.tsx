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
const pullRequestDraft = { title: "", description: "" };

function openMenu(): void {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "More pull request actions" }),
    { button: 0, ctrlKey: false },
  );
}

describe("WorkspacePullRequestButton", () => {
  it("opens the agent flow and exposes a manual alternative", () => {
    const onStartAgent = vi.fn(async () => {});
    const onOpenUrl = vi.fn();
    render(
      <WorkspacePullRequestButton
        agentConfig={null}
        canSpawnAgent
        onMerge={vi.fn()}
        onOpenUrl={onOpenUrl}
        onStartAgent={onStartAgent}
        pendingAction={null}
        pullRequestDraft={pullRequestDraft}
        pullRequestResponse={{ outcome: "absent" }}
        repositoryUrl="https://github.com/acme/example"
        workspaceStatus={workspaceStatus}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Create PR" }).className,
    ).toContain("h-6");
    expect(
      screen.getByRole("button", { name: "Create PR" }).className,
    ).toContain("border-r-border");
    expect(
      screen.getByRole("button", { name: "Create PR" }).className,
    ).toContain("pr-2");
    expect(
      screen.getByRole("button", { name: "More pull request actions" })
        .className,
    ).toContain("h-6");
    fireEvent.click(screen.getByRole("button", { name: "Create PR" }));
    expect(screen.getByText("Ask an agent to create the PR")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    openMenu();
    const draftAction = screen.getByRole("menuitem", {
      name: "Create draft PR",
    });
    expect(
      draftAction.querySelector('[data-icon="GitPullRequestDraft"]'),
    ).not.toBeNull();
    fireEvent.click(draftAction);
    expect(screen.getByDisplayValue(/draft pull request/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    openMenu();
    const manualAction = screen.getByRole("menuitem", {
      name: "Create PR manually",
    });
    expect(
      manualAction.querySelector('[data-icon="ExternalLink"]'),
    ).not.toBeNull();
    fireEvent.click(manualAction);
    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://github.com/acme/example/compare/main...feature%2Fsidebar?expand=1",
    );
  });

  it("disables merge actions while a merge runs", () => {
    render(
      <WorkspacePullRequestButton
        agentConfig={null}
        canSpawnAgent
        onMerge={vi.fn()}
        onOpenUrl={vi.fn()}
        onStartAgent={vi.fn(async () => {})}
        pendingAction="merge"
        pullRequestDraft={pullRequestDraft}
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
              totalCount: 0,
              passedCount: 0,
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

    const mergeButton = screen.getByRole("button", { name: "Merging…" });
    expect(mergeButton.hasAttribute("disabled")).toBe(true);
    expect(mergeButton.className).toContain("h-6");
    expect(
      screen.getByRole("button", { name: "More pull request actions" })
        .className,
    ).toContain("h-6");
  });

  it("changes to Merge when the pull request is mergeable", () => {
    const onMerge = vi.fn();
    render(
      <WorkspacePullRequestButton
        agentConfig={null}
        canSpawnAgent
        onMerge={onMerge}
        onOpenUrl={vi.fn()}
        onStartAgent={vi.fn(async () => {})}
        pendingAction={null}
        pullRequestDraft={pullRequestDraft}
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
        agentConfig={null}
        canSpawnAgent
        onMerge={vi.fn()}
        onOpenUrl={vi.fn()}
        onStartAgent={vi.fn(async () => {})}
        pendingAction={null}
        pullRequestDraft={pullRequestDraft}
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
