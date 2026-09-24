// bb-fork(quiet-reparent): fork-owned coverage for --no-ownership-notice
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

describe("bb thread update --no-ownership-notice", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("sends ownershipNotice false on a quiet detach", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-quiet-detach",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
    });
    const patch = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.:id.$patch": patch });

    await runCommand(
      [
        "thread",
        "update",
        "thread-quiet-detach",
        "--clear-parent-thread",
        "--no-ownership-notice",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "thread-quiet-detach" },
      json: { parentThreadId: null, ownershipNotice: false },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "No parent thread",
    );
  });

  it("sends ownershipNotice false on a quiet reparent", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-quiet-reparent",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      parentThreadId: "thread-manager-1",
      createdAt: 1,
      updatedAt: 1,
    });
    const patch = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.:id.$patch": patch });

    await runCommand(
      [
        "thread",
        "update",
        "thread-quiet-reparent",
        "--parent-thread",
        "thread-manager-1",
        "--no-ownership-notice",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "thread-quiet-reparent" },
      json: {
        parentThreadId: "thread-manager-1",
        ownershipNotice: false,
      },
    });
  });

  it("rejects --no-ownership-notice without a reparent", async () => {
    const patch = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-quiet-invalid",
        projectId: "proj-1",
        providerId: "codex",
      }),
    );
    stubServerApi({ "v1.threads.:id.$patch": patch });

    await expect(
      runCommand(
        ["thread", "update", "thread-quiet-invalid", "--no-ownership-notice"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      "Error: --no-ownership-notice requires --parent-thread or --clear-parent-thread.",
    );
    expect(patch).not.toHaveBeenCalled();
  });
});
