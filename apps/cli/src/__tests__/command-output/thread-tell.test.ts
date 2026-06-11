import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread tell command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread tell --json prints the raw response plus thread id", async () => {
    const post = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.threads.:id.send.$post": post });

    await runCommand(
      ["thread", "tell", "thread-json-tell", "hello", "--json"],
      register,
    );

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual({
      threadId: "thread-json-tell",
      ok: true,
      mode: "queue",
    });
  });

  it("bb thread tell --mode auto preserves explicit legacy auto delivery", async () => {
    const post = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.threads.:id.send.$post": post });

    await runCommand(
      ["thread", "tell", "thread-auto-tell", "hello", "--mode", "auto"],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      param: { id: "thread-auto-tell" },
      json: {
        input: [{ type: "text", text: "hello", mentions: [] }],
        mode: "auto",
      },
    });
  });

  it("bb thread tell forwards execution options", async () => {
    const post = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.threads.:id.send.$post": post });

    await runCommand(
      [
        "thread",
        "tell",
        "thread-execution-options",
        "hello",
        "--model",
        "gpt-5.5",
        "--service-tier",
        "fast",
        "--reasoning-level",
        "high",
        "--permission-mode",
        "workspace-write",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      param: { id: "thread-execution-options" },
      json: {
        input: [{ type: "text", text: "hello", mentions: [] }],
        mode: "queue-if-active",
        model: "gpt-5.5",
        serviceTier: "fast",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
      },
    });
  });

  it("bb thread tell includes sender thread metadata when run inside another thread", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-sender");
    const post = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.threads.:id.send.$post": post });

    await runCommand(
      ["thread", "tell", "thread-receiver", "hello from sender"],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      param: { id: "thread-receiver" },
      json: {
        input: [{ type: "text", text: "hello from sender", mentions: [] }],
        mode: "queue-if-active",
        senderThreadId: "thread-sender",
      },
    });
  });

  it("bb thread tell omits sender metadata when targeting the current thread", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-self");
    const post = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.threads.:id.send.$post": post });

    await runCommand(["thread", "tell", "thread-self", "self note"], register);

    expect(post).toHaveBeenCalledWith({
      param: { id: "thread-self" },
      json: {
        input: [{ type: "text", text: "self note", mentions: [] }],
        mode: "queue-if-active",
      },
    });
  });
});
