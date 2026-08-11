import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import type { AdapterCommand } from "./provider-adapter.js";
import { createAgentRuntimeWithAdapters } from "./runtime.js";
import {
  createRecordingAdapter,
  fullRuntimeOptions,
} from "./test/runtime-test-harness.js";
import { fakeProviderScriptPath } from "./test/index.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("prepareThreadRewind", () => {
  it("deduplicates concurrent operation retries and suppresses staging events", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "bb-runtime-rewind-"));
    temporaryDirectories.push(workspacePath);
    const commands: AdapterCommand[] = [];
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () =>
        createRecordingAdapter({
          recordedCommands: commands,
          scriptPath: fakeProviderScriptPath,
        }),
    });
    const request = {
      environmentId: "env-1",
      threadId: "thread-1",
      leaseId: "lease-1",
      operationId: "edit-op-1",
      projectId: "project-1",
      providerId: "codex",
      sourceProviderThreadId: "provider-source-1",
      retainThroughProviderCheckpoint: "turn-before-edit",
      options: fullRuntimeOptions,
      instructionMode: "append" as const,
    };

    try {
      const results = await Promise.all([
        runtime.prepareThreadRewind(request),
        runtime.prepareThreadRewind({ ...request, leaseId: "lease-2" }),
      ]);

      expect(results[0]).toEqual(results[1]);
      expect(
        commands.filter((command) => command.type === "thread/fork"),
      ).toEqual([
        expect.objectContaining({
          sourceProviderCheckpointId: "turn-before-edit",
          sourceProviderThreadId: "provider-source-1",
        }),
      ]);
      const stagingThreadId = commands.find(
        (command) => command.type === "thread/fork",
      )?.threadId;
      expect(stagingThreadId).toMatch(/^thread-1:rewind:[a-f0-9]{64}$/);
      expect(events).toEqual([]);
      expect(runtime.hasThread(stagingThreadId!)).toBe(true);
      await expect(
        runtime.prepareThreadRewind({
          ...request,
          leaseId: "lease-3",
          retainThroughProviderCheckpoint: "different-turn",
        }),
      ).rejects.toThrow("reused with different input");
      await runtime.discardThreadRewind({
        leaseId: "lease-1",
        operationId: "edit-op-1",
        threadId: "thread-1",
      });
      expect(
        commands.filter((command) => command.type === "thread/discard"),
      ).toEqual([]);
      expect(runtime.hasThread(stagingThreadId!)).toBe(true);
      await runtime.discardThreadRewind({
        leaseId: "lease-2",
        operationId: "edit-op-1",
        threadId: "thread-1",
      });
      expect(
        commands.filter((command) => command.type === "thread/discard"),
      ).toEqual([
        expect.objectContaining({
          providerThreadId: results[0]?.providerThreadId,
          threadId: stagingThreadId,
        }),
      ]);
      expect(runtime.hasThread(stagingThreadId!)).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });

  it("retains a staged rewind when provider cleanup fails so cleanup can retry", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "bb-runtime-rewind-"));
    temporaryDirectories.push(workspacePath);
    const stderr: string[] = [];
    const commands: AdapterCommand[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath,
      onEvent: () => undefined,
      onStderr: (line) => stderr.push(line),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => {
        const adapter = createRecordingAdapter({
          recordedCommands: commands,
          scriptPath: fakeProviderScriptPath,
        });
        return {
          ...adapter,
          process: {
            ...adapter.process,
            args: [...adapter.process.args, "--discard-fails-once"],
          },
        };
      },
    });
    const request = {
      environmentId: "env-1",
      threadId: "thread-1",
      leaseId: "lease-1",
      operationId: "edit-op-retry-cleanup",
      projectId: "project-1",
      providerId: "codex",
      sourceProviderThreadId: "provider-source-1",
      retainThroughProviderCheckpoint: "turn-before-edit",
      options: fullRuntimeOptions,
      instructionMode: "append" as const,
    };

    try {
      await runtime.prepareThreadRewind(request);
      const stagingThreadId = commands.find(
        (command) => command.type === "thread/fork",
      )?.threadId;
      expect(stagingThreadId).toMatch(/^thread-1:rewind:[a-f0-9]{64}$/);
      await runtime.discardThreadRewind({
        leaseId: request.leaseId,
        operationId: request.operationId,
        threadId: request.threadId,
      });
      expect(runtime.hasThread(stagingThreadId!)).toBe(true);
      expect(stderr).toEqual([
        expect.stringContaining("discard is temporarily unavailable"),
      ]);

      await runtime.discardThreadRewind({
        leaseId: request.leaseId,
        operationId: request.operationId,
        threadId: request.threadId,
      });
      expect(runtime.hasThread(stagingThreadId!)).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });

  it("discards a staged fork when its response does not identify an adoptable provider thread", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "bb-runtime-rewind-"));
    temporaryDirectories.push(workspacePath);
    const commands: AdapterCommand[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath,
      onEvent: () => undefined,
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => {
        const adapter = createRecordingAdapter({
          recordedCommands: commands,
          scriptPath: fakeProviderScriptPath,
        });
        return {
          ...adapter,
          process: {
            ...adapter.process,
            args: [...adapter.process.args, "--thread-id-provider-identity"],
          },
        };
      },
    });
    const request = {
      environmentId: "env-1",
      threadId: "thread-1",
      leaseId: "lease-1",
      operationId: "edit-op-ambiguous-identity",
      projectId: "project-1",
      providerId: "pi",
      sourceProviderThreadId: "provider-source-1",
      retainThroughProviderCheckpoint: "turn-before-edit",
      options: fullRuntimeOptions,
      instructionMode: "append" as const,
    };
    try {
      await expect(runtime.prepareThreadRewind(request)).rejects.toThrow(
        "pi did not return a provider thread for rewind operation edit-op-ambiguous-identity",
      );
      const stagingThreadId = commands.find(
        (command) => command.type === "thread/fork",
      )?.threadId;
      expect(stagingThreadId).toMatch(/^thread-1:rewind:[a-f0-9]{64}$/);
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: "thread/discard",
          providerThreadId: stagingThreadId,
          threadId: stagingThreadId,
        }),
      );
      expect(runtime.hasThread(stagingThreadId!)).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });

  it("keeps Pi staging sessions distinct when external operation ids sanitize alike", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "bb-runtime-rewind-"));
    temporaryDirectories.push(workspacePath);
    const commands: AdapterCommand[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath,
      onEvent: () => undefined,
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () =>
        createRecordingAdapter({
          recordedCommands: commands,
          scriptPath: fakeProviderScriptPath,
        }),
    });
    const baseRequest = {
      environmentId: "env-1",
      threadId: "thread-1",
      projectId: "project-1",
      providerId: "pi",
      sourceProviderThreadId: "provider-source-1",
      options: fullRuntimeOptions,
      instructionMode: "append" as const,
    };

    try {
      await runtime.prepareThreadRewind({
        ...baseRequest,
        leaseId: "lease-slash",
        operationId: "a/b",
        retainThroughProviderCheckpoint: "checkpoint-slash",
      });
      await runtime.prepareThreadRewind({
        ...baseRequest,
        leaseId: "lease-question",
        operationId: "a?b",
        retainThroughProviderCheckpoint: "checkpoint-question",
      });

      const stagingThreadIds = commands
        .filter((command) => command.type === "thread/fork")
        .map((command) => command.threadId);
      expect(stagingThreadIds).toHaveLength(2);
      expect(new Set(stagingThreadIds).size).toBe(2);
      expect(
        new Set(
          stagingThreadIds.map((threadId) =>
            threadId.replace(/[^A-Za-z0-9._-]/g, "_"),
          ),
        ).size,
      ).toBe(2);

      await runtime.discardThreadRewind({
        leaseId: "lease-slash",
        operationId: "a/b",
        threadId: "thread-1",
      });
      await runtime.discardThreadRewind({
        leaseId: "lease-question",
        operationId: "a?b",
        threadId: "thread-1",
      });
    } finally {
      await runtime.shutdown();
    }
  });
});
