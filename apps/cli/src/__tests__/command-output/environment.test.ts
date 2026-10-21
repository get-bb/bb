import type { ThreadPullRequest } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  getHelpOutput,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerEnvironmentCommands } from "../../commands/environment.js";

describe("bb environment command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerEnvironmentCommands(program, () => "http://server");

  const pullRequest: ThreadPullRequest = {
    number: 701,
    title: "Environment inspection parity",
    state: "open",
    url: "https://github.com/example/bb/pull/701",
    baseRefName: "main",
    headRefName: "bb/environment-cli",
    updatedAt: "2026-07-14T12:00:00.000Z",
    autoMerge: false,
    inMergeQueue: false,
    checks: {
      state: "passing",
      totalCount: 2,
      passedCount: 2,
      failedCount: 0,
      pendingCount: 0,
    },
    review: {
      state: "review_required",
      reviewRequestCount: 1,
    },
    mergeability: {
      state: "mergeable",
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    },
    attention: "ready_to_merge",
  };

  it("does not list a squash-merge command in help", async () => {
    const help = await getHelpOutput(["environment"], register);

    expect(help).not.toContain("squash-merge");
  });

  it("bb environment providers lists selectable ids and required inputs", async () => {
    stubServerApi({
      "v1.system.environment-providers.$get": vi.fn(async () => ({
        providers: [
          {
            id: "git-worktree",
            displayName: "Worktree",
            description: "Prepare a workspace for this thread.",
            icon: "Folder",
            pluginId: "environment-git-worktree",
            acceptsEmptyInputs: false,
            machineAvailability: {},
            availability: { status: "available" },
            requires: {
              projectCheckout: true,
              gitCheckout: true,
              gitRemote: false,
              projectless: false,
            },
            inputs: {
              type: "object",
              properties: { branch: { type: "object" } },
              required: ["branch"],
            },
          },
          {
            id: "modal-sandbox",
            displayName: "Modal sandbox",
            description: "Prepare a workspace for this thread.",
            icon: "Folder",
            pluginId: "environment-modal-sandbox",
            acceptsEmptyInputs: true,
            machineAvailability: {},
            availability: {
              status: "setup-required",
              message: "Add Modal credentials",
            },
            requires: {
              projectCheckout: false,
              gitCheckout: false,
              gitRemote: true,
              projectless: false,
            },
            inputs: null,
          },
        ],
      })),
    });

    await runCommand(["environment", "providers"], register);

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "git-worktree  Worktree  projectCheckout, gitCheckout  takes --environment-inputs",
      "modal-sandbox  Modal sandbox  gitRemote",
    ]);
  });

  it("bb environment providers requests eligibility for a project and machine", async () => {
    const getProviders = vi.fn(async () => ({ providers: [] }));
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        {
          id: "host-remote",
          name: "builder",
          status: "connected",
          lastSeenAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      "v1.system.environment-providers.$get": getProviders,
    });

    await runCommand(
      [
        "environment",
        "providers",
        "--project",
        "proj-1",
        "--machine",
        "builder",
        "--json",
      ],
      register,
    );

    expect(getProviders).toHaveBeenCalledWith({
      query: { projectId: "proj-1", hostId: "host-remote" },
    });
  });

  it("bb environment providers prints each provider's availability on the chosen machine", async () => {
    const provider = {
      displayName: "Provider",
      description: "Prepare a workspace for this thread.",
      icon: "Folder",
      pluginId: "plugin",
      acceptsEmptyInputs: true,
      inputs: null,
      requires: {
        projectCheckout: false,
        gitCheckout: false,
        gitRemote: false,
        projectless: false,
      },
    };
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        {
          id: "host-remote",
          name: "builder",
          status: "connected",
          lastSeenAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      "v1.system.environment-providers.$get": vi.fn(async () => ({
        providers: [
          {
            ...provider,
            id: "ready",
            availability: { status: "available" },
            machineAvailability: { "host-remote": { status: "available" } },
          },
          {
            ...provider,
            id: "blocked",
            availability: { status: "unavailable", message: "No reflinks" },
            machineAvailability: {
              "host-remote": { status: "unavailable", message: "No reflinks" },
            },
          },
          {
            ...provider,
            id: "pending",
            availability: null,
            machineAvailability: { "host-remote": null },
          },
        ],
      })),
    });

    await runCommand(
      [
        "environment",
        "providers",
        "--project",
        "proj-1",
        "--machine",
        "builder",
      ],
      register,
    );

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "ready  Provider  -  availability: available",
      "blocked  Provider  -  availability: unavailable (No reflinks)",
      "pending  Provider  -  availability: unknown",
    ]);
  });

  it("bb environment list names the provider that produced each row", async () => {
    const list = vi.fn(async () => [
      fixtures.makeEnvironment({
        id: "env-worktree",
        projectId: "proj-1",
        hostId: "host-local",
        environmentProviderId: "git-worktree",
        path: "/tmp/worktrees/env-worktree",
      }),
      fixtures.makeEnvironment({
        id: "env-checkout",
        projectId: "proj-1",
        hostId: "host-local",
        environmentProviderId: null,
      }),
    ]);
    stubServerApi({ "v1.environments.$get": list });

    await runCommand(["environment", "list"], register);

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "env-worktree  ready  git-worktree  /tmp/worktrees/env-worktree",
      "env-checkout  ready  -  /tmp/environment",
    ]);
  });

  it.each(["--limit", "--offset"])(
    "bb environment list names invalid %s as a non-negative integer",
    async (flag) => {
      const list = vi.fn(async () => []);
      stubServerApi({ "v1.environments.$get": list });

      await expect(
        runCommand(["environment", "list", flag, "nope"], register),
      ).rejects.toThrow("process.exit:1");

      expect(collectLogLines(vi.mocked(console.error))).toContain(
        `Error: ${flag} must be a non-negative integer.`,
      );
      expect(list).not.toHaveBeenCalled();
    },
  );

  it("bb environment delete reports requested cleanup and its lifecycle", async () => {
    const remove = vi.fn(async () => ({ ok: true as const }));
    const get = vi.fn(async () =>
      fixtures.makeEnvironment({
        id: "env-delete",
        projectId: "project-delete",
        hostId: "host-delete",
        lifecycle: {
          phase: "teardown",
          retireAt: null,
          teardown: { status: "running", attempt: 1 },
        },
      }),
    );
    stubServerApi({
      "v1.environments.:id.$delete": remove,
      "v1.environments.:id.$get": get,
    });

    await runCommand(["environment", "delete", "env-delete"], register);

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Cleanup requested for environment env-delete.",
      "Lifecycle: teardown",
    ]);
  });

  it("bb environment pull-request show reports absence and presence", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "absent" })
      .mockResolvedValueOnce({ outcome: "available", pullRequest });
    stubServerApi({ "v1.environments.:id.pull-request.$get": get });

    await runCommand(
      ["environment", "pull-request", "show", "env-pr-none"],
      register,
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "No pull request found",
    );

    vi.mocked(console.log).mockClear();
    await runCommand(
      ["environment", "pull-request", "show", "env-pr-present"],
      register,
    );

    expect(get).toHaveBeenNthCalledWith(1, {
      param: { id: "env-pr-none" },
    });
    expect(get).toHaveBeenNthCalledWith(2, {
      param: { id: "env-pr-present" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual(
      expect.arrayContaining([
        "Pull request: #701 open - Environment inspection parity",
        "Branch: bb/environment-cli -> main",
        "Checks: passing (2 passed, 0 failed, 0 pending, 2 total)",
        "Auto-merge: off",
        "Merge queue: not queued",
      ]),
    );
  });

  it("bb environment pull-request show --json preserves the outcome", async () => {
    stubServerApi({
      "v1.environments.:id.pull-request.$get": vi.fn(async () => ({
        outcome: "absent",
      })),
    });

    await runCommand(
      ["environment", "pull-request", "show", "env-pr-json", "--json"],
      register,
    );

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual({ outcome: "absent" });
  });

  it("bb environment pull-request show reports a failed lookup", async () => {
    stubServerApi({
      "v1.environments.:id.pull-request.$get": vi.fn(async () => ({
        outcome: "unavailable",
        message: "gh pr view failed: authentication required",
      })),
    });

    await runCommand(
      ["environment", "pull-request", "show", "env-pr-down"],
      register,
    );

    expect(vi.mocked(console.log).mock.calls.map((call) => call[0])).toEqual([
      "Pull request lookup unavailable: gh pr view failed: authentication required",
    ]);
  });

  it("bb environment paths targets the environment and path kinds", async () => {
    const response = {
      paths: [
        {
          kind: "directory",
          path: "apps/cli",
          name: "cli",
          score: 1,
          positions: [5],
        },
      ],
      truncated: true,
    };
    const get = vi.fn(async () => response);
    stubServerApi({ "v1.environments.:id.paths.$get": get });

    await runCommand(
      [
        "environment",
        "paths",
        "env-paths-direct",
        "--query",
        "cli",
        "--directories",
        "--limit",
        "5",
      ],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      param: { id: "env-paths-direct" },
      query: {
        query: "cli",
        limit: "5",
        includeFiles: "false",
        includeDirectories: "true",
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "directory\tapps/cli",
      "(results truncated)",
    ]);
  });

  it("bb environment commit prefixes failures with environment context", async () => {
    const post = vi.fn(async () => {
      throw new Error("HTTP 500: boom");
    });
    stubServerApi({ "v1.environments.:id.actions.$post": post });

    await expect(
      runCommand(["environment", "commit", "env-1"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error))).toContain(
      "Error: Failed to commit in environment env-1: HTTP 500: boom",
    );
  });

  it("bb environment commit posts the action without a thread id", async () => {
    const post = vi.fn(async () => ({
      ok: true,
      action: "commit",
      message: "Created commit abc123",
      commitSha: "abc123",
      commitSubject: "bb: automated commit",
    }));
    stubServerApi({ "v1.environments.:id.actions.$post": post });

    await runCommand(["environment", "commit", "env-commit-1"], register);

    expect(post).toHaveBeenCalledWith({
      param: { id: "env-commit-1" },
      json: { action: "commit" },
    });
  });

  it("bb environment update sets the merge base branch", async () => {
    const environment = fixtures.makeEnvironment({
      id: "env-update-1",
      projectId: "proj-1",
      hostId: "host-1",
      mergeBaseBranch: "release",
      createdAt: 1,
      updatedAt: 2,
    });
    const patch = vi.fn(async () => environment);
    stubServerApi({ "v1.environments.:id.$patch": patch });

    await runCommand(
      [
        "environment",
        "update",
        "env-update-1",
        "--merge-base-branch",
        "release",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "env-update-1" },
      json: { mergeBaseBranch: "release" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Environment env-update-1 updated",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Merge base branch: release",
    );
  });

  it("bb environment update clears the merge base branch", async () => {
    const environment = fixtures.makeEnvironment({
      id: "env-update-2",
      projectId: "proj-1",
      hostId: "host-1",
      mergeBaseBranch: null,
      createdAt: 1,
      updatedAt: 2,
    });
    const patch = vi.fn(async () => environment);
    stubServerApi({ "v1.environments.:id.$patch": patch });

    await runCommand(
      ["environment", "update", "env-update-2", "--clear-merge-base-branch"],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "env-update-2" },
      json: { mergeBaseBranch: null },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Merge base branch cleared",
    );
  });

  it("bb environment update renames the environment", async () => {
    const environment = fixtures.makeEnvironment({
      id: "env-update-name",
      projectId: "proj-1",
      hostId: "host-1",
      name: "Review workspace",
      createdAt: 1,
      updatedAt: 2,
    });
    const patch = vi.fn(async () => environment);
    stubServerApi({ "v1.environments.:id.$patch": patch });

    await runCommand(
      [
        "environment",
        "update",
        "env-update-name",
        "--name",
        "Review workspace",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "env-update-name" },
      json: { name: "Review workspace" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Environment env-update-name updated",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Name: Review workspace",
    );
  });

  it("bb environment update clears the environment name", async () => {
    const environment = fixtures.makeEnvironment({
      id: "env-clear-name",
      projectId: "proj-1",
      hostId: "host-1",
      name: null,
      createdAt: 1,
      updatedAt: 2,
    });
    const patch = vi.fn(async () => environment);
    stubServerApi({ "v1.environments.:id.$patch": patch });

    await runCommand(
      ["environment", "update", "env-clear-name", "--clear-name"],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "env-clear-name" },
      json: { name: null },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain("Name cleared");
  });

  it("bb environment update sets name and merge base together", async () => {
    const environment = fixtures.makeEnvironment({
      id: "env-update-combined",
      projectId: "proj-1",
      hostId: "host-1",
      name: "Review workspace",
      mergeBaseBranch: "release",
      createdAt: 1,
      updatedAt: 2,
    });
    const patch = vi.fn(async () => environment);
    stubServerApi({ "v1.environments.:id.$patch": patch });

    await runCommand(
      [
        "environment",
        "update",
        "env-update-combined",
        "--name",
        "Review workspace",
        "--merge-base-branch",
        "release",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "env-update-combined" },
      json: { mergeBaseBranch: "release", name: "Review workspace" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Merge base branch: release",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Name: Review workspace",
    );
  });

  it("bb environment update rejects name and clear-name together", async () => {
    const patch = vi.fn();
    stubServerApi({ "v1.environments.:id.$patch": patch });

    await expect(
      runCommand(
        [
          "environment",
          "update",
          "env-update-name-conflict",
          "--name",
          "Review workspace",
          "--clear-name",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining("Cannot combine --name with --clear-name."),
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("bb environment update rejects an empty name", async () => {
    const patch = vi.fn();
    stubServerApi({ "v1.environments.:id.$patch": patch });

    await expect(
      runCommand(
        ["environment", "update", "env-update-empty-name", "--name", ""],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining("Environment name cannot be empty."),
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("bb environment update --json prints the updated environment", async () => {
    const environment = fixtures.makeEnvironment({
      id: "env-json-update",
      projectId: "proj-1",
      hostId: "host-1",
      mergeBaseBranch: "release",
      createdAt: 1,
      updatedAt: 2,
    });
    const patch = vi.fn(async () => environment);
    stubServerApi({ "v1.environments.:id.$patch": patch });

    await runCommand(
      [
        "environment",
        "update",
        "env-json-update",
        "--merge-base-branch",
        "release",
        "--json",
      ],
      register,
    );

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual(environment);
  });
});
