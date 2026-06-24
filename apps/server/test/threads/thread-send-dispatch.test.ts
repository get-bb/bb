import {
  archiveThread,
  getQueuedThreadMessage,
  getThread,
  listQueuedThreadMessages,
  markThreadDeleted,
  updateThread,
} from "@bb/db";
import {
  threadScope,
  turnScope,
  type Environment,
  type Thread,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { sendQueuedMessage } from "../../src/services/threads/queued-messages.js";
import { sendThreadMessage } from "../../src/services/threads/thread-send.js";
import { listQueuedThreadCommands } from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedStoredEvent,
  seedThread,
  seedThreadRuntimeState,
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

/**
 * Seeds a ready environment + an `idle` thread with a live provider session
 * (a stored provider-thread-id, so `getLastProviderThreadId` resolves) so a
 * queued-message auto-send takes the warm idle-provider fast path.
 */
function seedIdleProviderThreadFixture(
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

describe("queued message dispatch gate", () => {
  it("rolls back and sends no host command when the idle thread was archived between claim and dispatch", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedIdleProviderThreadFixture({ harness, value: 1 });
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
      const { thread } = seedIdleProviderThreadFixture({ harness, value: 2 });
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
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toHaveLength(1);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
    });
  });

  it("cold-starts after an environment directory update resets provider continuity", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedIdleProviderThreadFixture({
        harness,
        value: 4,
      });
      const targetEnvironment = seedEnvironment(harness.deps, {
        hostId: environment.hostId,
        projectId: environment.projectId,
        path: "/tmp/send-dispatch-switched",
        status: "ready",
      });
      updateThread(harness.db, harness.hub, thread.id, {
        environmentId: targetEnvironment.id,
      });
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        environmentId: targetEnvironment.id,
        sequence: 3,
        type: "system/operation",
        scope: threadScope(),
        data: {
          operation: "environment_directory_update",
          operationId: "evt_send_dispatch_switch",
          status: "completed",
          message: "Updated environment directory",
          metadata: {
            nextEnvironmentId: targetEnvironment.id,
            nextPath: targetEnvironment.path,
            previousEnvironmentId: environment.id,
            previousPath: environment.path,
          },
        },
      });
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        environmentId: targetEnvironment.id,
        providerThreadId: `provider-send-dispatch-4`,
        sequence: 4,
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

      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toHaveLength(1);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
    });
  });
});
