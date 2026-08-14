import { describe, expect, it, vi } from "vitest";
import type { ThreadHandoffStatus } from "@bb/server-contract";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread handoff command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  function status(
    overrides: Partial<ThreadHandoffStatus> = {},
  ): ThreadHandoffStatus {
    return {
      sourceThreadId: "thr_source",
      replacementThreadId: "thr_replacement",
      state: "provisioning",
      sourceArchived: false,
      failure: null,
      ...overrides,
    };
  }

  it("submits a fresh server handoff with execution overrides and a generated idempotency key", async () => {
    const post = vi.fn(async () => status({ state: "started" }));
    stubServerApi({ "v1.threads.handoff.$post": post });

    await runCommand(
      [
        "thread",
        "handoff",
        "thr_source",
        "--provider",
        "claudeCode",
        "--model",
        "claude-opus-5",
        "--reasoning-level",
        "high",
        "--service-tier",
        "fast",
        "--permission-mode",
        "accept-edits",
        "--continuation",
        "Finish the SDK surface.",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: {
        sourceThreadId: "thr_source",
        providerId: "claudeCode",
        model: "claude-opus-5",
        reasoningLevel: "high",
        serviceTier: "fast",
        permissionMode: "accept-edits",
        continuationText: "Finish the SDK surface.",
        archiveSource: true,
        idempotencyKey: expect.stringMatching(
          /^cli-handoff-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        origin: "cli",
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread handoff: started",
      "Source: thr_source",
      "Replacement: thr_replacement",
      "Source archived: no",
    ]);
  });

  it("defaults execution policy, preserves an explicit idempotency key, and can keep the source live", async () => {
    const post = vi.fn(async () => status({ state: "started" }));
    stubServerApi({ "v1.threads.handoff.$post": post });

    await runCommand(
      [
        "thread",
        "handoff",
        "thr_source",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
        "--idempotency-key",
        "explicit-handoff-key-123",
        "--no-archive-source",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: {
        sourceThreadId: "thr_source",
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "auto",
        archiveSource: false,
        idempotencyKey: "explicit-handoff-key-123",
        origin: "cli",
      },
    });
  });

  it("uses BB_THREAD_ID only when --self is explicit", async () => {
    vi.stubEnv("BB_THREAD_ID", "thr_self");
    const post = vi.fn(async () =>
      status({ sourceThreadId: "thr_self", state: "started" }),
    );
    stubServerApi({ "v1.threads.handoff.$post": post });

    await runCommand(
      [
        "thread",
        "handoff",
        "--self",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: expect.objectContaining({ sourceThreadId: "thr_self" }),
    });
  });

  it("waits through provisioning until the durable status is started", async () => {
    const post = vi.fn(async () => status());
    const get = vi.fn(async () =>
      status({ state: "started", sourceArchived: true }),
    );
    stubServerApi({
      "v1.threads.handoff.$post": post,
      "v1.threads.handoffs.:id.$get": get,
    });

    await runCommand(
      [
        "thread",
        "handoff",
        "thr_source",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
      ],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      param: { id: "thr_replacement" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Source archived: yes",
    );
  });

  it("prints stable JSON for the terminal handoff status", async () => {
    const terminal = status({ state: "started", sourceArchived: true });
    stubServerApi({
      "v1.threads.handoff.$post": vi.fn(async () => terminal),
    });

    await runCommand(
      [
        "thread",
        "handoff",
        "thr_source",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
        "--json",
      ],
      register,
    );

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(terminal, null, 2),
    ]);
  });

  it("makes a failed handoff clear and exits unsuccessfully", async () => {
    const failed = status({
      state: "failed",
      failure: {
        code: "provider_start_failed",
        message: "Provider did not accept the replacement turn",
      },
    });
    stubServerApi({
      "v1.threads.handoff.$post": vi.fn(async () => status()),
      "v1.threads.handoffs.:id.$get": vi.fn(async () => failed),
    });

    await expect(
      runCommand(
        [
          "thread",
          "handoff",
          "thr_source",
          "--provider",
          "codex",
          "--model",
          "gpt-5",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread handoff: failed",
      "Source: thr_source",
      "Replacement: thr_replacement",
      "Source archived: no",
      "Failure: provider_start_failed — Provider did not accept the replacement turn",
    ]);
  });

  it("rejects missing source, missing --self context, and invalid execution values before transport", async () => {
    const post = vi.fn();
    stubServerApi({ "v1.threads.handoff.$post": post });
    const args = ["--provider", "codex", "--model", "gpt-5"];

    await expect(
      runCommand(["thread", "handoff", ...args], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(["thread", "handoff", "--self", ...args], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(
        [
          "thread",
          "handoff",
          "thr_source",
          ...args,
          "--reasoning-level",
          "impossible",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(post).not.toHaveBeenCalled();
  });
});
