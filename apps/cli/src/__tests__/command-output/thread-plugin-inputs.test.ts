import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

/** The two fields these tests read back off the captured create request. */
interface CreateThreadRequestBody {
  json: {
    providerId?: string;
    pluginInputs?: Record<string, unknown>;
  };
}

interface SendRequestBody {
  json: { pluginInputs?: Record<string, unknown> };
}

function spawnResponse() {
  return fixtures.makeThread({
    id: "thr_spawned",
    projectId: "proj_one",
    providerId: "codex",
    status: "starting",
    createdAt: 1,
    updatedAt: 1,
  });
}

describe("bb thread --plugin-input", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread spawn merges repeatable --plugin-input flags by plugin id", async () => {
    const post = vi.fn(async (_args: CreateThreadRequestBody) =>
      spawnResponse(),
    );
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj_one",
        "--prompt",
        "go",
        "--plugin-input",
        'my-router={"entry":"fast"}',
        "--plugin-input",
        "concurrency-limit=true",
      ],
      register,
    );

    expect(post.mock.calls[0][0].json.pluginInputs).toEqual({
      "my-router": { entry: "fast" },
      "concurrency-limit": true,
    });
  });

  // Repeating a plugin id is a replacement, not a deep merge: the gate reads
  // one value, and merging two shapes silently would be unpredictable.
  it("bb thread spawn lets a later --plugin-input replace an earlier one for the same plugin", async () => {
    const post = vi.fn(async (_args: CreateThreadRequestBody) =>
      spawnResponse(),
    );
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj_one",
        "--prompt",
        "go",
        "--plugin-input",
        'my-router={"entry":"fast"}',
        "--plugin-input",
        'my-router={"entry":"deep"}',
      ],
      register,
    );

    expect(post.mock.calls[0][0].json.pluginInputs).toEqual({
      "my-router": { entry: "deep" },
    });
  });

  it("bb thread spawn omits pluginInputs entirely when no plugin is addressed", async () => {
    const post = vi.fn(async (_args: CreateThreadRequestBody) =>
      spawnResponse(),
    );
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      ["thread", "spawn", "--project", "proj_one", "--prompt", "go"],
      register,
    );

    expect(post.mock.calls[0][0].json).not.toHaveProperty("pluginInputs");
  });

  it("bb thread spawn rejects --plugin-input with invalid JSON before creating anything", async () => {
    const post = vi.fn(async () => spawnResponse());
    stubServerApi({ "v1.threads.$post": post });

    await expect(
      runCommand(
        [
          "thread",
          "spawn",
          "--project",
          "proj_one",
          "--prompt",
          "go",
          "--plugin-input",
          "my-router=fast",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(post).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(
      "Invalid --plugin-input JSON for 'my-router'",
    );
  });

  it("bb thread spawn rejects a --plugin-input without the pluginId= prefix", async () => {
    const post = vi.fn(async () => spawnResponse());
    stubServerApi({ "v1.threads.$post": post });

    await expect(
      runCommand(
        [
          "thread",
          "spawn",
          "--project",
          "proj_one",
          "--prompt",
          "go",
          "--plugin-input",
          '{"entry":"fast"}',
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(post).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(
      "Expected <pluginId>=<json>",
    );
  });

  it("bb thread tell sends --plugin-input alongside the message", async () => {
    const post = vi.fn(async (_args: SendRequestBody) => ({
      ok: true,
      delivery: "sent",
    }));
    stubServerApi({ "v1.threads.:id.send.$post": post });

    await runCommand(
      [
        "thread",
        "tell",
        "thr_one",
        "carry on",
        "--plugin-input",
        'concurrency-limit={"pool":"batch"}',
      ],
      register,
    );

    expect(post.mock.calls[0][0].json.pluginInputs).toEqual({
      "concurrency-limit": { pool: "batch" },
    });
  });
});
