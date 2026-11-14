import { getThread } from "@bb/db";
import { listEvents } from "@bb/db/testing";
import { turnScope, type ResolvedThreadExecutionOptions } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  requestThreadStopForCurrentState,
  stopThreadForCurrentState,
} from "../../src/services/threads/thread-lifecycle.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
} from "../../src/services/threads/thread-provisioning.js";
import {
  internalAuthHeaders,
  listQueuedThreadCommands,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const EXECUTION = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "accept-edits",
  source: "client/turn/requested",
} satisfies ResolvedThreadExecutionOptions;

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("repeated stops", () => {
  it("records one provisioning cancellation however often a provisioning thread is stopped", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-stop-races-1" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/stop-races-1",
        status: "provisioning",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "starting",
      });
      requestThreadProvision(harness.deps, {
        originPluginId: null,
        author: { initiator: "user", senderThreadId: null },
        thread,
        environmentIntent: { type: "reuse", environmentId: environment.id },
        execution: EXECUTION,
        fork: null,
        input: textInput("x"),
        startedOnBehalfOf: null,
        titleProvided: true,
      });
      await advanceThreadProvisioning(harness.deps, { threadId: thread.id });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        requestThreadStopForCurrentState(harness.deps, thread);
        await settle();
      }

      expect(
        listEvents(harness.db, { threadId: thread.id }).filter(
          (event) =>
            event.type === "system/thread-provisioning" &&
            JSON.parse(String(event.data)).status === "cancelled",
        ),
      ).toHaveLength(1);
    });
  });

  it("does not let a late turn start revive a thread stopped twice before its turn began", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-stop-races-2",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/stop-races-2",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/stop-races-2",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      requestThreadStopForCurrentState(harness.deps, thread);
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      requestThreadStopForCurrentState(harness.deps, thread);
      await settle();
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");

      const response = await harness.app.request("/internal/session/events", {
        method: "POST",
        headers: internalAuthHeaders(harness, { hostId: host.id }),
        body: JSON.stringify({
          sessionId: session.id,
          eventGroups: groupHostDaemonEvents([
            {
              threadId: thread.id,
              event: {
                type: "turn/started",
                threadId: thread.id,
                providerThreadId: "provider-stop-races-2",
                scope: turnScope("turn-late"),
              },
            },
          ]),
        }),
      });
      expect(response.status).toBe(200);
      await settle();

      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(
        listQueuedThreadCommands(harness, "thread.stop", thread.id),
      ).toHaveLength(2);
    });
  });

  it("settles an awaited stop of a live thread that has no environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-stop-races-3" });
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "active",
      });

      await stopThreadForCurrentState(harness.deps, thread, null);

      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
    });
  });
});
