// @vitest-environment jsdom

import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Environment, Thread, ThreadListEntry } from "@bb/domain";
import type { EnvironmentDisplayHostContext } from "@bb/core-ui";
import type { ThreadSchedule } from "@bb/server-contract";
import { makeWorkspaceStatus } from "@bb/test-helpers";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvironmentRow,
  ForksRow,
  GitStatusRow,
  hasAnyThreadMetadata,
  MergeBaseRow,
  ThreadSchedulesRow,
  WorkspacePathRow,
} from "./ThreadMetadataContent";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { threadListQueryKey } from "@/hooks/queries/query-keys";

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
    childOrigin: null,
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

function makeForkListEntry(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  const base: ThreadListEntry = {
    id: "thr_fork",
    projectId: "proj_test",
    environmentId: "env_fork",
    automationId: null,
    providerId: "openai",
    title: "Test thread (fork)",
    titleFallback: null,
    status: "idle",
    parentThreadId: "thr_test",
    childOrigin: "fork",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "managed-worktree",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
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

describe("ForksRow", () => {
  it("renders nothing when the thread has no forks", () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const thread = makeThread();
    queryClient.setQueryData(
      threadListQueryKey({
        projectId: thread.projectId,
        parentThreadId: thread.id,
        childOrigin: "fork",
        archived: false,
      }),
      [],
    );

    const { container } = render(
      <MemoryRouter>
        <ForksRow thread={thread} projectId="proj_test" />
      </MemoryRouter>,
      { wrapper },
    );

    expect(container.textContent).toBe("");
  });

  it("links each fork child to its thread route", () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const thread = makeThread();
    queryClient.setQueryData(
      threadListQueryKey({
        projectId: thread.projectId,
        parentThreadId: thread.id,
        childOrigin: "fork",
        archived: false,
      }),
      [
        makeForkListEntry({ id: "thr_fork_a", title: "Explore alt (fork)" }),
        makeForkListEntry({ id: "thr_fork_b", title: "Try other path (fork)" }),
      ],
    );

    render(
      <MemoryRouter>
        <ForksRow thread={thread} projectId="proj_test" />
      </MemoryRouter>,
      { wrapper },
    );

    expect(screen.getByText("Forks")).not.toBeNull();
    const forkLink = screen.getByRole("link", { name: "Explore alt (fork)" });
    expect(forkLink.getAttribute("href")).toBe(
      "/projects/proj_test/threads/thr_fork_a",
    );
    expect(
      screen
        .getByRole("link", { name: "Try other path (fork)" })
        .getAttribute("href"),
    ).toBe("/projects/proj_test/threads/thr_fork_b");
  });
});

describe("hasAnyThreadMetadata", () => {
  function makeBareMetadataProps() {
    return {
      thread: makeThread(),
      parentThreadDisplayName: null,
      environment: null,
      workspaceStatus: undefined,
      workspaceStatusError: null,
      workspaceUnavailable: undefined,
      threadSchedules: [],
    };
  }

  it("is false for a bare thread with no metadata and no forks", () => {
    expect(hasAnyThreadMetadata(makeBareMetadataProps(), false)).toBe(false);
  });

  it("is true for a forks-only thread (otherwise-empty metadata)", () => {
    expect(hasAnyThreadMetadata(makeBareMetadataProps(), true)).toBe(true);
  });
});
