import { threads, listQueuedThreadMessages } from "@bb/db";
import { sendMessageResponseSchema } from "@bb/server-contract";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as environmentEngine from "../../src/services/environments/environment-engine.js";
import { resumeServerMoveDeferredWork } from "../../src/services/server-move/environment.js";
import { setServerMoveFrozen } from "../../src/services/server-move/freeze-state.js";
import { stopRunningServerWork } from "../../src/services/server-move/stop-work.js";
import {
  requestQueuedMessageDispatch,
  runQueuedMessageDispatch,
} from "../../src/services/threads/queued-message-dispatch.js";
import { onDaemonSocketOpen } from "../../src/ws/daemon-protocol.js";
import {
  listQueuedThreadCommands,
  registerTestHostRpcCapture,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedSession,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function queueOfflineFollowUp(harness: TestAppHarness) {
  const host = seedHost(harness.deps, { id: "host-frozen", name: "M5" });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/frozen-followup",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: "provider-frozen-followup",
  });
  const response = await harness.app.request(
    `/api/v1/threads/${thread.id}/send`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: [{ type: "text", text: "Continue later", mentions: [] }],
        mode: "steer-if-active",
        model: "gpt-5",
        permissionMode: "full",
        reasoningLevel: "medium",
        serviceTier: "default",
      }),
    },
  );
  expect(response.status).toBe(200);
  expect(
    sendMessageResponseSchema.parse(await readJson(response)),
  ).toMatchObject({ delivery: "queued" });
  return { host, thread };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("work while a server move is frozen", () => {
  it("holds queued dispatch and connect resumes while frozen, then releases them on unfreeze", () =>
    withTestHarness(async (harness) => {
      const { host, thread } = await queueOfflineFollowUp(harness);
      const resumeProvisioning = vi.spyOn(
        environmentEngine,
        "resumeEnvironmentProvisioningForHost",
      );
      setServerMoveFrozen(harness.db, true);
      try {
        const session = seedSession(harness.deps, host.id);
        onDaemonSocketOpen(harness.deps, {
          hostId: host.id,
          sessionId: session.id,
          socket: registerTestHostRpcCapture(harness.deps, {
            hostId: host.id,
            sessionId: session.id,
          }),
        });
        requestQueuedMessageDispatch(harness.deps, {
          kind: "host-connected",
          hostId: host.id,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        expect(
          listQueuedThreadCommands(harness, "turn.submit", thread.id),
        ).toEqual([]);
        await runQueuedMessageDispatch(harness.deps, {
          kind: "host-connected",
          hostId: host.id,
        });

        expect(
          listQueuedThreadCommands(harness, "turn.submit", thread.id),
        ).toEqual([]);
        expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
        expect(resumeProvisioning).not.toHaveBeenCalled();
      } finally {
        setServerMoveFrozen(harness.db, false);
      }

      resumeServerMoveDeferredWork(harness.deps);
      expect(resumeProvisioning).toHaveBeenCalledWith(harness.deps, {
        hostId: host.id,
      });

      const dispatched = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === thread.id,
      );
      expect(dispatched.command.type).toBe("turn.submit");
    }));

  it("keeps stopping turns that start while running work is being stopped", () =>
    withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-stop-loop",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const first = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      const late = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      const stopped: string[] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          if (command.type !== "thread.stop") {
            throw new Error(`Unexpected command: ${command.type}`);
          }
          stopped.push(command.threadId);
          if (command.threadId === first.id) {
            harness.db
              .update(threads)
              .set({ status: "active" })
              .where(eq(threads.id, late.id))
              .run();
          }
          return { ok: true, result: { providerCheckpointId: null } };
        },
      });

      await stopRunningServerWork(harness.deps, {
        pollMs: 10,
        targetHostName: "Desktop",
        timeoutMs: 2_000,
      });

      expect(stopped).toEqual([first.id, late.id]);
    }));
});
