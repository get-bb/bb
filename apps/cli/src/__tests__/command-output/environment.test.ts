import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
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
