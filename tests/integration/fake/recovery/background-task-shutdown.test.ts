import { listEvents } from "@bb/db";
import { describe, expect, it } from "vitest";
import { sendTextMessage } from "../../helpers/api.js";
import {
  waitForHostDisconnected,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness, type IntegrationHarness } from "../../helpers/harness.js";
import {
  createRecoveryThread,
  HOST_OFFLINE_TIMEOUT_MS,
  RECOVERY_TEST_TIMEOUT_MS,
  TURN_TIMEOUT_MS,
} from "./shared.js";

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

describe.sequential("fake provider background task shutdown integration", () => {
  it(
    "records an idle thread's open background task as stopped when the daemon shuts down",
    () =>
      withHarness(async (harness) => {
        const { thread } = await createRecoveryThread(
          harness,
          "Background Task Shutdown",
        );
        await sendTextMessage(harness.api, thread.id, { text: "bg_task" });
        await waitForThreadStatus(
          harness.api,
          thread.id,
          "idle",
          TURN_TIMEOUT_MS,
        );
        expect(backgroundTaskStates(harness, thread.id)).toEqual([
          { type: "item/started", status: "pending", taskStatus: "running" },
        ]);

        await harness.shutdownDaemon("machine-shutdown");
        await waitForHostDisconnected(
          harness.api,
          harness.hostId,
          HOST_OFFLINE_TIMEOUT_MS,
        );

        expect(backgroundTaskStates(harness, thread.id)).toEqual([
          { type: "item/started", status: "pending", taskStatus: "running" },
          {
            type: "item/backgroundTask/completed",
            status: "interrupted",
            taskStatus: "stopped",
          },
        ]);
      }),
    RECOVERY_TEST_TIMEOUT_MS,
  );
});
