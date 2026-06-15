// @vitest-environment jsdom

import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Environment, Thread, ThreadPullRequest } from "@bb/domain";
import type { EnvironmentDisplayHostContext } from "@bb/core-ui";
import type { ThreadSchedule } from "@bb/server-contract";
import { makeWorkspaceStatus } from "@bb/test-helpers";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvironmentRow,
  GitStatusRow,
  MergeBaseRow,
  PullRequestRow,
  ThreadSchedulesRow,
  WorkspacePathRow,
} from "./ThreadMetadataContent";

type ThreadOverrides = Partial<Thread>;
type EnvironmentOverrides = Partial<Environment>;
type ThreadScheduleOverrides = Partial<ThreadSchedule>;

const localEnvironmentDisplayHost: EnvironmentDisplayHostContext = {
  locality: "local",
};

const remoteEnvironmentDisplayHost: EnvironmentDisplayHostContext = {
  locality: "remote",
};

function renderWithRouter(element: ReactElement) {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

function makeThread(overrides: ThreadOverrides = {}): Thread {
  const base: Thread = {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: "env_test",
    automationId: null,
    providerId: "openai",
    title: "Test thread",
    titleFallback: null,
    status: "idle",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };

  return { ...base, ...overrides };
}

function makeEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  const base: Environment = {
    id: "env_test",
    name: null,
    projectId: "proj_test",
    hostId: "hst_test",
    path: "/Users/michael/Projects/bb",
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    branchName: "feature/projectless-threads",
    baseBranch: "main",
    defaultBranch: "main",
    mergeBaseBranch: null,
    cleanupRequestedAt: null,
    cleanupMode: null,
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
  };

  return { ...base, ...overrides };
}

function makeThreadSchedule(
  overrides: ThreadScheduleOverrides = {},
): ThreadSchedule {
  const base: ThreadSchedule = {
    id: "tsched_test",
    projectId: "proj_test",
    threadId: "thr_test",
    name: "Daily check-in",
    enabled: true,
    kind: "cron",
    cron: "0 8 * * 1-5",
    timezone: "America/Los_Angeles",
    prompt: "Review current work and summarize useful progress.",
    nextFireAt: Date.parse("2026-06-08T15:00:00.000Z"),
    lastFiredAt: null,
    createdAt: 1,
    updatedAt: 1,
  };

  return { ...base, ...overrides };
}

afterEach(() => {
  cleanup();
});

describe("WorkspacePathRow", () => {
  it("keeps the worktree label for worktree environments", () => {
    render(
      <WorkspacePathRow
        thread={makeThread()}
        environment={makeEnvironment({
          path: "/Users/michael/.bb-dev/worktrees/env_demo/bb",
        })}
      />,
    );

    expect(screen.getByText("Worktree path")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy worktree path" }).textContent,
    ).toBe("/Users/michael/.bb-dev/worktrees/env_demo/bb");
  });

  it("shows a workspace path for personal projectless environments", () => {
    render(
      <WorkspacePathRow
        thread={makeThread()}
        environment={makeEnvironment({
          path: "/Users/michael/Projects/bb",
          workspaceProvisionType: "personal",
        })}
      />,
    );

    expect(screen.getByText("Workspace path")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy workspace path" }).textContent,
    ).toBe("/Users/michael/Projects/bb");
  });

  it("does not show a path for non-projectless direct workspaces", () => {
    const { container } = render(
      <WorkspacePathRow
        thread={makeThread()}
        environment={makeEnvironment({
          isWorktree: false,
          workspaceProvisionType: "unmanaged",
        })}
      />,
    );

    expect(container.textContent).toBe("");
  });
});

describe("EnvironmentRow", () => {
  it("labels a direct workspace on a remote host as remote", () => {
    renderWithRouter(
      <EnvironmentRow
        thread={makeThread()}
        environment={makeEnvironment({
          isWorktree: false,
          workspaceProvisionType: "unmanaged",
        })}
        environmentDisplayHost={remoteEnvironmentDisplayHost}
      />,
    );

    expect(screen.getByText("Working remotely")).not.toBeNull();
  });

  it("keeps local direct workspace labels local", () => {
    renderWithRouter(
      <EnvironmentRow
        thread={makeThread()}
        environment={makeEnvironment({
          isWorktree: false,
          workspaceProvisionType: "unmanaged",
        })}
        environmentDisplayHost={localEnvironmentDisplayHost}
      />,
    );

    expect(screen.getByText("Working locally")).not.toBeNull();
  });
});

describe("MergeBaseRow", () => {
  it("requests branch options when the Info tab merge-base picker opens", () => {
    const handleOpenChange = vi.fn();

    render(
      <MergeBaseRow
        thread={makeThread()}
        workspaceStatus={makeWorkspaceStatus({
          branch: {
            currentBranch: "feature/projectless-threads",
            defaultBranch: "main",
          },
        })}
        selectedMergeBaseBranch={undefined}
        mergeBaseBranchOptions={undefined}
        isLoadingMergeBaseBranchOptions={false}
        onMergeBaseBranchChange={vi.fn()}
        onMergeBasePickerOpenChange={handleOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Branch" }));

    expect(handleOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("Branches")).not.toBeNull();
  });
});

describe("GitStatusRow", () => {
  it("renders typed workspace unavailable state without a query error", () => {
    render(
      <GitStatusRow
        thread={makeThread()}
        environment={makeEnvironment()}
        workspaceStatus={undefined}
        workspaceStatusError={null}
        workspaceUnavailable={{
          code: "workspace_type_mismatch",
          workspacePath: "/tmp/current",
          message:
            "Loaded environment env_test is bound to /tmp/old, not /tmp/current",
        }}
        selectedMergeBaseBranch={undefined}
      />,
    );

    expect(screen.getByText("Git status")).not.toBeNull();
    expect(screen.getByText("Unknown")).not.toBeNull();
    expect(
      screen.getByText(
        "Loaded environment env_test is bound to /tmp/old, not /tmp/current",
      ),
    ).not.toBeNull();
  });
});

describe("PullRequestRow", () => {
  function makePullRequest(
    overrides: Partial<ThreadPullRequest> = {},
  ): ThreadPullRequest {
    return {
      number: 42,
      title: "Add pull request section",
      state: "open",
      url: "https://github.com/acme/bb/pull/42",
      ...overrides,
    };
  }

  it("renders the PR number, state, and an external link", () => {
    render(<PullRequestRow pullRequest={makePullRequest()} />);

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/bb/pull/42",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("PR #42");
    expect(link.textContent).toContain("Open");
    // The full title is surfaced via the link tooltip.
    expect(link.getAttribute("title")).toBe("Add pull request section");
  });

  it.each([
    ["draft", "Draft"],
    ["merged", "Merged"],
    ["closed", "Closed"],
  ] as const)("labels the %s state as %s", (state, label) => {
    render(<PullRequestRow pullRequest={makePullRequest({ state })} />);

    expect(screen.getByRole("link").textContent).toContain(label);
  });

  it("renders nothing when there is no PR", () => {
    const { container } = render(<PullRequestRow pullRequest={null} />);

    expect(container.firstChild).toBeNull();
  });
});

describe("ThreadSchedulesRow", () => {
  it("renders nothing when there are no schedules", () => {
    const { container } = render(<ThreadSchedulesRow schedules={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("shows the schedule name and a humanized next run instead of the raw cron", () => {
    render(<ThreadSchedulesRow schedules={[makeThreadSchedule()]} />);

    expect(screen.getByText("Schedules")).not.toBeNull();
    expect(screen.getByText("Daily check-in")).not.toBeNull();
    // Enabled schedules surface their next run, never the raw cron expression.
    expect(screen.getByText(/Next /)).not.toBeNull();
    expect(screen.queryByText("0 8 * * 1-5")).toBeNull();
  });

  it("marks a disabled schedule as paused with no next run", () => {
    render(
      <ThreadSchedulesRow
        schedules={[makeThreadSchedule({ enabled: false })]}
      />,
    );

    expect(screen.getByText(/Paused/)).not.toBeNull();
    expect(screen.queryByText(/Next /)).toBeNull();
  });
});
