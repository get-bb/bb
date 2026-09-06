import { listQueuedThreadMessages } from "@bb/db";
import { turnScope } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  createTestDaemonEventEnvelope,
  internalAuthHeaders,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("internal turn/completed queue dispatch wake", () => {
  it("wakes queued message dispatch when a turn finishes with status interrupted and transitions to idle", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-interrupted-turn-wake",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "stopping",
      });

      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        sequence: 1,
        threadId: thread.id,
        turnId: "turn-interrupted-1",
      });

      seedQueuedMessage(harness.deps, {
        content: textInput("queued message waiting for thread to be idle"),
        threadId: thread.id,
        waitingOn: { kind: "thread-busy" },
      });

      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);

      const response = await harness.app.request("/internal/session/events", {
        method: "POST",
        headers: internalAuthHeaders(harness, { hostId: host.id }),
        body: JSON.stringify({
          sessionId: session.id,
          eventGroups: groupHostDaemonEvents([
            createTestDaemonEventEnvelope({
              threadId: thread.id,
              event: {
                type: "turn/completed",
                threadId: thread.id,
                providerThreadId: "provider-thread-1",
                scope: turnScope("turn-interrupted-1"),
                status: "interrupted",
              },
            }),
          ]),
        }),
      });

      expect(response.status).toBe(200);

      const command = await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "turn.submit" &&
          queued.command.threadId === thread.id,
      );

      expect(command.command.type).toBe("turn.submit");
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
    });
  });
});
