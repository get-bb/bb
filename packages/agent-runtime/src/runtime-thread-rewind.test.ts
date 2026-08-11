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
  it("stages one independently discardable fork per lease and suppresses staging events", async () => {
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
      projectId: "project-1",
      providerId: "codex",
      sourceProviderThreadId: "provider-source-1",
      retainThroughProviderCheckpoint: "turn-before-edit",
      options: fullRuntimeOptions,
      instructionMode: "append" as const,
    };

    try {
      const first = await runtime.prepareThreadRewind(request);
      // A replay of the same lease returns the staged fork without forking
      // again; a different lease stages its own independent fork.
      const replay = await runtime.prepareThreadRewind(request);
      expect(replay).toEqual(first);
      await runtime.prepareThreadRewind({ ...request, leaseId: "lease-2" });

      const forkCommands = commands.filter(
        (command) => command.type === "thread/fork",
      );
      expect(forkCommands).toEqual([
        expect.objectContaining({
          sourceProviderCheckpointId: "turn-before-edit",
          sourceProviderThreadId: "provider-source-1",
          threadId: "thread-1:rewind:lease-1",
        }),
        expect.objectContaining({
          sourceProviderCheckpointId: "turn-before-edit",
          sourceProviderThreadId: "provider-source-1",
          threadId: "thread-1:rewind:lease-2",
        }),
      ]);
      expect(events).toEqual([]);
      expect(runtime.hasThread("thread-1:rewind:lease-1")).toBe(true);
      expect(runtime.hasThread("thread-1:rewind:lease-2")).toBe(true);

      // Discarding one lease leaves the other attempt's fork untouched.
      await runtime.discardThreadRewind({ leaseId: "lease-1" });
      expect(
        commands.filter((command) => command.type === "thread/discard"),
      ).toEqual([
        expect.objectContaining({
          providerThreadId: first.providerThreadId,
          threadId: "thread-1:rewind:lease-1",
        }),
      ]);
      expect(runtime.hasThread("thread-1:rewind:lease-1")).toBe(false);
      expect(runtime.hasThread("thread-1:rewind:lease-2")).toBe(true);

      await runtime.discardThreadRewind({ leaseId: "lease-2" });
      expect(runtime.hasThread("thread-1:rewind:lease-2")).toBe(false);
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
      leaseId: "lease-retry-cleanup",
      projectId: "project-1",
      providerId: "codex",
      sourceProviderThreadId: "provider-source-1",
      retainThroughProviderCheckpoint: "turn-before-edit",
      options: fullRuntimeOptions,
      instructionMode: "append" as const,
    };

    try {
      await runtime.prepareThreadRewind(request);
      const stagingThreadId = "thread-1:rewind:lease-retry-cleanup";
      await runtime.discardThreadRewind({ leaseId: request.leaseId });
      expect(runtime.hasThread(stagingThreadId)).toBe(true);
      expect(stderr).toEqual([
        expect.stringContaining("discard is temporarily unavailable"),
      ]);

      await runtime.discardThreadRewind({ leaseId: request.leaseId });
      expect(runtime.hasThread(stagingThreadId)).toBe(false);
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
      leaseId: "lease-ambiguous-identity",
      projectId: "project-1",
      providerId: "pi",
      sourceProviderThreadId: "provider-source-1",
      retainThroughProviderCheckpoint: "turn-before-edit",
      options: fullRuntimeOptions,
      instructionMode: "append" as const,
    };
    try {
      await expect(runtime.prepareThreadRewind(request)).rejects.toThrow(
        "pi did not return a provider thread for rewind lease lease-ambiguous-identity",
      );
      const stagingThreadId = "thread-1:rewind:lease-ambiguous-identity";
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: "thread/fork",
          threadId: stagingThreadId,
        }),
      );
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: "thread/discard",
          providerThreadId: stagingThreadId,
          threadId: stagingThreadId,
        }),
      );
      expect(runtime.hasThread(stagingThreadId)).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });
});
