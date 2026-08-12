import {
  archiveThread,
  getQueuedThreadMessage,
  getThread,
  listEvents,
  listQueuedThreadMessages,
  markThreadDeleted,
} from "@bb/db";
import { turnScope, type Environment, type Thread } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import type { TelemetryService } from "../../src/services/system/telemetry.js";
import { sendQueuedMessage } from "../../src/services/threads/queued-messages.js";
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
