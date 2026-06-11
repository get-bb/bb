import { describe, expect, it, vi } from "vitest";
import * as domain from "@bb/domain";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  readlineMocks,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread action command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread archive sends the thread id from args", async () => {
    const archivePost = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.threads.:id.archive.$post": archivePost });

    await runCommand(["thread", "archive", "thread-archive-1"], register);

    expect(archivePost).toHaveBeenCalledWith({
      param: { id: "thread-archive-1" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-archive-1 archived",
    );
  });

  it("bb thread archive --self resolves from BB_THREAD_ID", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-archive-2");
    const archivePost = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.threads.:id.archive.$post": archivePost });

    await runCommand(["thread", "archive", "--self"], register);

    expect(archivePost).toHaveBeenCalledWith({
      param: { id: "thread-archive-2" },
    });
  });

  it("bb thread archive prefixes failures with thread context", async () => {
    const archivePost = vi.fn(async () => {
      throw new Error("HTTP 404: missing");
    });
    stubServerApi({ "v1.threads.:id.archive.$post": archivePost });

    await expect(
      runCommand(["thread", "archive", "thread-archive-1"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error))).toContain(
      "Error: Failed to archive thread thread-archive-1: HTTP 404: missing",
    );
    expect(archivePost).toHaveBeenCalledWith({
      param: { id: "thread-archive-1" },
    });
  });

  it("bb thread unarchive --self resolves from BB_THREAD_ID", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-unarchive-1");
    const unarchivePost = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.threads.:id.unarchive.$post": unarchivePost });

    await runCommand(["thread", "unarchive", "--self"], register);

    expect(unarchivePost).toHaveBeenCalledWith({
      param: { id: "thread-unarchive-1" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-unarchive-1 unarchived",
    );
  });

  it("bb thread pin sends the thread id from args", async () => {
    const pinnedThread = fixtures.makeThread({
      id: "thread-pin-1",
      projectId: "proj-1",
      providerId: "codex",
      pinnedAt: 1,
    });
    const pinPost = vi.fn(async () => pinnedThread);
    stubServerApi({ "v1.threads.:id.pin.$post": pinPost });

    await runCommand(["thread", "pin", "thread-pin-1"], register);

    expect(pinPost).toHaveBeenCalledWith({
      param: { id: "thread-pin-1" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-pin-1 pinned",
    );
  });

  it("bb thread unpin --self resolves from BB_THREAD_ID", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-unpin-1");
    const unpinnedThread = fixtures.makeThread({
      id: "thread-unpin-1",
      projectId: "proj-1",
      providerId: "codex",
      pinnedAt: null,
    });
    const unpinPost = vi.fn(async () => unpinnedThread);
    stubServerApi({ "v1.threads.:id.unpin.$post": unpinPost });

    await runCommand(["thread", "unpin", "--self"], register);

    expect(unpinPost).toHaveBeenCalledWith({
      param: { id: "thread-unpin-1" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-unpin-1 unpinned",
    );
  });

  it("bb thread delete prompts before deleting", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-delete-1",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      title: "Delete me",
      createdAt: 1,
      updatedAt: 1,
    });
    const get = vi.fn(async () => thread);
    const deleteFn = vi.fn(async () => ({ ok: true }));
    stubServerApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.$delete": deleteFn,
    });
    readlineMocks.question.mockResolvedValue("yes");

    await runCommand(["thread", "delete", "thread-delete-1"], register);

    expect(get).toHaveBeenCalledWith({
      param: { id: "thread-delete-1" },
    });
    expect(deleteFn).toHaveBeenCalledWith({
      param: { id: "thread-delete-1" },
      json: { childThreadsConfirmed: false },
    });
    expect(readlineMocks.question).toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-delete-1 deleted",
    );
  });

  it("bb thread delete cancels when confirmation is declined", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-delete-2",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
    });
    const get = vi.fn(async () => thread);
    const deleteFn = vi.fn(async () => ({ ok: true }));
    stubServerApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.$delete": deleteFn,
    });
    readlineMocks.question.mockResolvedValue("no");

    await runCommand(["thread", "delete", "thread-delete-2"], register);

    expect(deleteFn).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-delete-2 deletion cancelled",
    );
  });

  it("bb thread delete --yes skips confirmation (requires explicit id)", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-delete-3",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
    });
    const get = vi.fn(async () => thread);
    const deleteFn = vi.fn(async () => ({ ok: true }));
    stubServerApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.$delete": deleteFn,
    });

    await runCommand(
      ["thread", "delete", "thread-delete-3", "--yes"],
      register,
    );

    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalledWith({
      param: { id: "thread-delete-3" },
      json: { childThreadsConfirmed: false },
    });
  });

  it("bb thread delete forwards explicit child-thread confirmation", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-delete-children",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
    });
    const get = vi.fn(async () => thread);
    const deleteFn = vi.fn(async () => ({ ok: true }));
    stubServerApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.$delete": deleteFn,
    });

    await runCommand(
      [
        "thread",
        "delete",
        "thread-delete-children",
        "--yes",
        "--confirm-child-threads",
      ],
      register,
    );

    expect(deleteFn).toHaveBeenCalledWith({
      param: { id: "thread-delete-children" },
      json: { childThreadsConfirmed: true },
    });
  });

  it("bb thread stop lets the server no-op when the thread is already idle", async () => {
    const get = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-stop-idle",
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    const stopPost = vi.fn(async () => ({ ok: true }));
    stubServerApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.stop.$post": stopPost,
    });

    await runCommand(["thread", "stop", "thread-stop-idle"], register);

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-stop-idle stopped",
    );
    expect(get).not.toHaveBeenCalled();
    expect(stopPost).toHaveBeenCalledTimes(1);
  });

  it("bb thread stop lets the server no-op when the thread is in error", async () => {
    const get = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-stop-error",
        projectId: "proj-1",
        providerId: "codex",
        status: "error",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    const stopPost = vi.fn(async () => ({ ok: true }));
    stubServerApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.stop.$post": stopPost,
    });

    await runCommand(["thread", "stop", "thread-stop-error"], register);

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-stop-error stopped",
    );
    expect(get).not.toHaveBeenCalled();
    expect(stopPost).toHaveBeenCalledTimes(1);
  });

  it("bb thread stop still stops active threads", async () => {
    const get = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-stop-active",
        projectId: "proj-1",
        providerId: "codex",
        status: "active",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    const stopPost = vi.fn(async () => ({ ok: true }));
    stubServerApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.stop.$post": stopPost,
    });

    await runCommand(["thread", "stop", "thread-stop-active"], register);

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-stop-active stopped",
    );
    expect(stopPost).toHaveBeenCalledTimes(1);
  });
});
