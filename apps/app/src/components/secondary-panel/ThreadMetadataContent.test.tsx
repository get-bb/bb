import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Environment, Thread } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { EnvironmentRow } from "./ThreadMetadataContent";

const localHost = { locality: "local" } as const;

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: "env_test",
    automationId: null,
    providerId: "codex",
    title: null,
    titleFallback: null,
    status: "idle",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "env_test",
    name: null,
    projectId: "proj_test",
    hostId: "host_test",
    path: "/workspace",
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    branchName: "feature",
    baseBranch: "main",
    defaultBranch: "main",
    mergeBaseBranch: null,
    cleanupRequestedAt: null,
    cleanupMode: null,
    status: "ready",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function renderEnvironmentRow(environment: Environment): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <EnvironmentRow
        thread={makeThread({ environmentId: environment.id })}
        environment={environment}
        environmentDisplayHost={localHost}
      />
    </MemoryRouter>,
  );
}

describe("EnvironmentRow", () => {
  it("shows the create-thread action for a provisioned worktree", () => {
    expect(renderEnvironmentRow(makeEnvironment())).toContain(
      'aria-label="Create new thread in this worktree"',
    );
  });

  it("hides the create-thread action while a managed worktree is provisioning", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        status: "provisioning",
        path: null,
        isWorktree: false,
      }),
    );

    expect(markup).not.toContain(
      'aria-label="Create new thread in this worktree"',
    );
  });

  it("hides the create-thread action before a prepared worktree has a path", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        path: null,
        isWorktree: false,
      }),
    );

    expect(markup).not.toContain(
      'aria-label="Create new thread in this worktree"',
    );
  });
});
