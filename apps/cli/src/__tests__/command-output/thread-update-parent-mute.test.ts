// bb-fork(parent-mute): fork-owned coverage for --parent-notifications
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

describe("bb thread update --parent-notifications", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("mutes child-to-parent notifications", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-parent-mute",
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
        "thread-parent-mute",
        "--parent-notifications",
        "muted",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "thread-parent-mute" },
      json: { parentNotificationsMuted: true },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Parent notifications: muted",
    );
  });

  it("turns child-to-parent notifications back on", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-parent-unmute",
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
        "thread-parent-unmute",
        "--parent-notifications",
        "on",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "thread-parent-unmute" },
      json: { parentNotificationsMuted: false },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Parent notifications: on",
    );
  });

  it("rejects an unknown mode", async () => {
    const patch = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-parent-mute-invalid",
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
          "thread-parent-mute-invalid",
          "--parent-notifications",
          "silent",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      'Error: --parent-notifications expects muted or on, got "silent".',
    );
    expect(patch).not.toHaveBeenCalled();
  });
});
