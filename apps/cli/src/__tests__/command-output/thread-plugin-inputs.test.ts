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
        'model-router={"entry":"fast"}',
        "--plugin-input",
        "concurrency-limit=true",
      ],
      register,
    );

    expect(post.mock.calls[0][0].json.pluginInputs).toEqual({
      "model-router": { entry: "fast" },
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
        'model-router={"entry":"fast"}',
        "--plugin-input",
        'model-router={"entry":"deep"}',
      ],
      register,
    );

    expect(post.mock.calls[0][0].json.pluginInputs).toEqual({
      "model-router": { entry: "deep" },
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
          "model-router=fast",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(post).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(
      "Invalid --plugin-input JSON for 'model-router'",
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

describe("bb thread spawn --provider auto:", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  // The router convention: no providerId at all (the plugin's thread.create
  // gate amends one in) plus the chosen picker entry addressed to that plugin.
  it("maps auto:<pluginId>:<entryId> to an omitted providerId and an entry plugin input", async () => {
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
        "--provider",
        "auto:model-router:fast",
      ],
      register,
    );

    expect(post.mock.calls[0][0].json).not.toHaveProperty("providerId");
    expect(post.mock.calls[0][0].json.pluginInputs).toEqual({
      "model-router": { entry: "fast" },
    });
  });

  it("defaults a bare auto:<pluginId> to the plugin's default entry", async () => {
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
        "--provider",
        "auto:model-router",
      ],
      register,
    );

    expect(post.mock.calls[0][0].json.pluginInputs).toEqual({
      "model-router": { entry: "default" },
    });
  });

  it("lets an explicit --plugin-input override the entry the auto form seeds", async () => {
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
        "--provider",
        "auto:model-router",
        "--plugin-input",
        'model-router={"entry":"fast","budget":2}',
      ],
      register,
    );

    expect(post.mock.calls[0][0].json.pluginInputs).toEqual({
      "model-router": { entry: "fast", budget: 2 },
    });
  });

  // A plain provider id keeps today's behavior byte-for-byte: providerId is
  // sent and no plugin input appears.
  it("leaves a plain --provider untouched", async () => {
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
        "--provider",
        "codex",
      ],
      register,
    );

    expect(post.mock.calls[0][0].json.providerId).toBe("codex");
    expect(post.mock.calls[0][0].json).not.toHaveProperty("pluginInputs");
  });

  it("rejects an auto: value with no plugin id before creating anything", async () => {
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
          "--provider",
          "auto:",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(post).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(
      "Expected auto:<pluginId>[:<entryId>]",
    );
  });
});
