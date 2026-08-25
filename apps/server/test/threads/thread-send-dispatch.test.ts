import {
  archiveThread,
  getQueuedThreadMessage,
  getThread,
  listDeferredThreadMessages,
  listEvents,
  listQueuedThreadMessages,
  markThreadDeleted,
  setQueuedThreadMessageGroupBoundary,
} from "@bb/db";
import { turnScope, type Environment, type Thread } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import type { TelemetryService } from "../../src/services/system/telemetry.js";
import { deferThreadMessage } from "../../src/services/threads/deferred-thread-messages.js";
import { queueParentSystemMessage } from "../../src/services/threads/parent-system-messages.js";
import { sendQueuedMessage } from "../../src/services/threads/queued-messages.js";
import { flushDeferredThreadMessages } from "../../src/services/threads/thread-send-request.js";
import { handleUpdateEnvironmentDirectoryToolCall } from "../../src/services/threads/thread-environment-directory.js";
import { sendThreadMessage } from "../../src/services/threads/thread-send.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedStoredEvent,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface IdleThreadFixture {
  environment: Environment;
  thread: Thread;
}

interface SeedIdleThreadFixtureArgs {
  harness: TestAppHarness;
  value: number;
}

interface SeedProviderThreadFixtureArgs extends SeedIdleThreadFixtureArgs {
  status?: "active" | "idle";
}

/**
 * Seeds a ready environment and a thread with a live provider session.
 * The stored provider thread ID lets queued messages use the warm provider path.
 */
function seedProviderThreadFixture(
  args: SeedProviderThreadFixtureArgs,
): IdleThreadFixture {
  const { host } = seedHostSession(args.harness.deps, {
    id: `host-send-dispatch-${args.value}`,
  });
  const { project } = seedProjectWithSource(args.harness.deps, {
    hostId: host.id,
    path: `/tmp/send-dispatch-${args.value}`,
  });
  const environment = seedEnvironment(args.harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/send-dispatch-${args.value}`,
    status: "ready",
  });
  const thread = seedThread(args.harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: args.status ?? "idle",
  });
  seedThreadRuntimeState(args.harness.deps, {
    environmentId: environment.id,
    providerThreadId: `provider-send-dispatch-${args.value}`,
    threadId: thread.id,
  });

  return { environment, thread };
}

/**
 * Seeds a ready environment + a cold `idle` thread with NO provider session
 * (no stored provider-thread-id), so a `mode: "start"` send resolves to a cold
 * `thread.start` rather than a warm `turn.submit`.
 */
function seedColdIdleThreadFixture(
  args: SeedIdleThreadFixtureArgs,
): IdleThreadFixture {
  const { host } = seedHostSession(args.harness.deps, {
    id: `host-send-dispatch-${args.value}`,
  });
  const { project } = seedProjectWithSource(args.harness.deps, {
    hostId: host.id,
    path: `/tmp/send-dispatch-${args.value}`,
  });
  const environment = seedEnvironment(args.harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/send-dispatch-${args.value}`,
    status: "ready",
  });
  const thread = seedThread(args.harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });

  return { environment, thread };
}

function installTelemetryCaptureSpy(harness: TestAppHarness) {
  const capture = vi.fn<TelemetryService["capture"]>();
  harness.deps.telemetry = { capture };
  return capture;
}

describe("queued message dispatch gate", () => {
  it("rolls back and sends no host command when the idle thread was archived between claim and dispatch", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedProviderThreadFixture({ harness, value: 1 });
      const queued = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("queued while idle"),
      });

      // The thread is archived AFTER the message is queued but still `idle`:
      // this is exactly the race window the manual send path must defend
      // against. The structural `run.started` gate is what catches it; the
      // auto-sweep entry guard would otherwise have skipped an archived thread.
      archiveThread(harness.db, harness.hub, thread.id);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "idle",
        archivedAt: expect.any(Number),
      });

      await expect(
        sendQueuedMessage(harness.deps, {
          threadId: thread.id,
          queuedMessageId: queued.id,
          mode: "auto",
        }),
      ).rejects.toMatchObject({
        body: { code: "queued_message_claim_lost" },
      });

      // No turn was dispatched to the host: the transaction rolled back the
      // claim consumption + the client/turn/requested append, so the message
      // stays queued and the runtime never sees a turn.submit/thread.start.
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toHaveLength(0);
      expect(getQueuedThreadMessage(harness.db, queued.id)).not.toBeNull();
      expect(
        listQueuedThreadMessages(harness.db, thread.id).map((row) => row.id),
      ).toContain(queued.id);
      // The archived thread stays idle: the superseded dispatch never
      // flipped it to active.
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "idle",
      });
    });
  });

  it("rolls back and sends no host command when the idle thread was deleted between claim and dispatch", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedProviderThreadFixture({ harness, value: 2 });
      const queued = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("queued while idle"),
      });

      markThreadDeleted(harness.db, harness.hub, { threadId: thread.id });

      await expect(
        sendQueuedMessage(harness.deps, {
          threadId: thread.id,
          queuedMessageId: queued.id,
          mode: "auto",
        }),
      ).rejects.toMatchObject({
        body: { code: "queued_message_claim_lost" },
      });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toHaveLength(0);
      expect(getQueuedThreadMessage(harness.db, queued.id)).not.toBeNull();
    });
  });
});

describe("user message telemetry", () => {
  it("captures direct user sends", async () => {
    await withTestHarness(async (harness) => {
      const capture = installTelemetryCaptureSpy(harness);
      const { environment, thread } = seedColdIdleThreadFixture({
        harness,
        value: 5,
      });

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: textInput("telemetry user send"),
          mode: "start",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });

      expect(capture).toHaveBeenCalledWith({
        name: "user_message_sent",
        properties: {
          is_child_thread: false,
          message_source: "thread_send",
          provider: "codex",
        },
      });
    });
  });

  it("does not capture agent-originated sends", async () => {
    await withTestHarness(async (harness) => {
      const capture = installTelemetryCaptureSpy(harness);
      const { environment, thread } = seedColdIdleThreadFixture({
        harness,
        value: 6,
      });
      const senderThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: thread.projectId,
      });

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: textInput("telemetry agent send"),
          mode: "start",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          senderThreadId: senderThread.id,
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });

      expect(capture).not.toHaveBeenCalled();
    });
  });
});

describe("turn submit failure settlement", () => {
  it("records a terminal rejection for the failed client request", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedProviderThreadFixture({
        harness,
        status: "active",
        value: 7,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-send-dispatch-7",
        sequence: 3,
        threadId: thread.id,
        turnId: "turn-active",
      });
      const activeThread = getThread(harness.db, thread.id);
      if (!activeThread) throw new Error("Expected an active thread");

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: textInput("failed steer"),
          mode: "steer",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread: activeThread,
        trigger: "user",
      });
      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "turn.submit" &&
          candidate.command.threadId === thread.id,
      );
      if (queued.command.type !== "turn.submit") {
        throw new Error("Expected a turn.submit command");
      }
      await reportQueuedCommandError(harness, queued, {
        errorCode: "provider_rpc_error",
        errorMessage: "No active turn to steer",
      });

      const rejection = listEvents(harness.db, {
        threadId: thread.id,
      }).find((event) => event.type === "client/turn/rejected");
      expect(rejection).toBeDefined();
      expect(JSON.parse(rejection?.data ?? "{}")).toEqual({
        requestId: queued.command.requestId,
        reason: "provider_rpc_error",
        message: "No active turn to steer",
      });
      // A genuine provider failure still fails the run and queues nothing.
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "error",
      });
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
    });
  });

  it("keeps a busy-refused auto send: the thread stays active and the raw input is re-queued (#2370)", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedProviderThreadFixture({
        harness,
        status: "active",
        value: 10,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-send-dispatch-10",
        sequence: 3,
        threadId: thread.id,
        turnId: "turn-active",
      });
      const senderThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: thread.projectId,
        status: "active",
      });
      const activeThread = getThread(harness.db, thread.id);
      if (!activeThread) throw new Error("Expected an active thread");

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: textInput("status update from the worker"),
          mode: "auto",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          senderThreadId: senderThread.id,
          serviceTier: "default",
        },
        thread: activeThread,
        trigger: "user",
      });
      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "turn.submit" &&
          candidate.command.threadId === thread.id,
      );
      if (queued.command.type !== "turn.submit") {
        throw new Error("Expected a turn.submit command");
      }
      // The daemon could not take the input: the provider is mid-run and
      // refused it (pi while it compacts).
      await reportQueuedCommandError(harness, queued, {
        errorCode: "thread_turn_busy",
        errorMessage:
          "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.",
      });

      // The live turn keeps the thread active; no run failure, no error row.
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "active",
      });
      const eventTypes = listEvents(harness.db, { threadId: thread.id }).map(
        (event) => event.type,
      );
      expect(eventTypes).toContain("client/turn/rejected");
      expect(eventTypes).not.toContain("system/error");
      // The message waits in the queue with its original (un-enveloped)
      // text and its sender, so the drain delivers it exactly once, as the
      // agent-to-agent message it was.
      const requeued = listQueuedThreadMessages(harness.db, thread.id);
      expect(requeued).toHaveLength(1);
      expect(JSON.parse(requeued[0]!.content)).toEqual(
        textInput("status update from the worker"),
      );
      expect(requeued[0]).toMatchObject({
        senderThreadId: senderThread.id,
        model: "gpt-5",
        permissionMode: "full",
        reasoningLevel: "medium",
        serviceTier: "default",
      });
    });
  });

  it("restores a busy-refused queued auto-send at the head of the queue instead of failing the run (#2370)", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedProviderThreadFixture({ harness, value: 11 });
      const queuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("queued while idle"),
      });
      const queuedBehind = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("queued behind it"),
      });

      await sendQueuedMessage(harness.deps, {
        threadId: thread.id,
        queuedMessageId: queuedMessage.id,
        mode: "auto",
      });
      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "turn.submit" &&
          candidate.command.threadId === thread.id,
      );
      if (queued.command.type !== "turn.submit") {
        throw new Error("Expected a turn.submit command");
      }
      expect(queued.command.target).toEqual({ mode: "start" });
      // The server saw an idle thread, but the daemon still runs a turn on
      // it (a start whose turn/started is pending, or a provider mid-run).
      await reportQueuedCommandError(harness, queued, {
        errorCode: "thread_turn_busy",
        errorMessage:
          "Refusing to start a competing turn while the thread is still starting",
      });

      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "active",
      });
      const eventTypes = listEvents(harness.db, { threadId: thread.id }).map(
        (event) => event.type,
      );
      expect(eventTypes).not.toContain("system/error");
      // The same row is back where it was, ahead of what was queued behind
      // it, so the drain after the live turn delivers in the original order.
      const requeued = listQueuedThreadMessages(harness.db, thread.id);
      expect(requeued.map((row) => row.id)).toEqual([
        queuedMessage.id,
        queuedBehind.id,
      ]);
      expect(JSON.parse(requeued[0]!.content)).toEqual(
        textInput("queued while idle"),
      );
      expect(requeued[0]).toMatchObject({
        claimToken: null,
        claimedAt: null,
        senderThreadId: null,
      });
    });
  });

  it("holds a busy-refused parent system message for the live turn and delivers it once that turn is over (#2370)", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread: parent } = seedProviderThreadFixture({
        harness,
        status: "active",
        value: 12,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-send-dispatch-12",
        threadId: parent.id,
        turnId: "turn-live",
      });
      const child = seedThread(harness.deps, {
        environmentId: environment.id,
        parentThreadId: parent.id,
        projectId: parent.projectId,
        title: "Worker child",
      });
      const subject = {
        kind: "thread" as const,
        threadId: child.id,
        threadName: "Worker child",
      };

      expect(
        await queueParentSystemMessage(harness.deps, {
          input: textInput("[bb system] child completed"),
          parentThreadId: parent.id,
          systemMessageKind: "child-completed",
          systemMessageSubject: subject,
        }),
      ).toBe(true);
      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "turn.submit" &&
          candidate.command.threadId === parent.id,
      );
      if (queued.command.type !== "turn.submit") {
        throw new Error("Expected a turn.submit command");
      }
      expect(queued.command.target).toEqual({
        mode: "auto",
        expectedTurnId: "turn-live",
      });
      // The provider would not take the notice mid-run.
      await reportQueuedCommandError(harness, queued, {
        errorCode: "thread_turn_busy",
        errorMessage:
          "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.",
      });

      // The live turn keeps the thread active; the notice is held, with its
      // taxonomy, for the turn that refused it. Nothing went to the queue:
      // a queued row would deliver it as a user message.
      expect(getThread(harness.db, parent.id)).toMatchObject({
        status: "active",
      });
      expect(
        listEvents(harness.db, { threadId: parent.id }).map(
          (event) => event.type,
        ),
      ).not.toContain("system/error");
      expect(listQueuedThreadMessages(harness.db, parent.id)).toHaveLength(0);
      const held = listDeferredThreadMessages(harness.db, parent.id);
      expect(held).toHaveLength(1);
      expect(JSON.parse(held[0]!.payload)).toMatchObject({
        kind: "parent-system",
        systemMessageKind: "child-completed",
        systemMessageSubject: subject,
        heldForTurn: { activeTurnId: "turn-live" },
      });

      // A sweep while that turn is still live does not retry (one attempt
      // per turn, not one per tick).
      await flushDeferredThreadMessages(harness.deps, parent.id);
      expect(listDeferredThreadMessages(harness.db, parent.id)).toHaveLength(1);
      // No new dispatch went to the host (the refused one was already settled).
      expect(
        listQueuedThreadCommands(harness, "turn.submit", parent.id),
      ).toHaveLength(0);

      // The next turn opens: the notice steers into it and leaves the hold.
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-send-dispatch-12",
        threadId: parent.id,
        turnId: "turn-next",
      });
      await flushDeferredThreadMessages(harness.deps, parent.id);
      const commands = listQueuedThreadCommands(
        harness,
        "turn.submit",
        parent.id,
      );
      expect(commands).toHaveLength(1);
      const redelivered = commands[0]!;
      if (redelivered.type !== "turn.submit") {
        throw new Error("Expected a turn.submit command");
      }
      expect(redelivered.target).toEqual({
        mode: "auto",
        expectedTurnId: "turn-next",
      });
      expect(listDeferredThreadMessages(harness.db, parent.id)).toHaveLength(0);
      // The refused attempt and the redelivery, both as the system notice
      // they are (not as a user message).
      const notices = listEvents(harness.db, { threadId: parent.id })
        .filter((event) => event.type === "client/turn/requested")
        .map((event) => JSON.parse(event.data))
        .filter((request) => request.initiator === "system");
      expect(notices).toHaveLength(2);
      expect(notices[1]).toMatchObject({
        systemMessageKind: "child-completed",
        systemMessageSubject: subject,
      });
    });
  });

  it("restores a busy-refused queued group sent into an active thread at the head with its grouping (#2370)", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedProviderThreadFixture({
        harness,
        status: "active",
        value: 13,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-send-dispatch-13",
        threadId: thread.id,
        turnId: "turn-live",
      });
      const first = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("do X"),
      });
      const second = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("then Y"),
      });
      const third = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("queued behind the group"),
      });
      setQueuedThreadMessageGroupBoundary({
        db: harness.db,
        expectedGroupedPrefixQueuedMessageIds: [first.id, second.id],
        groupBoundaryQueuedMessageId: second.id,
        notifier: harness.hub,
        threadId: thread.id,
      });

      // "Send now" into the live turn: the queued path through
      // sendThreadMessage, not the idle fast path.
      await sendQueuedMessage(harness.deps, {
        threadId: thread.id,
        queuedMessageId: first.id,
        mode: "auto",
      });
      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "turn.submit" &&
          candidate.command.threadId === thread.id,
      );
      if (queued.command.type !== "turn.submit") {
        throw new Error("Expected a turn.submit command");
      }
      expect(queued.command.target).toEqual({
        mode: "auto",
        expectedTurnId: "turn-live",
      });
      expect(listQueuedThreadMessages(harness.db, thread.id).map((row) => row.id)).toEqual([third.id]);
      await reportQueuedCommandError(harness, queued, {
        errorCode: "thread_turn_busy",
        errorMessage:
          "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.",
      });

      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "active",
      });
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.type,
        ),
      ).not.toContain("system/error");
      // The same rows, grouped as before, ahead of what was queued behind
      // them: not one flattened row at the tail.
      const requeued = listQueuedThreadMessages(harness.db, thread.id);
      expect(
        requeued.map((row) => ({
          id: row.id,
          groupWithNext: row.groupWithNext,
          claimToken: row.claimToken,
        })),
      ).toEqual([
        { id: first.id, groupWithNext: true, claimToken: null },
        { id: second.id, groupWithNext: false, claimToken: null },
        { id: third.id, groupWithNext: false, claimToken: null },
      ]);
      expect(JSON.parse(requeued[0]!.content)).toEqual(textInput("do X"));
      expect(JSON.parse(requeued[1]!.content)).toEqual(textInput("then Y"));
    });
  });

  it("delivers a send deferred behind a held parent system message while that turn is still live (#2370)", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedProviderThreadFixture({
        harness,
        status: "active",
        value: 14,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-send-dispatch-14",
        threadId: thread.id,
        turnId: "turn-live",
      });
      const child = seedThread(harness.deps, {
        environmentId: environment.id,
        parentThreadId: thread.id,
        projectId: thread.projectId,
        title: "Worker child",
      });
      // A notice the live turn already refused, then a steer that waited on
      // a pending interaction (#1650) and is now free to go.
      deferThreadMessage(harness.deps, {
        payload: {
          kind: "parent-system",
          input: textInput("[bb system] child completed"),
          systemMessageKind: "child-completed",
          systemMessageSubject: {
            kind: "thread",
            threadId: child.id,
            threadName: "Worker child",
          },
          heldForTurn: { activeTurnId: "turn-live" },
        },
        reason: "turn-busy",
        threadId: thread.id,
      });
      deferThreadMessage(harness.deps, {
        payload: {
          kind: "send",
          request: {
            input: textInput("stop and use approach B"),
            mode: "steer",
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          },
        },
        reason: "pending-interaction",
        threadId: thread.id,
      });

      await flushDeferredThreadMessages(harness.deps, thread.id);

      // The held notice is skipped, not retried; the steer behind it is
      // delivered into the live turn rather than parked for its remainder.
      const commands = listQueuedThreadCommands(
        harness,
        "turn.submit",
        thread.id,
      );
      expect(commands).toHaveLength(1);
      const steered = commands[0]!;
      if (steered.type !== "turn.submit") {
        throw new Error("Expected a turn.submit command");
      }
      expect(steered.target).toEqual({
        mode: "steer",
        expectedTurnId: "turn-live",
      });
      expect(steered.input).toEqual(textInput("stop and use approach B"));
      const remaining = listDeferredThreadMessages(harness.db, thread.id);
      expect(remaining).toHaveLength(1);
      expect(JSON.parse(remaining[0]!.payload)).toMatchObject({
        kind: "parent-system",
        heldForTurn: { activeTurnId: "turn-live" },
      });
    });
  });

  it("records a rejection after the target turn completes", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedProviderThreadFixture({
        harness,
        status: "active",
        value: 8,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-send-dispatch-8",
        sequence: 3,
        threadId: thread.id,
        turnId: "turn-active",
      });
      const activeThread = getThread(harness.db, thread.id);
      if (!activeThread) throw new Error("Expected an active thread");

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: textInput("late failed steer"),
          mode: "steer",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread: activeThread,
        trigger: "user",
      });
      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "turn.submit" &&
          candidate.command.threadId === thread.id,
      );
      if (
        queued.command.type !== "turn.submit" ||
        queued.command.target.mode === "start" ||
        queued.command.target.expectedTurnId === null
      ) {
        throw new Error("Expected a turn.submit command with a target turn");
      }
      seedStoredEvent(harness.deps, {
        data: { status: "completed" },
        environmentId: environment.id,
        providerThreadId: "provider-send-dispatch-8",
        scope: turnScope(queued.command.target.expectedTurnId),
        sequence: 100,
        threadId: thread.id,
        type: "turn/completed",
      });
      await reportQueuedCommandError(harness, queued, {
        errorCode: "provider_rpc_error",
        errorMessage: "No active turn to steer",
      });

      const eventTypes = listEvents(harness.db, {
        threadId: thread.id,
      }).map((event) => event.type);
      expect(eventTypes).toContain("client/turn/rejected");
    });
  });

  it("does not reject an accepted client request", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedProviderThreadFixture({
        harness,
        status: "active",
        value: 9,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-send-dispatch-9",
        sequence: 3,
        threadId: thread.id,
        turnId: "turn-active",
      });
      const activeThread = getThread(harness.db, thread.id);
      if (!activeThread) throw new Error("Expected an active thread");

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: textInput("accepted steer"),
          mode: "steer",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread: activeThread,
        trigger: "user",
      });
      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "turn.submit" &&
          candidate.command.threadId === thread.id,
      );
      if (queued.command.type !== "turn.submit") {
        throw new Error("Expected a turn.submit command");
      }
      seedStoredEvent(harness.deps, {
        data: { clientRequestId: queued.command.requestId },
        environmentId: environment.id,
        providerThreadId: "provider-send-dispatch-9",
        scope: turnScope("turn-active"),
        sequence: 100,
        threadId: thread.id,
        type: "turn/input/accepted",
      });

      await reportQueuedCommandError(harness, queued, {
        errorCode: "provider_rpc_error",
        errorMessage: "Response arrived after acceptance",
      });

      const eventTypes = listEvents(harness.db, {
        threadId: thread.id,
      }).map((event) => event.type);
      expect(eventTypes).not.toContain("client/turn/rejected");
      expect(eventTypes).not.toContain("system/error");
    });
  });
});

describe("idle cold-start activation", () => {
  it("activates an idle thread immediately when it does a cold thread.start", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedColdIdleThreadFixture({
        harness,
        value: 3,
      });

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: textInput("cold start from idle"),
          mode: "start",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });

      // The dispatch IS the activation: an idle cold-start flips to `active`
      // synchronously on the dispatch transaction, before the daemon ever
      // reports run.started. (A turn.submit and an `error` cold-start
      // already did this; an `idle` cold-start now matches.)
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "active",
      });
      // A cold thread.start command (not a warm turn.submit) was dispatched.
      await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "thread.start" &&
          queued.command.threadId === thread.id,
      );
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toHaveLength(1);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
    });
  });

  it("resumes provider continuity after an environment directory update", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedProviderThreadFixture({
        harness,
        value: 4,
      });
      const targetEnvironment = seedEnvironment(harness.deps, {
        hostId: environment.hostId,
        projectId: environment.projectId,
        path: "/tmp/send-dispatch-switched",
        status: "ready",
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-send-dispatch-4",
        sequence: 3,
        threadId: thread.id,
        turnId: "turn_before_switch",
      });
      const updateResult = await handleUpdateEnvironmentDirectoryToolCall(
        harness.deps,
        {
          currentEnvironment: environment,
          input: { path: targetEnvironment.path },
          thread,
          turnId: "turn_before_switch",
        },
      );
      expect(updateResult).toMatchObject({ success: true });
      expect(getThread(harness.db, thread.id)).toMatchObject({
        environmentId: targetEnvironment.id,
      });
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        environmentId: targetEnvironment.id,
        providerThreadId: `provider-send-dispatch-4`,
        sequence: 5,
        type: "turn/completed",
        scope: turnScope("turn_after_switch"),
        data: {
          providerThreadId: `provider-send-dispatch-4`,
          status: "completed",
        },
      });
      const switchedThread = getThread(harness.db, thread.id);
      if (!switchedThread) {
        throw new Error("Expected switched thread to exist");
      }

      await sendThreadMessage(harness.deps, {
        environment: targetEnvironment,
        payload: {
          input: textInput("start after switch"),
          mode: "start",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread: switchedThread,
        trigger: "user",
      });

      await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "turn.submit" &&
          queued.command.threadId === thread.id,
      );
      const turnSubmitCommands = listQueuedThreadCommands(
        harness,
        "turn.submit",
        thread.id,
      );
      expect(turnSubmitCommands).toHaveLength(1);
      expect(turnSubmitCommands[0]).toMatchObject({
        type: "turn.submit",
        environmentId: targetEnvironment.id,
        resumeContext: {
          providerThreadId: "provider-send-dispatch-4",
          workspaceContext: {
            workspacePath: targetEnvironment.path,
          },
        },
      });
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toHaveLength(0);
    });
  });
});
