import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import { promptTextInput } from "./test/prompt-input.js";
import { UNSOLICITED_TURN_THREAD_ID_ENV } from "./test/bridges/unsolicited-turn-bridge.js";
import {
  createScriptedEchoLaunch,
  createScriptedEchoRequestRecord,
  createScriptedEchoRuntime,
  fullRuntimeOptions,
  scriptedEchoProcessEnv,
  wait,
  waitForRuntimeThreadEvent,
  waitForThreadAgentMessageText,
  waitForThreadTurnCompleted,
  waitForThreadTurnStarted,
  type CreateScriptedEchoLaunchOptions,
  type ScriptedEchoRequestRecord,
} from "./test/runtime-test-harness.js";
import type { AgentRuntime } from "./types.js";

interface CreateContractRuntimeArgs {
  additionalWorkspaceWriteRoots?: readonly string[];
  /** Merged over the request record's env (process-level scripted options). */
  env?: Record<string, string>;
  launch?: CreateScriptedEchoLaunchOptions;
  onEvent?: (event: ThreadEvent) => void;
  onStderr?: (line: string) => void;
}

interface ContractRuntime {
  record: ScriptedEchoRequestRecord;
  runtime: AgentRuntime;
}

const missingProviderThreadId = "t-missing";
const missingProviderThreadIdError =
  /No provider thread id available for t-missing/;
const acpLaunchSpec: HostDaemonAcpLaunchSpec = {
  displayName: "Custom ACP",
  command: "custom-agent",
  args: ["serve"],
  env: { CUSTOM_AGENT_TOKEN: "token" },
};
const unsolicitedTurnBridgeModulePath = fileURLToPath(
  new URL("./test/bridges/unsolicited-turn-bridge.ts", import.meta.url),
);
const codexEmptyRolloutRenameError =
  "failed to set thread name: rollout at /tmp/new-rollout.jsonl is empty";

async function registerThreadWithoutProviderThreadId(
  runtime: AgentRuntime,
): Promise<void> {
  await expect(
    runtime.resumeThread({
      environmentId: "env-1",
      threadId: missingProviderThreadId,
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    }),
  ).rejects.toThrow(missingProviderThreadIdError);
}

describe("createAgentRuntime command contracts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createContractRuntime(
    args: CreateContractRuntimeArgs = {},
  ): ContractRuntime {
    const record = createScriptedEchoRequestRecord();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        env: { ...record.env, ...args.env },
        ...(args.additionalWorkspaceWriteRoots !== undefined
          ? {
              additionalWorkspaceWriteRoots: args.additionalWorkspaceWriteRoots,
            }
          : {}),
        onEvent: args.onEvent ?? (() => {}),
        ...(args.onStderr !== undefined ? { onStderr: args.onStderr } : {}),
        onToolCall: async () => ({
          contentItems: [{ type: "inputText", text: "ok" }],
          success: true,
        }),
      },
      ...(args.launch !== undefined ? { launch: args.launch } : {}),
    });
    return { record, runtime };
  }

  it("passes runtime workspace-write roots to the provider as provider options", async () => {
    const additionalWorkspaceWriteRoots = [
      "/repo/.git/worktrees/bb13",
      "/repo/.git/objects",
    ];
    const { record, runtime } = createContractRuntime({
      additionalWorkspaceWriteRoots,
    });

    try {
      await runtime.listModels({ providerId: "fake" });
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      // Model listing has no session, so the roots ride the request itself;
      // session construction carries them in the wire options.
      expect(record.last("model/list")?.params).toEqual({
        providerOptions: { additionalWorkspaceWriteRoots },
      });
      expect(record.last("thread/start")?.params).toMatchObject({
        threadId: "t1",
        cwd: tmpDir,
        options: { providerOptions: { additionalWorkspaceWriteRoots } },
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("passes acp launch specs to the provider for model list, start, and resume", async () => {
    const { record, runtime } = createContractRuntime();

    try {
      await runtime.listModels({ providerId: "acp-custom", acpLaunchSpec });
      await runtime.startThread({
        acpLaunchSpec,
        environmentId: "env-1",
        threadId: "t-start",
        projectId: "p1",
        providerId: "acp-custom",
        options: fullRuntimeOptions,
      });
      await runtime.resumeThread({
        acpLaunchSpec,
        environmentId: "env-1",
        threadId: "t-resume",
        projectId: "p1",
        providerThreadId: "provider-resume",
        providerId: "acp-custom",
        options: fullRuntimeOptions,
      });

      expect(record.last("model/list")?.params).toEqual({
        providerOptions: { acpLaunchSpec },
      });
      expect(record.last("thread/start")?.params).toMatchObject({
        threadId: "t-start",
        options: { providerOptions: { acpLaunchSpec } },
      });
      expect(record.last("thread/resume")?.params).toMatchObject({
        threadId: "t-resume",
        providerThreadId: "provider-resume",
        options: { providerOptions: { acpLaunchSpec } },
      });
    } finally {
      await runtime.shutdown();
    }
  });

  // Archive/unarchive spawn the provider themselves (there is no thread in
  // the runtime to borrow a launch from), so they only resolve if the
  // caller's bridge launch reaches the spawn.
  it("launches the caller's bridge for archive and unarchive", async () => {
    const { record, runtime } = createContractRuntime();
    const bridgeLaunch = createScriptedEchoLaunch({
      pluginId: "provider-graduated",
    });

    try {
      await expect(
        runtime.archiveThread({
          threadId: "t-archive-bridge",
          providerId: "graduated",
          providerThreadId: "provider-explicit",
        }),
      ).rejects.toThrow(/no provider bridge launch was supplied/);

      await runtime.archiveThread({
        bridgeLaunch,
        threadId: "t-archive-bridge",
        providerId: "graduated",
        providerThreadId: "provider-explicit",
      });
      await runtime.unarchiveThread({
        bridgeLaunch,
        threadId: "t-archive-bridge",
        providerId: "graduated",
        providerThreadId: "provider-explicit",
      });

      const requests = record.read();
      // One bridge process served both commands.
      expect(
        requests.filter((entry) => entry.method === "initialize"),
      ).toHaveLength(1);
      expect(requests).toContainEqual({
        method: "thread/archive",
        params: {
          threadId: "t-archive-bridge",
          providerThreadId: "provider-explicit",
        },
      });
      expect(requests).toContainEqual({
        method: "thread/unarchive",
        params: {
          threadId: "t-archive-bridge",
          providerThreadId: "provider-explicit",
        },
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("uses a new provider process cache entry when the acp launch spec changes", async () => {
    const { record, runtime } = createContractRuntime();

    try {
      await runtime.listModels({
        providerId: "acp-custom",
        acpLaunchSpec: {
          ...acpLaunchSpec,
          env: { CACHE_MARKER: "first" },
        },
      });
      await runtime.listModels({
        providerId: "acp-custom",
        acpLaunchSpec: {
          ...acpLaunchSpec,
          env: { CACHE_MARKER: "second" },
        },
      });

      const requests = record.read();
      // Two handshakes: each launch spec got its own bridge process.
      expect(
        requests.filter((entry) => entry.method === "initialize"),
      ).toHaveLength(2);
      expect(
        requests
          .filter((entry) => entry.method === "model/list")
          .map((entry) => entry.params),
      ).toEqual([
        {
          providerOptions: {
            acpLaunchSpec: { ...acpLaunchSpec, env: { CACHE_MARKER: "first" } },
          },
        },
        {
          providerOptions: {
            acpLaunchSpec: {
              ...acpLaunchSpec,
              env: { CACHE_MARKER: "second" },
            },
          },
        },
      ]);
    } finally {
      await runtime.shutdown();
    }
  }, 30000);

  it("prefixes provider rename titles and normalizes provider title events", async () => {
    const events: ThreadEvent[] = [];
    const { record, runtime } = createContractRuntime({
      onEvent: (event) => events.push(event),
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      await runtime.renameThread({ threadId: "t1", title: "New Title" });
      // The bridge echoes the title it was given as a `thread.name` delta.
      await waitForRuntimeThreadEvent({
        events,
        label: "normalized provider title event",
        predicate: (event) =>
          event.type === "thread/name/updated" &&
          event.threadId === "t1" &&
          event.threadName === "New Title",
        runtime,
        threadId: "t1",
      });

      expect(record.last("thread/name/set")?.params).toEqual({
        threadId: "t1",
        providerThreadId: "prov-1",
        title: "[bb] New Title",
      });
      expect(events).not.toContainEqual(
        expect.objectContaining({
          threadName: "[bb] New Title",
          type: "thread/name/updated",
        }),
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("retries a Codex rename while its new rollout file is still empty", async () => {
    const stderr: string[] = [];
    const { record, runtime } = createContractRuntime({
      onStderr: (line) => stderr.push(line),
      launch: {
        scripted: {
          failMethods: [
            {
              method: "thread/name/set",
              message: codexEmptyRolloutRenameError,
              times: 1,
            },
          ],
        },
      },
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      await runtime.renameThread({ threadId: "t1", title: "New Title" });

      const renameRequests = record
        .read()
        .filter((entry) => entry.method === "thread/name/set");
      expect(renameRequests).toHaveLength(2);
      expect(renameRequests.map((entry) => entry.params?.title)).toEqual([
        "[bb] New Title",
        "[bb] New Title",
      ]);
      expect(stderr).toContainEqual(
        expect.stringContaining('retrying rename for thread "t1"'),
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("stops retrying a Codex rename once its rollout stays empty", async () => {
    const { record, runtime } = createContractRuntime({
      launch: {
        scripted: {
          failMethods: [
            {
              method: "thread/name/set",
              message: codexEmptyRolloutRenameError,
            },
          ],
        },
      },
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });

      await expect(
        runtime.renameThread({ threadId: "t1", title: "New Title" }),
      ).rejects.toThrow(/rollout at .+ is empty/i);
      expect(
        record.read().filter((entry) => entry.method === "thread/name/set"),
      ).toHaveLength(3);
    } finally {
      await runtime.shutdown();
    }
  });

  // Two Codex tests lived here: one pinning that git writable roots captured
  // at thread/start survive into a later turn/start sandbox policy, and one
  // pinning that automatic review stays on-request for agent-initiated
  // commands. Both drove the legacy codex adapter as a scriptable double and
  // asserted on the params it planned. With that adapter graduated, the codex
  // bridge builds those params in its own process, so the invariants are
  // module-owned rather than runtime-owned: the roots handoff is pinned in
  // codex/translator.test.ts and the review mapping in
  // codex/session-params.test.ts.

  it("rejects unsupported thread rename instead of silently succeeding", async () => {
    const { record, runtime } = createContractRuntime({
      launch: { capabilities: { supportsThreadRename: false } },
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      await expect(
        runtime.renameThread({ threadId: "t1", title: "New Title" }),
      ).rejects.toThrow(/does not support thread rename/);
      expect(record.last("thread/name/set")).toBeUndefined();
    } finally {
      await runtime.shutdown();
    }
  });

  it.each([
    { reportedCleared: true, label: "confirms success" },
    { reportedCleared: false, label: "reconciles a stale failure" },
  ])(
    // The runtime settles `clearThreadGoal` on the provider's
    // `thread.goalCleared` DELTA, not on the response — a provider can
    // answer the request before it has persisted the clear. A runtime-ordering
    // invariant, not a codex one, so it runs on the scripted echo provider.
    "$label after a provider persists a delayed Goal clear",
    async ({ reportedCleared }) => {
      const events: ThreadEvent[] = [];
      const { record, runtime } = createContractRuntime({
        onEvent: (event) => events.push(event),
        launch: {
          scripted: {
            goalClearNotifyDelayMs: 600,
            goalClearReportsCleared: reportedCleared,
          },
        },
      });

      try {
        await runtime.startThread({
          environmentId: "env-1",
          threadId: "t-goal",
          projectId: "p1",
          providerId: "fake",
          options: fullRuntimeOptions,
        });
        let settled = false;
        const clearPromise = runtime.clearThreadGoal({
          threadId: "t-goal",
        });
        void clearPromise.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );

        // The bridge answered as soon as it recorded the request; the clear
        // must stay open until the delayed delta lands.
        await vi.waitFor(() => {
          expect(record.last("thread/goal/clear")).toBeDefined();
        });
        await wait(100);
        expect(settled).toBe(false);

        await expect(clearPromise).resolves.toEqual({ cleared: true });
        expect(events).toContainEqual(
          expect.objectContaining({
            threadId: "t-goal",
            type: "thread/extensionState/updated",
            kind: "provider-codex/goal",
            payload: null,
          }),
        );
      } finally {
        await runtime.shutdown();
      }
    },
    10_000,
  );

  it("rejects thread resume when providerThreadId cannot be resolved", async () => {
    const { record, runtime } = createContractRuntime();

    await registerThreadWithoutProviderThreadId(runtime);
    expect(record.last("thread/resume")).toBeUndefined();
    await runtime.shutdown();
  });

  it("rejects turn start when providerThreadId cannot be resolved", async () => {
    const { record, runtime } = createContractRuntime();

    await registerThreadWithoutProviderThreadId(runtime);
    await expect(
      runtime.runTurn({
        clientRequestId: "creq_222222224t",
        threadId: missingProviderThreadId,
        input: [promptTextInput({ text: "hello" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(missingProviderThreadIdError);
    expect(record.last("turn/start")).toBeUndefined();
    await runtime.shutdown();
  });

  it("rejects thread rename when providerThreadId cannot be resolved", async () => {
    const { record, runtime } = createContractRuntime();

    await registerThreadWithoutProviderThreadId(runtime);
    await expect(
      runtime.renameThread({
        threadId: missingProviderThreadId,
        title: "New Title",
      }),
    ).rejects.toThrow(missingProviderThreadIdError);
    expect(record.last("thread/name/set")).toBeUndefined();
    await runtime.shutdown();
  });

  it("archives threads using caller-provided provider ids without runtime registry state", async () => {
    const { record, runtime } = createContractRuntime();

    await runtime.archiveThread({
      bridgeLaunch: createScriptedEchoLaunch(),
      threadId: "t-archive",
      providerId: "fake",
      providerThreadId: "provider-explicit",
    });
    expect(record.last("thread/archive")?.params).toEqual({
      threadId: "t-archive",
      providerThreadId: "provider-explicit",
    });
    await runtime.shutdown();
  });

  it("unarchives threads using caller-provided provider ids without runtime registry state", async () => {
    const { record, runtime } = createContractRuntime();

    await runtime.unarchiveThread({
      bridgeLaunch: createScriptedEchoLaunch(),
      threadId: "t-unarchive",
      providerId: "fake",
      providerThreadId: "provider-explicit",
    });
    expect(record.last("thread/unarchive")?.params).toEqual({
      threadId: "t-unarchive",
      providerThreadId: "provider-explicit",
    });
    await runtime.shutdown();
  });

  it("accepts Codex duplicate archive and unarchive state errors", async () => {
    // Archive/unarchive carry no session options, so the failures are
    // process-level.
    const { record, runtime } = createContractRuntime({
      env: scriptedEchoProcessEnv({
        failMethods: [
          {
            method: "thread/archive",
            message: "no rollout found for thread id provider-explicit",
          },
          {
            method: "thread/unarchive",
            message:
              "no archived rollout found for thread id provider-explicit",
          },
        ],
      }),
    });
    const bridgeLaunch = createScriptedEchoLaunch();

    await runtime.archiveThread({
      bridgeLaunch,
      threadId: "t-archive-idempotency",
      providerId: "fake",
      providerThreadId: "provider-explicit",
    });
    await runtime.unarchiveThread({
      bridgeLaunch,
      threadId: "t-archive-idempotency",
      providerId: "fake",
      providerThreadId: "provider-explicit",
    });
    expect(record.last("thread/archive")).toBeDefined();
    expect(record.last("thread/unarchive")).toBeDefined();
    await runtime.shutdown();
  });

  function createArchivedSessionRuntime(
    args: {
      env?: Record<string, string>;
      exitAfterArchivedError?: boolean;
      onEvent?: (event: ThreadEvent) => void;
    } = {},
  ): ContractRuntime {
    return createContractRuntime({
      ...(args.env !== undefined ? { env: args.env } : {}),
      ...(args.onEvent !== undefined ? { onEvent: args.onEvent } : {}),
      launch: {
        scripted: {
          archivedSession: true,
          ...(args.exitAfterArchivedError === true
            ? { exitAfterArchivedError: true }
            : {}),
        },
      },
    });
  }

  it("unarchives Codex sessions before retrying a turn", async () => {
    const events: ThreadEvent[] = [];
    const { record, runtime } = createArchivedSessionRuntime({
      onEvent: (event) => events.push(event),
    });

    try {
      const { providerThreadId } = await runtime.startThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: "codex",
        threadId: "t-archived",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222224u",
        input: [promptTextInput({ text: "continue" })],
        options: fullRuntimeOptions,
        threadId: "t-archived",
      });

      const requests = record.read();
      expect(requests).toContainEqual({
        method: "thread/unarchive",
        params: { threadId: "t-archived", providerThreadId },
      });
      // The rejected dispatch, then the retry after the unarchive.
      expect(
        requests.filter((entry) => entry.method === "turn/start"),
      ).toHaveLength(2);
      await waitForThreadAgentMessageText({
        events,
        providerId: "codex",
        runtime,
        text: "Response to: continue",
        threadId: "t-archived",
      });
    } finally {
      await runtime.shutdown();
    }
  });

  // The bridge keys its archived set on the exact provider thread id it was
  // asked to unarchive, so a call that succeeds proves bb unarchived the
  // right session before it retried.
  it("unarchives Codex sessions before retrying a resume", async () => {
    const { record, runtime } = createArchivedSessionRuntime();

    try {
      await expect(
        runtime.resumeThread({
          environmentId: "env-1",
          projectId: "p1",
          providerId: "codex",
          providerThreadId: "prov-archived-resume",
          threadId: "t-archived-resume",
          options: fullRuntimeOptions,
        }),
      ).resolves.toEqual({ providerThreadId: "prov-archived-resume" });

      const requests = record.read();
      expect(requests).toContainEqual({
        method: "thread/unarchive",
        params: {
          threadId: "t-archived-resume",
          providerThreadId: "prov-archived-resume",
        },
      });
      expect(
        requests.filter((entry) => entry.method === "thread/resume"),
      ).toHaveLength(2);
    } finally {
      await runtime.shutdown();
    }
  });

  it("unarchives an archived Codex source session before retrying a fork", async () => {
    const { record, runtime } = createArchivedSessionRuntime();

    try {
      await runtime.startThread({
        environmentId: "env-1",
        fork: { sourceProviderThreadId: "prov-archived-source" },
        projectId: "p1",
        providerId: "codex",
        threadId: "t-archived-fork",
        options: fullRuntimeOptions,
      });

      const requests = record.read();
      expect(requests).toContainEqual({
        method: "thread/unarchive",
        params: {
          threadId: "t-archived-fork",
          providerThreadId: "prov-archived-source",
        },
      });
      expect(
        requests.filter((entry) => entry.method === "thread/fork"),
      ).toHaveLength(2);
    } finally {
      await runtime.shutdown();
    }
  });

  it("reports the archived-session error when unarchiving fails", async () => {
    // The recovery unarchive runs before any session exists on the process,
    // so the failure is scripted process-wide.
    const { record, runtime } = createArchivedSessionRuntime({
      env: scriptedEchoProcessEnv({ unarchiveFails: true }),
    });

    try {
      await expect(
        runtime.resumeThread({
          environmentId: "env-1",
          projectId: "p1",
          providerId: "codex",
          providerThreadId: "prov-unarchive-fails",
          threadId: "t-unarchive-fails",
          options: fullRuntimeOptions,
        }),
      ).rejects.toThrow(/session prov-unarchive-fails is archived/);
      const requests = record.read();
      expect(requests).toContainEqual({
        method: "thread/unarchive",
        params: {
          threadId: "t-unarchive-fails",
          providerThreadId: "prov-unarchive-fails",
        },
      });
      // No retry without a successful unarchive.
      expect(
        requests.filter((entry) => entry.method === "thread/resume"),
      ).toHaveLength(1);
    } finally {
      await runtime.shutdown();
    }
  });

  // A provider that dies while bb recovers cannot be unarchived or retried.
  // The caller must still get the archived-session error, because it names the
  // session and the CLI command that fixes it. A process-level error such as
  // `Provider "codex" has exited` tells the user nothing actionable.
  it("keeps the archived-session error when the provider exits mid-recovery", async () => {
    const { runtime } = createArchivedSessionRuntime({
      exitAfterArchivedError: true,
    });

    try {
      await expect(
        runtime.resumeThread({
          environmentId: "env-1",
          projectId: "p1",
          providerId: "codex",
          providerThreadId: "prov-exit-recovery",
          threadId: "t-exit-recovery",
          options: fullRuntimeOptions,
        }),
      ).rejects.toThrow(/session prov-exit-recovery is archived/);
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects turn steer when providerThreadId cannot be resolved", async () => {
    const events: ThreadEvent[] = [];
    // A bridge that reports a turn on a thread it never identified, so the
    // thread has an active turn and no provider thread id.
    const { runtime } = createContractRuntime({
      onEvent: (event) => events.push(event),
      env: { [UNSOLICITED_TURN_THREAD_ID_ENV]: missingProviderThreadId },
      launch: {
        modulePath: unsolicitedTurnBridgeModulePath,
        pluginId: "provider-unsolicited-turn",
      },
    });

    await registerThreadWithoutProviderThreadId(runtime);
    const { turnId } = await waitForThreadTurnStarted({
      events,
      label: "synthetic active turn without provider identity",
      providerId: "fake",
      runtime,
      threadId: missingProviderThreadId,
      timeoutMs: 1000,
    });
    expect(runtime.getActiveTurnId(missingProviderThreadId)).toBe(turnId);
    await expect(
      runtime.steerTurn({
        clientRequestId: "creq_222222224u",
        threadId: missingProviderThreadId,
        expectedTurnId: turnId,
        input: [promptTextInput({ text: "steer" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(missingProviderThreadIdError);
    await runtime.shutdown();
  });

  it("rejects unsupported execution options before they reach the provider", async () => {
    const { record, runtime } = createContractRuntime();

    await expect(
      runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: {
          ...fullRuntimeOptions,
          serviceTier: "fast",
        },
      }),
    ).rejects.toThrow(/does not support service tiers/);
    expect(record.last("thread/start")).toBeUndefined();
    await runtime.shutdown();
  });

  it("interrupts an active turn on stop and releases an idle thread", async () => {
    const events: ThreadEvent[] = [];
    const { record, runtime } = createContractRuntime({
      onEvent: (event) => events.push(event),
    });

    const startResult = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await expect(runtime.stopThread({ threadId: "t1" })).resolves.toEqual({
      providerCheckpointId: null,
    });
    expect(record.last("thread/stop")?.params).toEqual({
      threadId: "t1",
      providerThreadId: startResult.providerThreadId,
      intent: "release",
      activeTurnId: null,
    });

    // An idle stop removes the thread from the runtime, so the follow-up
    // turn resumes the provider session first.
    expect(runtime.hasThread("t1")).toBe(false);
    await runtime.resumeThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerThreadId: startResult.providerThreadId,
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_222222224v",
      threadId: "t1",
      input: [promptTextInput({ text: "delay:500" })],
      options: fullRuntimeOptions,
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
    });
    await runtime.stopThread({ threadId: "t1" });
    // The stop names the provider's own turn id, not the assembler's.
    expect(record.last("thread/stop")?.params).toEqual({
      threadId: "t1",
      providerThreadId: startResult.providerThreadId,
      intent: "interrupt",
      activeTurnId: "turn-1",
    });
    await waitForThreadTurnCompleted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
      turnId,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        threadId: "t1",
        status: "interrupted",
      }),
    );

    await runtime.shutdown();
  });
});
