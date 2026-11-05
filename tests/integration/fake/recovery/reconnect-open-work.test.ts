import { listEvents } from "@bb/db";
import { isUserQuestionPendingInteraction } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import {
  getThread,
  listThreadInteractions,
  sendTextMessage,
} from "../../helpers/api.js";
import {
  waitForThreadOutputContaining,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness, type IntegrationHarness } from "../../helpers/harness.js";
import { recordScriptedEchoProcesses } from "../../helpers/scripted-echo.js";
import {
  createRecoveryThread,
  RECOVERY_TEST_TIMEOUT_MS,
  RECOVERY_TIMEOUT_MS,
  requireSessionId,
  TURN_TIMEOUT_MS,
} from "./shared.js";

function dropDaemonSocket(harness: IntegrationHarness): string {
  const sessionId = requireSessionId(harness);
  harness.hub.closeDaemonSessionSocket(sessionId, "daemon-disconnect");
  return sessionId;
}

async function waitForSameDaemonToReconnect(
  harness: IntegrationHarness,
  droppedSessionId: string,
): Promise<void> {
  await vi.waitFor(
    () => {
      const sessionId = harness.daemonApp.connection.sessionId;
      expect(sessionId).not.toBeNull();
      expect(sessionId).not.toBe(droppedSessionId);
    },
    { timeout: RECOVERY_TIMEOUT_MS, interval: 100 },
  );
}

function backgroundTaskStates(harness: IntegrationHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).flatMap((row) => {
    if (row.itemKind !== "backgroundTask") {
      return [];
    }
    const { item } = JSON.parse(row.data) as {
      item: { status: string; taskStatus: string };
    };
    return [
      { type: row.type, status: item.status, taskStatus: item.taskStatus },
    ];
  });
}

describe.sequential("fake provider reconnect open-work integration", () => {
  it(
    "ends the provider's wait on a question the server closed while the same daemon was away, so later messages run",
    () =>
      withHarness(async (harness) => {
        const { thread } = await createRecoveryThread(
          harness,
          "Reconnect Closed Question",
        );
        await sendTextMessage(harness.api, thread.id, { text: "ask_user" });
        const question = await vi.waitFor(
          async () => {
            const interaction = (
              await listThreadInteractions(harness.api, thread.id)
            ).find(isUserQuestionPendingInteraction);
            expect(interaction?.status).toBe("pending");
            return interaction;
          },
          { timeout: TURN_TIMEOUT_MS, interval: 100 },
        );
        expect(question).toBeDefined();

        const droppedSessionId = dropDaemonSocket(harness);
        harness.server.pendingInteractions.interruptPendingInteractionsForThreadIds(
          {
            threadIds: [thread.id],
            reason: "The answer could not be delivered",
          },
        );
        await waitForSameDaemonToReconnect(harness, droppedSessionId);

        await vi.waitFor(
          async () => {
            expect((await getThread(harness.api, thread.id)).status).not.toBe(
              "active",
            );
          },
          { timeout: TURN_TIMEOUT_MS, interval: 100 },
        );
        await sendTextMessage(harness.api, thread.id, {
          text: "after the closed question",
        });
        await waitForThreadOutputContaining(
          harness.api,
          thread.id,
          "Response to: after the closed question",
          TURN_TIMEOUT_MS,
        );
      }),
    RECOVERY_TEST_TIMEOUT_MS,
  );

  it(
    "settles a background task when its provider process dies and keeps one settlement after the same daemon reconnects",
    async () => {
      const processes = await recordScriptedEchoProcesses();
      try {
        await withHarness(async (harness) => {
          const { thread } = await createRecoveryThread(
            harness,
            "Reconnect Dead Task Owner",
          );
          await sendTextMessage(harness.api, thread.id, { text: "bg_task" });
          await waitForThreadStatus(
            harness.api,
            thread.id,
            "idle",
            TURN_TIMEOUT_MS,
          );
          const ownerPid = await processes.backgroundTaskOwnerPid(thread.id);
          if (ownerPid === null) {
            throw new Error("Expected the scripted bridge to log its pid");
          }
          const settledStates = [
            { type: "item/started", status: "pending", taskStatus: "running" },
            {
              type: "item/backgroundTask/completed",
              status: "interrupted",
              taskStatus: "stopped",
            },
          ];

          process.kill(ownerPid, "SIGKILL");
          await vi.waitFor(
            () =>
              expect(backgroundTaskStates(harness, thread.id)).toEqual(
                settledStates,
              ),
            { timeout: TURN_TIMEOUT_MS, interval: 50 },
          );

          const droppedSessionId = dropDaemonSocket(harness);
          await waitForSameDaemonToReconnect(harness, droppedSessionId);
          await sendTextMessage(harness.api, thread.id, {
            text: "after the reconnect",
          });
          await waitForThreadOutputContaining(
            harness.api,
            thread.id,
            "Response to: after the reconnect",
            TURN_TIMEOUT_MS,
          );

          expect(backgroundTaskStates(harness, thread.id)).toEqual(
            settledStates,
          );
        });
      } finally {
        await processes.dispose();
      }
    },
    RECOVERY_TEST_TIMEOUT_MS,
  );
});
