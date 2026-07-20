import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread fork command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("creates an idle isolated fork by default", async () => {
    const thread = fixtures.makeThread({
      id: "thread-fork-idle",
      originKind: "fork",
      projectId: "proj-1",
      providerId: "codex",
      sourceThreadId: "thread-source",
      status: "starting",
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.fork.$post": post });

    await runCommand(["thread", "fork", "thread-source"], register);

    expect(post).toHaveBeenCalledWith({
      json: {
        sourceThreadId: "thread-source",
        origin: "cli",
        workspace: "isolated",
        visibility: "visible",
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread forked: thread-fork-idle",
    );
  });

  it("forwards input, seed, fork point, permissions, visibility, and workspace", async () => {
    const thread = fixtures.makeThread({
      id: "thread-fork-input",
      originKind: "fork",
      projectId: "proj-1",
      providerId: "codex",
      sourceThreadId: "thread-source",
      visibility: "hidden",
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.fork.$post": post });

    await runCommand(
      [
        "thread",
        "fork",
        "thread-source",
        "--prompt",
        "Continue here",
        "--agent-context-seed",
        "Reply anchor",
        "--source-seq-end",
        "42",
        "--permission-mode",
        "accept-edits",
        "--visibility",
        "hidden",
        "--workspace",
        "reuse",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: expect.objectContaining({
        sourceThreadId: "thread-source",
        sourceSeqEnd: 42,
        input: [{ type: "text", text: "Continue here", mentions: [] }],
        agentContextSeed: [
          {
            type: "text",
            text: "Reply anchor",
            mentions: [],
            visibility: "agent-only",
          },
        ],
        origin: "cli",
        permissionMode: "accept-edits",
        visibility: "hidden",
        workspace: "reuse",
      }),
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Visibility: hidden",
    );
  });
});
