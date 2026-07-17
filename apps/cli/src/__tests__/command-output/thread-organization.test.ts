import { describe, expect, it, vi } from "vitest";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread organization commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("creates a named thread folder", async () => {
    const create = vi.fn(async () => ({
      id: "folder-review",
      name: "Review",
      createdAt: 1,
      updatedAt: 1,
    }));
    stubServerApi({ "v1.thread-folders.$post": create });

    await runCommand(["thread", "folder", "create", "Review"], register);

    expect(create).toHaveBeenCalledWith({ json: { name: "Review" } });
  });

  it("creates an explicitly queued message", async () => {
    const create = vi.fn(async () => ({
      id: "queued-1",
      threadId: "thread-1",
      position: 1,
      groupBoundary: false,
      payload: {
        input: [{ type: "text", text: "next task", mentions: [] }],
      },
      createdAt: 1,
      updatedAt: 1,
    }));
    stubServerApi({ "v1.threads.:id.queued-messages.$post": create });

    await runCommand(
      ["thread", "queue", "create", "thread-1", "next task"],
      register,
    );

    expect(create).toHaveBeenCalledWith({
      param: { id: "thread-1" },
      json: {
        input: [{ type: "text", text: "next task", mentions: [] }],
      },
    });
  });

  it("updates a queued message in place", async () => {
    const update = vi.fn(async () => ({ id: "queued-1" }));
    stubServerApi({
      "v1.threads.:id.queued-messages.:queuedMessageId.$patch": update,
    });

    await runCommand(
      ["thread", "queue", "update", "thread-1", "queued-1", "revised task"],
      register,
    );

    expect(update).toHaveBeenCalledWith({
      param: { id: "thread-1", queuedMessageId: "queued-1" },
      json: {
        input: [{ type: "text", text: "revised task", mentions: [] }],
      },
    });
  });

  it("reorders pinned threads with explicit neighbors", async () => {
    const reorder = vi.fn(async () => []);
    stubServerApi({ "v1.threads.:id.pin-order.$patch": reorder });

    await runCommand(
      [
        "thread",
        "reorder-pinned",
        "thread-2",
        "--after",
        "thread-1",
        "--before",
        "thread-3",
      ],
      register,
    );

    expect(reorder).toHaveBeenCalledWith({
      param: { id: "thread-2" },
      json: {
        previousThreadId: "thread-1",
        nextThreadId: "thread-3",
      },
    });
  });
});
