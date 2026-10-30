import {
  claimQueuedThreadMessageGroup,
  getQueuedThreadMessage,
  getThread,
  listEvents,
} from "@bb/db";
import {
  threadQueuedMessageSchema,
  turnRequestEventDataSchema,
  type ThreadQueuedMessage,
  type TurnRequestEventData,
} from "@bb/domain";
import type {
  MessageDispatchHookContext,
  PluginHookName,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  invokePluginInline,
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { setPluginThreadEventEmitter } from "../../src/services/plugins/plugin-thread-events.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/queued-message-send-time";
const HOUR_MS = 3_600_000;

type HookRegistry = {
  [K in PluginHookName]: PluginHookRegistration<K>[];
};

afterEach(() => {
  setPluginHookProvider(undefined);
  setPluginThreadEventEmitter(undefined);
});

function recordDispatchHookCalls(): string[][] {
  const calls: string[][] = [];
  const registry: HookRegistry = {
    "message.dispatch": [
      {
        pluginId: "send-time-test",
        handler: (context: MessageDispatchHookContext) => {
          calls.push(context.queuedMessages.map((row) => row.id));
          return { action: "proceed" };
        },
      },
    ],
  };
  setPluginHookProvider({
    listHooks: (hook) => registry[hook],
    invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
  return calls;
}

function recordQueuedAnnouncements(): ThreadQueuedMessage[] {
  const announced: ThreadQueuedMessage[] = [];
  setPluginThreadEventEmitter({
    emitThreadEvents: () => {},
    emitTerminalInput: () => {},
    emitHostDeleted: () => {},
    emitEnvironmentRemoved: () => {},
    emitThreadCreated: () => {},
    emitThreadActive: () => {},
    emitThreadIdle: () => {},
    emitThreadFailed: () => {},
    emitThreadArchived: () => {},
    emitThreadDeleted: () => {},
    emitInteractionPending: () => {},
    emitMessageQueued: (entry) => announced.push(entry),
    emitMessageDispatched: () => {},
    emitMessageCancelled: () => {},
    emitThreadUnarchived: () => {},
    emitThreadParentChanged: () => {},
    emitTurnFailed: () => {},
  });
  return announced;
}

function seedIdleThread(harness: TestAppHarness, hostId: string) {
  const { host } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: `provider-${hostId}`,
    threadId: thread.id,
  });
  return thread;
}

async function scheduleMessage(
  harness: TestAppHarness,
  threadId: string,
  text: string,
  sendAt: number,
): Promise<ThreadQueuedMessage> {
  const thread = getThread(harness.db, threadId);
  if (!thread) throw new Error("expected a thread");
  const response = await acceptThreadSendRequest(harness.deps, {
    payload: { input: textInput(text), mode: "auto", sendAt },
    thread,
  });
  if (response.delivery !== "queued") throw new Error("expected a queued row");
  return response.queuedMessage;
}

function updateQueuedMessage(
  harness: TestAppHarness,
  row: { id: string; threadId: string },
  body: Record<string, unknown>,
) {
  return harness.app.request(
    `/api/v1/threads/${row.threadId}/queued-messages/${row.id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function turnRequestTexts(
  harness: TestAppHarness,
  threadId: string,
): string[] {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "client/turn/requested")
    .map((event): TurnRequestEventData =>
      turnRequestEventDataSchema.parse(JSON.parse(event.data)),
    )
    .map((request) => {
      const first = request.input[0];
      return first?.type === "text" ? first.text : "";
    });
}

describe("changing when a queued message sends", () => {
  it("dispatches a row moved earlier at its new time, through the dispatch hooks", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedIdleThread(harness, "host-send-time-earlier");
      const now = Date.now();
      const row = await scheduleMessage(harness, thread.id, "Later", now + HOUR_MS);
      const announced = recordQueuedAnnouncements();
      const hookCalls = recordDispatchHookCalls();
      const newSendAt = now + 60_000;

      const response = await updateQueuedMessage(harness, row, {
        expectedUpdatedAt: row.updatedAt,
        sendAt: newSendAt,
      });

      expect(response.status).toBe(200);
      const updated = threadQueuedMessageSchema.parse(await readJson(response));
      expect(updated).toMatchObject({
        content: row.content,
        sendAt: newSendAt,
        state: "scheduled",
        waitingOn: { kind: "time" },
      });
      expect(announced.map((entry) => [entry.id, entry.sendAt])).toEqual([
        [row.id, newSendAt],
      ]);

      await runQueuedMessageDispatch(harness.deps, {
        kind: "time-reached",
        now: newSendAt - 1,
      });
      expect(turnRequestTexts(harness, thread.id)).not.toContain("Later");

      await runQueuedMessageDispatch(harness.deps, {
        kind: "time-reached",
        now: newSendAt + 1,
      });
      expect(turnRequestTexts(harness, thread.id)).toContain("Later");
      expect(hookCalls).toEqual([[row.id]]);
      expect(getQueuedThreadMessage(harness.db, row.id)).toBeNull();
    });
  });

  it("keeps a user's edit hold when only the time changes", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedIdleThread(harness, "host-send-time-held");
      const now = Date.now();
      const row = await scheduleMessage(harness, thread.id, "Held", now + HOUR_MS);
      const hold = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${row.id}/edit-hold`,
        { method: "POST" },
      );
      expect(hold.status).toBe(200);
      const heldUntil = getQueuedThreadMessage(harness.db, row.id)?.editHeldUntil;
      expect(heldUntil).not.toBeNull();

      const response = await updateQueuedMessage(harness, row, {
        expectedUpdatedAt: row.updatedAt,
        sendAt: now + 60_000,
      });
      expect(response.status).toBe(200);
      expect(getQueuedThreadMessage(harness.db, row.id)?.editHeldUntil).toBe(
        heldUntil,
      );

      await runQueuedMessageDispatch(harness.deps, {
        kind: "time-reached",
        now: now + 120_000,
      });
      expect(turnRequestTexts(harness, thread.id)).not.toContain("Held");
      expect(getQueuedThreadMessage(harness.db, row.id)).not.toBeNull();
    });
  });

  it("sends a row whose time is cleared once nothing else holds it", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedIdleThread(harness, "host-send-time-clear");
      const row = await scheduleMessage(
        harness,
        thread.id,
        "Whenever",
        Date.now() + HOUR_MS,
      );

      const response = await updateQueuedMessage(harness, row, {
        expectedUpdatedAt: row.updatedAt,
        sendAt: null,
      });

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        sendAt: null,
        waitingOn: null,
      });
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === thread.id,
      );
      expect(turnRequestTexts(harness, thread.id)).toContain("Whenever");
    });
  });

  it("refuses a time that has passed, an empty change, a claimed row and a stale version", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedIdleThread(harness, "host-send-time-refusals");
      const sendAt = Date.now() + HOUR_MS;
      const row = await scheduleMessage(harness, thread.id, "Pinned", sendAt);
      const claimed = await scheduleMessage(harness, thread.id, "Going", sendAt);

      const past = await updateQueuedMessage(harness, row, {
        expectedUpdatedAt: row.updatedAt,
        sendAt: Date.now() - 1_000,
      });
      expect(past.status).toBe(400);

      const empty = await updateQueuedMessage(harness, row, {
        expectedUpdatedAt: row.updatedAt,
      });
      expect(empty.status).toBe(400);

      claimQueuedThreadMessageGroup(harness.db, harness.hub, claimed.id, {
        kind: "explicit-send",
      });
      const claimedResponse = await updateQueuedMessage(harness, claimed, {
        expectedUpdatedAt: claimed.updatedAt,
        sendAt: sendAt - 60_000,
      });
      expect(claimedResponse.status).toBe(409);
      await expect(readJson(claimedResponse)).resolves.toMatchObject({
        message: "Queued message is already being sent",
      });

      const moved = await updateQueuedMessage(harness, row, {
        expectedUpdatedAt: row.updatedAt,
        sendAt: sendAt + 60_000,
      });
      expect(moved.status).toBe(200);
      const stale = await updateQueuedMessage(harness, row, {
        expectedUpdatedAt: row.updatedAt,
        sendAt: sendAt - 60_000,
      });
      expect(stale.status).toBe(409);
      await expect(readJson(stale)).resolves.toMatchObject({
        message: "Queued message changed since editing began",
      });
      expect(getQueuedThreadMessage(harness.db, row.id)?.sendAt).toBe(
        sendAt + 60_000,
      );
    });
  });
});
