import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { BRIDGE_JSON_RPC_ERRORS } from "@bb/provider-bridge-protocol";
import { AgentRuntimeRecoveryError } from "./runtime.js";
import {
  createScriptedEchoLaunch,
  createScriptedEchoProcessLog,
  createScriptedEchoRequestRecord,
  createScriptedEchoRuntime,
  fullRuntimeOptions,
  wait,
  waitForRuntimeState,
  waitForThreadAgentMessageText,
  waitForThreadTurnCompleted,
  waitForThreadTurnStarted,
  type LaunchBoundAgentRuntime,
  type ScriptedEchoLaunchScript,
  scriptedEchoProcessEnv,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";
import type {
  AgentRuntime,
  AgentRuntimeProviderRecoveryHint,
} from "./types.js";

/**
 * The runtime's recovery actions, driven by the typed hints a bridge attaches
 * to a rejected request (`error.data.recovery`) or raises unsolicited
 * (`provider/recovery`). Every test runs under the provider id "fake": the
 * legacy codex-shaped text gates never fire for it, so only the typed hint
 * can make a case pass.
 */

const PROVIDER_ID = "fake";

interface RecoveryRuntime {
  events: ThreadEvent[];
  hints: AgentRuntimeProviderRecoveryHint[];
  processLog: ReturnType<typeof createScriptedEchoProcessLog>;
  record: ReturnType<typeof createScriptedEchoRequestRecord>;
  runtime: LaunchBoundAgentRuntime;
  /** The runtime's own stderr lines (deferrals, drops, restarts). */
  stderr: string[];
}

describe("runtime recovery hints", () => {
  let workspacePath: string;
  const runtimes: AgentRuntime[] = [];

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), "bb-runtime-recovery-"));
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
    rmSync(workspacePath, { recursive: true, force: true });
  });

  function createRecoveryRuntime(
    scripted: ScriptedEchoLaunchScript = {},
    /** Process-level script: what a thread-less command (model/list) sees. */
    processScript: ScriptedEchoLaunchScript = {},
  ): RecoveryRuntime {
    const events: ThreadEvent[] = [];
    const hints: AgentRuntimeProviderRecoveryHint[] = [];
    const stderr: string[] = [];
    const record = createScriptedEchoRequestRecord();
    const processLog = createScriptedEchoProcessLog();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath,
        env: {
          ...record.env,
          ...processLog.env,
          ...scriptedEchoProcessEnv(processScript),
        },
        onEvent: (event) => events.push(event),
        onProviderRecovery: (hint) => hints.push(hint),
        onStderr: (line) => stderr.push(line),
        // Two rungs, like production, in milliseconds instead of seconds.
        rateLimitRetry: { delaysMs: [20, 40] },
      },
      launch: { scripted },
    });
    runtimes.push(runtime);
    return { events, hints, processLog, record, runtime, stderr };
  }

  function countSpawns(processLog: RecoveryRuntime["processLog"]): number {
    return processLog.read().filter((line) => line.startsWith("spawn:")).length;
  }

  function resumedThreadIds(record: RecoveryRuntime["record"]): string[] {
    return record
      .read()
      .filter((entry) => entry.method === "thread/resume")
      .map((entry) => String(entry.params?.threadId));
  }

  async function startThread(
    runtime: LaunchBoundAgentRuntime,
    threadId: string,
  ): Promise<string> {
    const { providerThreadId } = await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      threadId,
      options: fullRuntimeOptions,
    });
    return providerThreadId;
  }

  function countRequests(
    record: RecoveryRuntime["record"],
    method: string,
  ): number {
    return record.read().filter((entry) => entry.method === method).length;
  }

  it("sessionArchived: unarchives the session and retries the rejected request once", async () => {
    const { events, record, runtime } = createRecoveryRuntime({
      archivedSession: true,
    });
    const providerThreadId = await startThread(runtime, "t-archived");

    await runtime.runTurn({
      clientRequestId: "creq_rcvrhint23",
      input: [promptTextInput({ text: "continue" })],
      options: fullRuntimeOptions,
      threadId: "t-archived",
    });

    expect(record.read()).toContainEqual({
      method: "thread/unarchive",
      params: { threadId: "t-archived", providerThreadId },
    });
    expect(countRequests(record, "turn/start")).toBe(2);
    await waitForThreadAgentMessageText({
      events,
      providerId: PROVIDER_ID,
      runtime,
      text: "continue",
      threadId: "t-archived",
    });
  });

  it("sessionArchived: a hint that is not retryable is reported, not retried", async () => {
    const { record, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "thread/resume",
          message: "source session is gone",
          recovery: { kind: "sessionArchived", retryable: false },
        },
      ],
    });
    await expect(
      runtime.resumeThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: PROVIDER_ID,
        providerThreadId: "prov-gone",
        threadId: "t-gone",
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow("source session is gone");
    expect(record.last("thread/unarchive")).toBeUndefined();
  });

  it("authRequired: the rejection becomes a typed auth_required error and is forwarded", async () => {
    const { hints, record, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "thread/resume",
          message: "Please run `fake login` first",
          recovery: { kind: "authRequired", retryable: false },
        },
      ],
    });
    let caught: unknown;
    try {
      await runtime.resumeThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: PROVIDER_ID,
        providerThreadId: "prov-auth",
        threadId: "t-auth",
        options: fullRuntimeOptions,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentRuntimeRecoveryError);
    const recoveryError = caught as AgentRuntimeRecoveryError;
    expect(recoveryError.code).toBe("auth_required");
    expect(recoveryError.message).toBe("Please run `fake login` first");
    expect(recoveryError.recovery).toMatchObject({
      kind: "authRequired",
      providerId: PROVIDER_ID,
      threadId: "t-auth",
    });
    // Only the rejected request went out: no unarchive, no retry.
    expect(countRequests(record, "thread/resume")).toBe(1);
    expect(record.last("thread/unarchive")).toBeUndefined();
    // Forwarded: the daemon learns the provider needs a sign-in from the
    // hint, not only from this one request's failure.
    expect(hints).toContainEqual(
      expect.objectContaining({
        kind: "authRequired",
        providerId: PROVIDER_ID,
        threadId: "t-auth",
      }),
    );
  });

  it("authRequired at the end of a rateLimited ladder: typed auth_required and forwarded", async () => {
    const { hints, record, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "turn/start",
          message: "slow down",
          times: 1,
          recovery: { kind: "rateLimited", retryable: true },
        },
        {
          method: "turn/start",
          message: "session expired, sign in again",
          recovery: { kind: "authRequired", retryable: false },
        },
      ],
    });
    await startThread(runtime, "t-ladder-auth");
    let caught: unknown;
    try {
      await runtime.runTurn({
        clientRequestId: "creq_rcvrhint2f",
        input: [promptTextInput({ text: "never" })],
        options: fullRuntimeOptions,
        threadId: "t-ladder-auth",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentRuntimeRecoveryError);
    expect((caught as AgentRuntimeRecoveryError).code).toBe("auth_required");
    expect((caught as AgentRuntimeRecoveryError).message).toBe(
      "session expired, sign in again",
    );
    // The first attempt plus the one rung that hit the auth rejection.
    expect(countRequests(record, "turn/start")).toBe(2);
    expect(hints).toContainEqual(
      expect.objectContaining({
        kind: "authRequired",
        providerId: PROVIDER_ID,
        threadId: "t-ladder-auth",
      }),
    );
  });

  // A rung that ends the ladder with another kind gets that kind's own
  // action — the same one a first rejection with it gets — never a
  // `rate_limited` error wearing the other hint's message.
  it("sessionArchived at the end of a rateLimited ladder: unarchives and retries", async () => {
    const { record, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "thread/resume",
          message: "slow down",
          times: 1,
          recovery: { kind: "rateLimited", retryable: true },
        },
        {
          method: "thread/resume",
          message: "session is archived",
          times: 1,
          recovery: { kind: "sessionArchived", retryable: true },
        },
      ],
    });
    const providerThreadId = await startThread(runtime, "t-ladder-archived");
    await runtime.stopThread({ threadId: "t-ladder-archived" });

    await expect(
      runtime.resumeThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: PROVIDER_ID,
        providerThreadId,
        threadId: "t-ladder-archived",
        options: fullRuntimeOptions,
      }),
    ).resolves.toEqual({ providerThreadId });
    expect(record.read()).toContainEqual({
      method: "thread/unarchive",
      params: { threadId: "t-ladder-archived", providerThreadId },
    });
    // The first attempt, the rung that found the session archived, and the
    // retry after the unarchive.
    expect(countRequests(record, "thread/resume")).toBe(3);
    expect(runtime.hasThread("t-ladder-archived")).toBe(true);
  });

  it("staleTurn at the end of a rateLimited ladder: the steer is dropped as stale", async () => {
    const { events, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "turn/steer",
          message: "slow down",
          times: 1,
          recovery: { kind: "rateLimited", retryable: true },
        },
        {
          method: "turn/steer",
          message: "the turn already ended",
          times: 1,
          recovery: { kind: "staleTurn", retryable: false },
        },
      ],
    });
    await startThread(runtime, "t-ladder-stale");
    await runtime.runTurn({
      clientRequestId: "creq_rcvrrungab",
      input: [promptTextInput({ text: "hold_turn" })],
      options: fullRuntimeOptions,
      threadId: "t-ladder-stale",
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      providerId: PROVIDER_ID,
      runtime,
      threadId: "t-ladder-stale",
    });

    const result = await runtime.steerTurn({
      clientRequestId: "creq_rcvrrungac",
      expectedTurnId: turnId,
      input: [promptTextInput({ text: "too late" })],
      options: fullRuntimeOptions,
      threadId: "t-ladder-stale",
    });

    // Reported stale (the daemon resubmits the message as a new turn), and
    // the runtime no longer believes the turn is running.
    expect(result).toEqual({ status: "stale", activeTurnId: null });
    expect(runtime.getActiveTurnId("t-ladder-stale")).toBeNull();
  });

  // Scripted failures count per bridge process, so the laddered request is a
  // steer here: the turn that follows the restart is a plain turn/start on
  // the replacement, which proves the restart ran without tripping the
  // script again.
  it("restartRecommended at the end of a rateLimited ladder: the hint is forwarded and the thread restarts before its next turn", async () => {
    const { events, hints, processLog, record, runtime } =
      createRecoveryRuntime({
        failMethods: [
          {
            method: "turn/steer",
            message: "slow down",
            times: 1,
            recovery: { kind: "rateLimited", retryable: true },
          },
          {
            method: "turn/steer",
            message: "the agent wedged itself; restart me",
            times: 1,
            recovery: { kind: "restartRecommended", retryable: false },
          },
        ],
      });
    const providerThreadId = await startThread(runtime, "t-ladder-restart");
    await runtime.runTurn({
      clientRequestId: "creq_rcvrrungad",
      input: [promptTextInput({ text: "delay:800" })],
      options: fullRuntimeOptions,
      threadId: "t-ladder-restart",
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      providerId: PROVIDER_ID,
      runtime,
      threadId: "t-ladder-restart",
    });

    let caught: unknown;
    try {
      await runtime.steerTurn({
        clientRequestId: "creq_rcvrrungaf",
        expectedTurnId: turnId,
        input: [promptTextInput({ text: "never" })],
        options: fullRuntimeOptions,
        threadId: "t-ladder-restart",
      });
    } catch (error) {
      caught = error;
    }
    // The rung's rejection is reported as is: not a typed rate-limit error.
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(AgentRuntimeRecoveryError);
    expect((caught as Error).message).toBe(
      "the agent wedged itself; restart me",
    );
    expect(countRequests(record, "turn/steer")).toBe(2);
    expect(hints).toEqual([
      expect.objectContaining({
        kind: "restartRecommended",
        providerId: PROVIDER_ID,
        threadId: "t-ladder-restart",
      }),
    ]);
    // The running turn keeps its process; the restart waits for the next turn.
    await waitForThreadTurnCompleted({
      events,
      providerId: PROVIDER_ID,
      runtime,
      threadId: "t-ladder-restart",
      timeoutMs: 5_000,
    });
    expect(countSpawns(processLog)).toBe(1);
    expect(record.last("thread/resume")).toBeUndefined();

    // The scheduled restart runs at the next turn.
    await runtime.runTurn({
      clientRequestId: "creq_rcvrrungae",
      input: [promptTextInput({ text: "after restart" })],
      options: fullRuntimeOptions,
      threadId: "t-ladder-restart",
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: PROVIDER_ID,
      runtime,
      text: "after restart",
      threadId: "t-ladder-restart",
    });
    expect(countSpawns(processLog)).toBe(2);
    expect(record.last("thread/resume")?.params).toMatchObject({
      threadId: "t-ladder-restart",
      providerThreadId,
    });
  });

  // The retry after an unarchive is a request like any other: a hint on its
  // rejection gets its own action instead of surfacing as an untyped
  // failure the daemon can only report as `command_failed`.
  it("authRequired on the retry after an unarchive: typed auth_required and forwarded", async () => {
    const { hints, record, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "thread/resume",
          message: "session is archived",
          times: 1,
          recovery: { kind: "sessionArchived", retryable: true },
        },
        {
          method: "thread/resume",
          message: "session expired, sign in again",
          times: 1,
          recovery: { kind: "authRequired", retryable: false },
        },
      ],
    });
    const providerThreadId = await startThread(runtime, "t-unarchive-auth");
    await runtime.stopThread({ threadId: "t-unarchive-auth" });

    let caught: unknown;
    try {
      await runtime.resumeThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: PROVIDER_ID,
        providerThreadId,
        threadId: "t-unarchive-auth",
        options: fullRuntimeOptions,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentRuntimeRecoveryError);
    expect((caught as AgentRuntimeRecoveryError).code).toBe("auth_required");
    expect((caught as AgentRuntimeRecoveryError).message).toBe(
      "session expired, sign in again",
    );
    expect(countRequests(record, "thread/unarchive")).toBe(1);
    expect(countRequests(record, "thread/resume")).toBe(2);
    expect(hints).toContainEqual(
      expect.objectContaining({
        kind: "authRequired",
        providerId: PROVIDER_ID,
        threadId: "t-unarchive-auth",
      }),
    );
  });

  it("rateLimited on the retry after an unarchive: retried on the ladder and then succeeds", async () => {
    const { hints, record, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "thread/resume",
          message: "session is archived",
          times: 1,
          recovery: { kind: "sessionArchived", retryable: true },
        },
        {
          method: "thread/resume",
          message: "slow down",
          times: 1,
          recovery: { kind: "rateLimited", retryable: true },
        },
      ],
    });
    const providerThreadId = await startThread(runtime, "t-unarchive-rate");
    await runtime.stopThread({ threadId: "t-unarchive-rate" });

    await expect(
      runtime.resumeThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: PROVIDER_ID,
        providerThreadId,
        threadId: "t-unarchive-rate",
        options: fullRuntimeOptions,
      }),
    ).resolves.toEqual({ providerThreadId });
    expect(countRequests(record, "thread/unarchive")).toBe(1);
    // The archived attempt, the rate-limited retry, and the rung that won.
    expect(countRequests(record, "thread/resume")).toBe(3);
    expect(hints.some((hint) => hint.kind === "rateLimited")).toBe(false);
  });

  it("restartRecommended on the retry after an unarchive: forwarded, and the thread restarts before its next turn", async () => {
    const { events, hints, processLog, record, runtime } =
      createRecoveryRuntime({
        failMethods: [
          {
            method: "turn/steer",
            message: "session is archived",
            times: 1,
            recovery: { kind: "sessionArchived", retryable: true },
          },
          {
            method: "turn/steer",
            message: "the agent wedged itself; restart me",
            times: 1,
            recovery: { kind: "restartRecommended", retryable: false },
          },
        ],
      });
    const providerThreadId = await startThread(runtime, "t-unarchive-restart");
    await runtime.runTurn({
      clientRequestId: "creq_rcvrunarab",
      input: [promptTextInput({ text: "delay:800" })],
      options: fullRuntimeOptions,
      threadId: "t-unarchive-restart",
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      providerId: PROVIDER_ID,
      runtime,
      threadId: "t-unarchive-restart",
    });

    await expect(
      runtime.steerTurn({
        clientRequestId: "creq_rcvrunarad",
        expectedTurnId: turnId,
        input: [promptTextInput({ text: "never" })],
        options: fullRuntimeOptions,
        threadId: "t-unarchive-restart",
      }),
    ).rejects.toThrow("the agent wedged itself; restart me");
    expect(countRequests(record, "thread/unarchive")).toBe(1);
    expect(countRequests(record, "turn/steer")).toBe(2);
    expect(hints).toEqual([
      expect.objectContaining({
        kind: "restartRecommended",
        providerId: PROVIDER_ID,
        threadId: "t-unarchive-restart",
      }),
    ]);
    await waitForThreadTurnCompleted({
      events,
      providerId: PROVIDER_ID,
      runtime,
      threadId: "t-unarchive-restart",
      timeoutMs: 5_000,
    });
    expect(countSpawns(processLog)).toBe(1);
    expect(record.last("thread/resume")).toBeUndefined();

    await runtime.runTurn({
      clientRequestId: "creq_rcvrunarac",
      input: [promptTextInput({ text: "after restart" })],
      options: fullRuntimeOptions,
      threadId: "t-unarchive-restart",
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: PROVIDER_ID,
      runtime,
      text: "after restart",
      threadId: "t-unarchive-restart",
    });
    expect(countSpawns(processLog)).toBe(2);
    expect(record.last("thread/resume")?.params).toMatchObject({
      threadId: "t-unarchive-restart",
      providerThreadId,
    });
  });

  it("sessionArchived on the retry after an unarchive: reported, not unarchived again", async () => {
    const { record, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "thread/resume",
          message: "session is archived",
          times: 2,
          recovery: { kind: "sessionArchived", retryable: true },
        },
      ],
    });
    const providerThreadId = await startThread(runtime, "t-unarchive-twice");
    await runtime.stopThread({ threadId: "t-unarchive-twice" });

    await expect(
      runtime.resumeThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: PROVIDER_ID,
        providerThreadId,
        threadId: "t-unarchive-twice",
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow("session is archived");
    // One unarchive, one retry: the protocol promises a retry, not a loop.
    expect(countRequests(record, "thread/unarchive")).toBe(1);
    expect(countRequests(record, "thread/resume")).toBe(2);
  });

  // The hint is on the error, not on the call site: a command with no
  // session to act on (model/list, a plain thread/start) still reaches the
  // daemon as a typed `auth_required` — there is no regex left to rescue it.
  it("authRequired on model/list: typed auth_required and forwarded", async () => {
    // model/list carries no thread and no per-command script, so the
    // failure is scripted at the process level.
    const { hints, runtime } = createRecoveryRuntime({}, {
      failMethods: [
        {
          method: "model/list",
          message: "ACP agent is not authenticated.",
          recovery: { kind: "authRequired", retryable: false },
        },
      ],
    });
    let caught: unknown;
    try {
      await runtime.listModels({ providerId: PROVIDER_ID });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentRuntimeRecoveryError);
    expect((caught as AgentRuntimeRecoveryError).code).toBe("auth_required");
    expect(hints).toContainEqual(
      expect.objectContaining({ kind: "authRequired", providerId: PROVIDER_ID }),
    );
  });

  it("authRequired on a plain thread/start: typed auth_required and forwarded", async () => {
    const { hints, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "thread/start",
          message: "Please sign in to the agent first",
          recovery: { kind: "authRequired", retryable: false },
        },
      ],
    });
    let caught: unknown;
    try {
      await startThread(runtime, "t-start-auth");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentRuntimeRecoveryError);
    expect((caught as AgentRuntimeRecoveryError).code).toBe("auth_required");
    expect((caught as AgentRuntimeRecoveryError).message).toBe(
      "Please sign in to the agent first",
    );
    expect(hints).toContainEqual(
      expect.objectContaining({ kind: "authRequired", providerId: PROVIDER_ID }),
    );
    expect(runtime.hasThread("t-start-auth")).toBe(false);
  });

  it("rateLimited: a retryable rejection is retried on the ladder and then succeeds", async () => {
    const { events, record, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "turn/start",
          message: "slow down",
          times: 1,
          recovery: { kind: "rateLimited", retryable: true },
        },
      ],
    });
    await startThread(runtime, "t-rate");

    await runtime.runTurn({
      clientRequestId: "creq_rcvrhint24",
      input: [promptTextInput({ text: "after the wait" })],
      options: fullRuntimeOptions,
      threadId: "t-rate",
    });

    expect(countRequests(record, "turn/start")).toBe(2);
    await waitForThreadAgentMessageText({
      events,
      providerId: PROVIDER_ID,
      runtime,
      text: "after the wait",
      threadId: "t-rate",
    });
  });

  it("rateLimited: the failure after the last rung surfaces as a typed error and is forwarded", async () => {
    const { hints, record, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "turn/start",
          message: "still rate limited",
          recovery: { kind: "rateLimited", retryable: true },
        },
      ],
    });
    await startThread(runtime, "t-rate-exhausted");

    let caught: unknown;
    try {
      await runtime.runTurn({
        clientRequestId: "creq_rcvrhint25",
        input: [promptTextInput({ text: "never" })],
        options: fullRuntimeOptions,
        threadId: "t-rate-exhausted",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentRuntimeRecoveryError);
    expect((caught as AgentRuntimeRecoveryError).code).toBe("rate_limited");
    // The first attempt plus one per rung of the ladder.
    expect(countRequests(record, "turn/start")).toBe(3);
    // The thread is idle again: the next turn is accepted normally.
    expect(runtime.getActiveTurnId("t-rate-exhausted")).toBeNull();
    // The ladder's final rejection is the one the host learns about: the
    // hint is forwarded once, stamped with exactly the provider and the
    // thread it failed for (nothing else from the retry's bookkeeping).
    expect(hints).toEqual([
      {
        kind: "rateLimited",
        providerId: PROVIDER_ID,
        threadId: "t-rate-exhausted",
        retryable: true,
        message: expect.any(String),
      },
    ]);
  });

  it("rateLimited: a terminal rejection is not retried but is forwarded", async () => {
    const { hints, record, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "turn/start",
          message: "quota exhausted for the month",
          recovery: { kind: "rateLimited", retryable: false },
        },
      ],
    });
    await startThread(runtime, "t-quota");
    let caught: unknown;
    try {
      await runtime.runTurn({
        clientRequestId: "creq_rcvrhint26",
        input: [promptTextInput({ text: "never" })],
        options: fullRuntimeOptions,
        threadId: "t-quota",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentRuntimeRecoveryError);
    expect((caught as AgentRuntimeRecoveryError).code).toBe("rate_limited");
    expect(countRequests(record, "turn/start")).toBe(1);
    expect(hints).toEqual([
      expect.objectContaining({
        kind: "rateLimited",
        providerId: PROVIDER_ID,
        threadId: "t-quota",
        retryable: false,
      }),
    ]);
  });

  it("staleTurn: a rejected steer is dropped as stale instead of failing", async () => {
    const { events, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "turn/steer",
          code: BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN,
          message: "the turn already ended",
          recovery: { kind: "staleTurn", retryable: false },
        },
      ],
    });
    await startThread(runtime, "t-stale");
    await runtime.runTurn({
      clientRequestId: "creq_rcvrhint27",
      input: [promptTextInput({ text: "hold_turn" })],
      options: fullRuntimeOptions,
      threadId: "t-stale",
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      providerId: PROVIDER_ID,
      runtime,
      threadId: "t-stale",
    });

    const result = await runtime.steerTurn({
      clientRequestId: "creq_rcvrhint28",
      expectedTurnId: turnId,
      input: [promptTextInput({ text: "too late" })],
      options: fullRuntimeOptions,
      threadId: "t-stale",
    });

    expect(result).toEqual({ status: "stale", activeTurnId: null });
    expect(runtime.getActiveTurnId("t-stale")).toBeNull();
  });

  it("restartRecommended: an idle thread is moved to a fresh bridge process right away", async () => {
    const { events, hints, processLog, record, runtime } =
      createRecoveryRuntime();
    const providerThreadId = await startThread(runtime, "t-restart");

    await runtime.runTurn({
      clientRequestId: "creq_rcvrhint29",
      input: [promptTextInput({ text: "recover:restartRecommended" })],
      options: fullRuntimeOptions,
      threadId: "t-restart",
    });
    // The restart replaces the provider process while these waits poll, so
    // they must not fail fast on "provider is no longer running".
    await waitForThreadTurnCompleted({
      events,
      threadId: "t-restart",
    });
    await waitForRuntimeState({
      describeFailure: () =>
        `processLog=[${processLog.read().join(",")}], resumedThreadIds=[${resumedThreadIds(record).join(",")}]`,
      label: "the thread was resumed on a fresh process",
      predicate: () =>
        processLog.read().filter((line) => line.startsWith("spawn:"))
          .length === 2 &&
        record.last("thread/resume") !== undefined &&
        runtime.listRunningProviders().length === 1,
      runtime,
      timeoutMs: 5_000,
    });

    expect(hints).toContainEqual(
      expect.objectContaining({
        kind: "restartRecommended",
        providerId: PROVIDER_ID,
        threadId: "t-restart",
      }),
    );
    expect(record.last("thread/resume")?.params).toMatchObject({
      threadId: "t-restart",
      providerThreadId,
    });
    expect(runtime.getProviderSession("t-restart")).toEqual({
      providerId: PROVIDER_ID,
      providerThreadId,
    });
    // The next turn runs on the replacement without another restart.
    events.splice(0, events.length);
    await runtime.runTurn({
      clientRequestId: "creq_rcvrhint2a",
      input: [promptTextInput({ text: "after restart" })],
      options: fullRuntimeOptions,
      threadId: "t-restart",
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: PROVIDER_ID,
      runtime,
      text: "after restart",
      threadId: "t-restart",
    });
    expect(
      processLog.read().filter((line) => line.startsWith("spawn:")),
    ).toHaveLength(2);
  });

  it("restartRecommended: a thread with an active turn restarts before its next turn", async () => {
    const { events, hints, processLog, record, runtime } =
      createRecoveryRuntime();
    await startThread(runtime, "t-restart-later");

    await runtime.runTurn({
      clientRequestId: "creq_rcvrhintd2",
      input: [
        promptTextInput({ text: "delay:300 recover_now:restartRecommended" }),
      ],
      options: fullRuntimeOptions,
      threadId: "t-restart-later",
    });
    await waitForRuntimeState({
      label: "the unsolicited hint arrived mid-turn",
      predicate: () => hints.some((hint) => hint.kind === "restartRecommended"),
      runtime,
      timeoutMs: 5_000,
    });
    expect(runtime.getActiveTurnId("t-restart-later")).not.toBeNull();
    await waitForThreadTurnCompleted({
      events,
      providerId: PROVIDER_ID,
      runtime,
      threadId: "t-restart-later",
    });
    // The running turn kept its process; the restart waits for the next turn.
    expect(
      processLog.read().filter((line) => line.startsWith("spawn:")),
    ).toHaveLength(1);
    expect(record.last("thread/resume")).toBeUndefined();

    events.splice(0, events.length);
    await runtime.runTurn({
      clientRequestId: "creq_rcvrhintd3",
      input: [promptTextInput({ text: "next turn" })],
      options: fullRuntimeOptions,
      threadId: "t-restart-later",
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: PROVIDER_ID,
      runtime,
      text: "next turn",
      threadId: "t-restart-later",
    });
    const logLines = processLog.read();
    expect(logLines.filter((line) => line.startsWith("spawn:"))).toHaveLength(
      2,
    );
    expect(record.last("thread/resume")?.params).toMatchObject({
      threadId: "t-restart-later",
    });
  });

  it("restartRecommended on a rejected request: the request fails, the hint is forwarded, and the thread restarts before its next turn", async () => {
    const { events, hints, processLog, record, runtime } =
      createRecoveryRuntime({
        failMethods: [
          {
            method: "thread/name/set",
            message: "the agent wedged itself; restart me",
            recovery: { kind: "restartRecommended", retryable: false },
          },
        ],
      });
    const providerThreadId = await startThread(runtime, "t-restart-rejected");

    // The rejected request is reported as is: no retry, no typed error.
    await expect(
      runtime.renameThread({ threadId: "t-restart-rejected", title: "x" }),
    ).rejects.toThrow("the agent wedged itself; restart me");
    expect(countRequests(record, "thread/name/set")).toBe(1);
    expect(hints).toEqual([
      expect.objectContaining({
        kind: "restartRecommended",
        providerId: PROVIDER_ID,
        threadId: "t-restart-rejected",
      }),
    ]);
    // The hint arrived inside the rename's own thread operation, so the
    // restart is scheduled for the next turn rather than run under it.
    expect(
      processLog.read().filter((line) => line.startsWith("spawn:")),
    ).toHaveLength(1);
    expect(record.last("thread/resume")).toBeUndefined();

    // The next turn first moves the thread to a fresh process (the same
    // provider session resumed), then runs on it.
    await runtime.runTurn({
      clientRequestId: "creq_rcvrhintd5",
      input: [promptTextInput({ text: "after restart" })],
      options: fullRuntimeOptions,
      threadId: "t-restart-rejected",
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: PROVIDER_ID,
      runtime,
      text: "after restart",
      threadId: "t-restart-rejected",
    });
    expect(
      processLog.read().filter((line) => line.startsWith("spawn:")),
    ).toHaveLength(2);
    expect(record.last("thread/resume")?.params).toMatchObject({
      threadId: "t-restart-rejected",
      providerThreadId,
    });
  });

  // The restart's shutdown detaches every sibling on the process, and the
  // daemon resumes a detached thread on its next command without waiting for
  // the restart: a sibling rebuilt that way (and possibly mid-turn already)
  // must not get the restart's own thread/resume on top, which would replace
  // the session its turn runs on.
  it("restartRecommended: a sibling the daemon resumed during the restart keeps its turn and is not resumed again", async () => {
    const { events, processLog, record, runtime } = createRecoveryRuntime({
      // Every session construction takes this long, so the daemon's lazy
      // resume of the sibling lands while the replacement is still coming up.
      startDelayMs: 300,
    });
    await startThread(runtime, "t-restart-a");
    const providerThreadIdB = await startThread(runtime, "t-restart-b");
    expect(countSpawns(processLog)).toBe(1);

    await runtime.runTurn({
      clientRequestId: "creq_rcvrsibsab",
      input: [promptTextInput({ text: "recover:restartRecommended" })],
      options: fullRuntimeOptions,
      threadId: "t-restart-a",
    });
    await waitForThreadTurnCompleted({ events, threadId: "t-restart-a" });
    await waitForRuntimeState({
      label: "the restart detached the sibling",
      predicate: () => !runtime.hasThread("t-restart-b"),
      timeoutMs: 5_000,
    });

    // What the daemon does on the sibling's next turn.submit: resume the
    // thread it no longer finds live, then start the turn.
    await runtime.resumeThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      providerThreadId: providerThreadIdB,
      threadId: "t-restart-b",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_rcvrsibsac",
      input: [promptTextInput({ text: "hold_turn" })],
      options: fullRuntimeOptions,
      threadId: "t-restart-b",
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      threadId: "t-restart-b",
    });

    // The restart loop finishes with the hinted thread's own resume (the
    // sibling is skipped synchronously right after it); leave a whole
    // construction delay for a second resume to show up if one were sent.
    await waitForRuntimeState({
      label: "the hinted thread is live on the replacement",
      predicate: () =>
        countSpawns(processLog) === 2 && runtime.hasThread("t-restart-a"),
      timeoutMs: 5_000,
    });
    await wait(500);

    // One resume each: the restart's for the hinted thread, the daemon's for
    // the sibling (in whichever order the replacement answered them).
    expect(resumedThreadIds(record).sort()).toEqual([
      "t-restart-a",
      "t-restart-b",
    ]);
    expect(countSpawns(processLog)).toBe(2);
    // The sibling's turn is still the one the bridge is running.
    expect(runtime.getActiveTurnId("t-restart-b")).toBe(turnId);
    await expect(
      runtime.steerTurn({
        clientRequestId: "creq_rcvrsibsad",
        expectedTurnId: turnId,
        input: [promptTextInput({ text: "still steerable" })],
        options: fullRuntimeOptions,
        threadId: "t-restart-b",
      }),
    ).resolves.toEqual({ status: "steered" });
  });

  it("restartRecommended read while its turn/start is still in flight restarts once the turn settles", async () => {
    const { events, processLog, record, runtime, stderr } =
      createRecoveryRuntime();
    await startThread(runtime, "t-batch");

    // The bridge opens the turn, settles it and raises the hint before it
    // answers turn/start, so the hint reaches the runtime while the turn
    // operation is still in flight — the state one read that batches the
    // turn/start response, the terminal delta and the hint produces on a
    // loaded machine. The hint must not wait for the thread's next turn.
    await runtime.runTurn({
      clientRequestId: "creq_rcvrbatchx",
      input: [promptTextInput({ text: "recover:restartRecommended" })],
      options: {
        ...fullRuntimeOptions,
        providerOptions: { scripted: { turnStartResponseDelayMs: 200 } },
      },
      threadId: "t-batch",
    });
    await waitForThreadTurnCompleted({ events, threadId: "t-batch" });
    await waitForRuntimeState({
      describeFailure: () =>
        `processLog=[${processLog.read().join(",")}], resumedThreadIds=[${resumedThreadIds(record).join(",")}], stderr=[${stderr.join(",")}]`,
      label: "the restart ran once the turn operation settled",
      predicate: () =>
        countSpawns(processLog) === 2 &&
        record.last("thread/resume") !== undefined,
      runtime,
      timeoutMs: 5_000,
    });
    expect(resumedThreadIds(record)).toEqual(["t-batch"]);
    expect(
      stderr.some((line) =>
        line.startsWith(
          `Restarting the "${PROVIDER_ID}" bridge for thread "t-batch"`,
        ),
      ),
    ).toBe(true);
  });

  it("restartRecommended: defers while a sibling on the process holds open background work", async () => {
    const { events, processLog, record, runtime, stderr } =
      createRecoveryRuntime();
    await startThread(runtime, "t-bg-a");
    await startThread(runtime, "t-bg-b");

    // The sibling's turn settles but leaves a background task running.
    await runtime.runTurn({
      clientRequestId: "creq_rcvrbgwkab",
      input: [promptTextInput({ text: "bg_task" })],
      options: fullRuntimeOptions,
      threadId: "t-bg-b",
    });
    await waitForThreadTurnCompleted({ events, threadId: "t-bg-b" });
    expect(runtime.getActiveTurnId("t-bg-b")).toBeNull();
    expect(runtime.hasOpenBackgroundWork()).toBe(true);

    await runtime.runTurn({
      clientRequestId: "creq_rcvrbgwkac",
      input: [promptTextInput({ text: "recover:restartRecommended" })],
      options: fullRuntimeOptions,
      threadId: "t-bg-a",
    });
    await waitForThreadTurnCompleted({ events, threadId: "t-bg-a" });
    await waitForRuntimeState({
      label: "the restart was deferred for the sibling's background work",
      predicate: () =>
        stderr.some(
          (line) =>
            line.startsWith(
              `Deferring the "${PROVIDER_ID}" bridge restart recommended for thread "t-bg-a"`,
            ) && line.includes('thread "t-bg-b"'),
        ),
      timeoutMs: 5_000,
    });
    // Nothing was killed: one process, no resume, the task still open.
    expect(countSpawns(processLog)).toBe(1);
    expect(record.last("thread/resume")).toBeUndefined();
    expect(runtime.hasOpenBackgroundWork()).toBe(true);

    // Once the sibling's work settles, the deferred restart runs at the
    // hinted thread's next turn and both threads come back on the
    // replacement. The settling turn closes the task before it completes,
    // so wait for the turn itself as well: a turn on the hinted thread
    // submitted while the sibling is still mid-turn defers the restart
    // again. The splice precedes the turn because the wait scans recorded
    // events and the sibling's first turn/completed is already among them.
    events.splice(0, events.length);
    await runtime.runTurn({
      clientRequestId: "creq_rcvrbgwkad",
      input: [promptTextInput({ text: "bg_task_done" })],
      options: fullRuntimeOptions,
      threadId: "t-bg-b",
    });
    await waitForThreadTurnCompleted({ events, threadId: "t-bg-b" });
    await waitForRuntimeState({
      label: "the sibling's background task settled",
      predicate: () => !runtime.hasOpenBackgroundWork(),
      timeoutMs: 5_000,
    });
    await runtime.runTurn({
      clientRequestId: "creq_rcvrbgwkae",
      input: [promptTextInput({ text: "after restart" })],
      options: fullRuntimeOptions,
      threadId: "t-bg-a",
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: PROVIDER_ID,
      runtime,
      text: "after restart",
      threadId: "t-bg-a",
    });
    expect(countSpawns(processLog)).toBe(2);
    expect(resumedThreadIds(record).sort()).toEqual(["t-bg-a", "t-bg-b"]);
  });

  it("drops an unsolicited hint that names a thread the emitting process does not host", async () => {
    const { events, hints, processLog, record, runtime, stderr } =
      createRecoveryRuntime();
    await startThread(runtime, "t-victim");
    // A second provider on its own process whose bridge names the first
    // provider's thread on every unsolicited hint.
    await runtime.startThread({
      bridgeLaunch: createScriptedEchoLaunch({
        pluginId: "provider-hostile",
        digest: "hostile",
        scripted: { recoveryThreadIdHint: "t-victim" },
      }),
      environmentId: "env-1",
      projectId: "p1",
      providerId: "hostile",
      threadId: "t-attacker",
      options: fullRuntimeOptions,
    });
    expect(countSpawns(processLog)).toBe(2);

    await runtime.runTurn({
      clientRequestId: "creq_rcvrhstaab",
      input: [promptTextInput({ text: "recover:restartRecommended" })],
      options: fullRuntimeOptions,
      threadId: "t-attacker",
    });
    await waitForThreadTurnCompleted({ events, threadId: "t-attacker" });
    await waitForRuntimeState({
      label: "the foreign hint was dropped",
      predicate: () =>
        stderr.some((line) =>
          line.startsWith(
            'Dropping provider/recovery restartRecommended from "hostile": it names thread "t-victim"',
          ),
        ),
      timeoutMs: 5_000,
    });
    // Not forwarded, and the victim's bridge was left alone.
    expect(hints).toEqual([]);
    expect(countSpawns(processLog)).toBe(2);
    expect(record.last("thread/resume")).toBeUndefined();
    await runtime.runTurn({
      clientRequestId: "creq_rcvrhstaac",
      input: [promptTextInput({ text: "still here" })],
      options: fullRuntimeOptions,
      threadId: "t-victim",
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: PROVIDER_ID,
      runtime,
      text: "still here",
      threadId: "t-victim",
    });
    expect(countSpawns(processLog)).toBe(2);
  });

  it("unsolicited authRequired and rateLimited hints are forwarded and take no action", async () => {
    const { events, hints, processLog, record, runtime } =
      createRecoveryRuntime();
    await startThread(runtime, "t-forward");
    await runtime.runTurn({
      clientRequestId: "creq_rcvrhint2d",
      input: [
        promptTextInput({
          text: "fail_turn:401_Unauthorized recover:authRequired",
        }),
      ],
      options: fullRuntimeOptions,
      threadId: "t-forward",
    });
    // The failed turn is the point here, so this wait must not fail fast on
    // its provider/error row.
    await waitForRuntimeState({
      label: "the turn failed and the authRequired hint was forwarded",
      predicate: () =>
        events.some(
          (event) =>
            event.type === "turn/completed" && event.status === "failed",
        ) && hints.some((hint) => hint.kind === "authRequired"),
      timeoutMs: 5_000,
    });
    expect(hints).toContainEqual(
      expect.objectContaining({
        kind: "authRequired",
        providerId: PROVIDER_ID,
        threadId: "t-forward",
        retryable: false,
      }),
    );
    // No restart, no retry, no unarchive: the hint only informs.
    expect(
      processLog.read().filter((line) => line.startsWith("spawn:")),
    ).toHaveLength(1);
    expect(countRequests(record, "turn/start")).toBe(1);
    expect(record.last("thread/unarchive")).toBeUndefined();
  });

  // Panel finding 1: two requests in flight on one thread, rejected with
  // different hints — each action follows its own rejection.
  it("matches each action to its own rejection when two requests are in flight", async () => {
    const { events, hints, record, runtime } = createRecoveryRuntime({
      failMethods: [
        {
          method: "turn/start",
          message: "slow down",
          times: 1,
          recovery: { kind: "rateLimited", retryable: true },
        },
        {
          method: "thread/name/set",
          message: "login required to rename",
          recovery: { kind: "authRequired", retryable: false },
        },
      ],
    });
    await startThread(runtime, "t-two");

    const turn = runtime.runTurn({
      clientRequestId: "creq_rcvrhint2e",
      input: [promptTextInput({ text: "eventually" })],
      options: fullRuntimeOptions,
      threadId: "t-two",
    });
    const rename = runtime.renameThread({ threadId: "t-two", title: "x" });

    await expect(rename).rejects.toMatchObject({
      code: "auth_required",
      recovery: expect.objectContaining({ kind: "authRequired" }),
    });
    await turn;
    expect(countRequests(record, "turn/start")).toBe(2);
    expect(countRequests(record, "thread/name/set")).toBe(1);
    // The rename's authRequired was forwarded; the turn's rateLimited was
    // retried, not forwarded.
    expect(hints).toContainEqual(
      expect.objectContaining({ kind: "authRequired", threadId: "t-two" }),
    );
    expect(hints.some((hint) => hint.kind === "rateLimited")).toBe(false);
    await waitForThreadAgentMessageText({
      events,
      providerId: PROVIDER_ID,
      runtime,
      text: "eventually",
      threadId: "t-two",
    });
  });

  // Panel finding 2: a rewind staging thread suppresses its event stream;
  // the hint rides the rejection, so the recovery still runs.
  it("recovers an archived source on a rewind staging fork", async () => {
    const { record, runtime } = createRecoveryRuntime({
      archivedSession: true,
    });
    const result = await runtime.prepareThreadRewind({
      environmentId: "env-1",
      threadId: "t-rewind",
      leaseId: "lease-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      sourceProviderThreadId: "prov-source",
      retainThroughProviderCheckpoint: "turn-1",
      options: fullRuntimeOptions,
      instructionMode: "append",
    });
    expect(result.providerThreadId).toEqual(expect.any(String));
    expect(record.read()).toContainEqual({
      method: "thread/unarchive",
      params: {
        threadId: "t-rewind:rewind:lease-1",
        providerThreadId: "prov-source",
      },
    });
    expect(countRequests(record, "thread/fork")).toBe(2);
    await runtime.discardThreadRewind({ leaseId: "lease-1" });
  });

  // Panel finding 3: a fork of an archived source recovers through the
  // fork's own rejection (the source, not the new thread, is unarchived).
  it("recovers an archived source on thread/fork", async () => {
    const { events, record, runtime } = createRecoveryRuntime({
      archivedSession: true,
    });
    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      threadId: "t-forked",
      fork: { sourceProviderThreadId: "prov-source" },
      options: fullRuntimeOptions,
    });
    expect(record.read()).toContainEqual({
      method: "thread/unarchive",
      params: { threadId: "t-forked", providerThreadId: "prov-source" },
    });
    expect(countRequests(record, "thread/fork")).toBe(2);
    await runtime.runTurn({
      clientRequestId: "creq_rcvrhint2f",
      input: [promptTextInput({ text: "on the fork" })],
      options: fullRuntimeOptions,
      threadId: "t-forked",
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: PROVIDER_ID,
      runtime,
      text: "on the fork",
      threadId: "t-forked",
    });
  });

  // Panel finding 4: a bridge exit has no response and therefore no hint —
  // a plain rejection, no action.
  it("treats a bridge exit as a plain rejection with no recovery", async () => {
    const { record, runtime } = createRecoveryRuntime({
      crashOn: "thread/resume",
    });
    let caught: unknown;
    try {
      await runtime.resumeThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: PROVIDER_ID,
        providerThreadId: "prov-crash",
        threadId: "t-crash",
        options: fullRuntimeOptions,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(AgentRuntimeRecoveryError);
    expect(record.last("thread/unarchive")).toBeUndefined();
    expect(countRequests(record, "thread/resume")).toBe(1);
  });
});
