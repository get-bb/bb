import { describe, expect, it, vi } from "vitest";
import * as domain from "@bb/domain";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread update command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread update sets the parent thread id", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-update-1",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      parentThreadId: "thread-manager-1",
      createdAt: 1,
      updatedAt: 1,
    });
    const get = vi.fn(async () => thread);
    const patch = vi.fn(async () => thread);
    stubServerApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.$patch": patch,
    });

    await runCommand(
      [
        "thread",
        "update",
        "thread-update-1",
        "--parent-thread",
        "thread-manager-1",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "thread-update-1" },
      json: { parentThreadId: "thread-manager-1" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Parent: thread-manager-1",
    );
  });

  it("bb thread update rejects invalid parent-thread values", async () => {
    const patch = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-update-invalid-parent",
        projectId: "proj-1",
        providerId: "codex",
      }),
    );
    stubServerApi({ "v1.threads.:id.$patch": patch });

    await expect(
      runCommand(
        [
          "thread",
          "update",
          "thread-update-invalid-parent",
          "--parent-thread",
          "thread/invalid",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      'Error: Invalid ID from --parent-thread: "thread/invalid". IDs must contain only letters, digits, hyphens, and underscores.',
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("bb thread update clears the parent thread id", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-update-2");
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-update-2",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
    });
    const get = vi.fn(async () => thread);
    const patch = vi.fn(async () => thread);
    stubServerApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.$patch": patch,
    });

    await runCommand(
      ["thread", "update", "--self", "--clear-parent-thread"],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "thread-update-2" },
      json: { parentThreadId: null },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "No parent thread",
    );
  });

  it("bb thread update sets a sticky model and reasoning level override", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-update-3",
      projectId: "proj-1",
      providerId: "claude-code",
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
    });
    const get = vi.fn(async () => thread);
    const patch = vi.fn(async () => thread);
    stubServerApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.$patch": patch,
    });

    await runCommand(
      [
        "thread",
        "update",
        "thread-update-3",
        "--model",
        "claude-opus-4-8",
        "--reasoning-level",
        "high",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "thread-update-3" },
      json: { model: "claude-opus-4-8", reasoningLevel: "high" },
    });
    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines).toContain("Model: claude-opus-4-8");
    expect(lines).toContain("Reasoning level: high");
  });

  it("bb thread update sets the model override independently", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-update-4",
      projectId: "proj-1",
      providerId: "claude-code",
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
    });
    const get = vi.fn(async () => thread);
    const patch = vi.fn(async () => thread);
    stubServerApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.$patch": patch,
    });

    await runCommand(
      ["thread", "update", "thread-update-4", "--model", "claude-opus-4-8"],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "thread-update-4" },
      json: { model: "claude-opus-4-8" },
    });
  });

  it("bb thread update rejects an invalid reasoning level before calling the API", async () => {
    const patch = vi.fn();
    stubServerApi({ "v1.threads.:id.$patch": patch });

    await expect(
      runCommand(
        ["thread", "update", "thread-update-5", "--reasoning-level", "turbo"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining("Invalid reasoning level 'turbo'"),
    );
    expect(patch).not.toHaveBeenCalled();
  });
});
