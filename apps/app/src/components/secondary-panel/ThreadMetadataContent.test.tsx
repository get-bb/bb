import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Environment, Thread } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { EnvironmentRow, WorkspacePathRow } from "./ThreadMetadataContent";

const localHost = { locality: "local" } as const;

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: "env_test",
    providerId: "codex",
    title: null,
    titleFallback: null,
    folderId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
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

function renderWorkspacePathRow(environment: Environment): string {
  return renderToStaticMarkup(<WorkspacePathRow environment={environment} />);
}

describe("EnvironmentRow", () => {
  it("uses the promptbox environment icon for managed worktrees", () => {
    const markup = renderEnvironmentRow(makeEnvironment());

    expect(markup).toContain('data-icon="FolderGit"');
    expect(markup).not.toContain('data-icon="Container"');
  });

  it("uses the promptbox environment icon for unmanaged worktrees", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        managed: false,
        workspaceProvisionType: "unmanaged",
      }),
    );

    expect(markup).toContain('data-icon="FolderGit"');
  });

  it("uses the promptbox environment icon for direct workspaces", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        isWorktree: false,
        workspaceProvisionType: "unmanaged",
      }),
    );

    expect(markup).toContain('data-icon="Laptop"');
  });

  it("uses the compact environment label for direct workspaces", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        isWorktree: false,
        workspaceProvisionType: "unmanaged",
      }),
    );

    expect(markup).toContain('title="Working locally">Local</span>');
    expect(markup).not.toContain(">Working locally</span>");
  });

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

describe("WorkspacePathRow", () => {
  it("labels worktree paths as a directory", () => {
    const markup = renderWorkspacePathRow(makeEnvironment());

    expect(markup).toContain("Directory");
    expect(markup).toContain("/workspace");
    expect(markup).not.toContain("Worktree path");
  });

  it("shows non-worktree environment paths as a directory", () => {
    const markup = renderWorkspacePathRow(
      makeEnvironment({
        isWorktree: false,
        workspaceProvisionType: "unmanaged",
      }),
    );

    expect(markup).toContain("Directory");
    expect(markup).toContain("/workspace");
  });
});
