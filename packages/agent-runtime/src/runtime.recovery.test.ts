import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { BRIDGE_JSON_RPC_ERRORS } from "@bb/provider-bridge-protocol";
import { AgentRuntimeRecoveryError } from "./runtime.js";
import {
  createScriptedEchoProcessLog,
  createScriptedEchoRequestRecord,
  createScriptedEchoRuntime,
  fullRuntimeOptions,
  waitForRuntimeState,
  waitForThreadAgentMessageText,
  waitForThreadTurnCompleted,
  waitForThreadTurnStarted,
  type ScriptedEchoLaunchScript,
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
  runtime: AgentRuntime;
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
  ): RecoveryRuntime {
    const events: ThreadEvent[] = [];
    const hints: AgentRuntimeProviderRecoveryHint[] = [];
    const record = createScriptedEchoRequestRecord();
    const processLog = createScriptedEchoProcessLog();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath,
        env: { ...record.env, ...processLog.env },
        onEvent: (event) => events.push(event),
        onProviderRecovery: (hint) => hints.push(hint),
        // Two rungs, like production, in milliseconds instead of seconds.
        rateLimitRetry: { delaysMs: [20, 40] },
      },
      launch: { scripted },
    });
    runtimes.push(runtime);
    return { events, hints, processLog, record, runtime };
  }

  async function startThread(
    runtime: AgentRuntime,
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
    const { record, runtime } = createRecoveryRuntime({
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

  it("rateLimited: the failure after the last rung surfaces as a typed error", async () => {
    const { record, runtime } = createRecoveryRuntime({
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
  });

  it("rateLimited: a terminal rejection is not retried", async () => {
    const { record, runtime } = createRecoveryRuntime({
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
      label: "the thread was resumed on a fresh process",
      predicate: () =>
        processLog.read().filter((line) => line.startsWith("spawn:"))
          .length === 2 &&
        record.last("thread/resume") !== undefined &&
        runtime.listRunningProviders().length === 1,
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
    const { events, record, runtime } = createRecoveryRuntime({
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
