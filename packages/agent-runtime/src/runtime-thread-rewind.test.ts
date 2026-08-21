import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import {
  createScriptedEchoRequestRecord,
  createScriptedEchoRuntime,
  fullRuntimeOptions,
  type ScriptedEchoLaunchScript,
} from "./test/runtime-test-harness.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRewindRuntime(args: {
  onEvent?: (event: ThreadEvent) => void;
  onStderr?: (line: string) => void;
  scripted?: ScriptedEchoLaunchScript;
}) {
  const workspacePath = mkdtempSync(join(tmpdir(), "bb-runtime-rewind-"));
  temporaryDirectories.push(workspacePath);
  const record = createScriptedEchoRequestRecord();
  const runtime = createScriptedEchoRuntime({
    runtime: {
      workspacePath,
      env: record.env,
      onEvent: args.onEvent ?? (() => undefined),
      ...(args.onStderr !== undefined ? { onStderr: args.onStderr } : {}),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
    },
    ...(args.scripted !== undefined
      ? { launch: { scripted: args.scripted } }
      : {}),
  });
  return { record, runtime };
}

describe("prepareThreadRewind", () => {
  it("stages one independently discardable fork per lease and suppresses staging events", async () => {
    const events: ThreadEvent[] = [];
    const { record, runtime } = createRewindRuntime({
      onEvent: (event) => events.push(event),
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

      const forkRequests = record
        .read()
        .filter((entry) => entry.method === "thread/fork");
      expect(forkRequests.map((entry) => entry.params)).toEqual([
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
      // The bridge opened both staging sessions (identity + session.reset
      // deltas), none of which may reach the consumer.
      expect(events).toEqual([]);
      expect(runtime.hasThread("thread-1:rewind:lease-1")).toBe(true);
      expect(runtime.hasThread("thread-1:rewind:lease-2")).toBe(true);

      // Discarding one lease leaves the other attempt's fork untouched.
      await runtime.discardThreadRewind({ leaseId: "lease-1" });
      expect(
        record
          .read()
          .filter((entry) => entry.method === "thread/discard")
          .map((entry) => entry.params),
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
      expect(events).toEqual([]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("retains a staged rewind when provider cleanup fails so cleanup can retry", async () => {
    const stderr: string[] = [];
    const { record, runtime } = createRewindRuntime({
      onStderr: (line) => stderr.push(line),
      scripted: { discardFailsOnce: true },
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
      expect(
        record.read().filter((entry) => entry.method === "thread/discard"),
      ).toHaveLength(2);
    } finally {
      await runtime.shutdown();
    }
  });

  it("discards a staged fork when its response does not identify an adoptable provider thread", async () => {
    // The fork answers `{ threadId }` — the staging thread's own bb id, which
    // is not a provider identity the runtime may adopt.
    const { record, runtime } = createRewindRuntime({
      scripted: { answerStartWithoutIdentity: true },
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
      const requests = record.read();
      expect(requests).toContainEqual({
        method: "thread/fork",
        params: expect.objectContaining({ threadId: stagingThreadId }),
      });
      expect(requests).toContainEqual({
        method: "thread/discard",
        params: expect.objectContaining({
          providerThreadId: stagingThreadId,
          threadId: stagingThreadId,
        }),
      });
      expect(runtime.hasThread(stagingThreadId)).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });
});
