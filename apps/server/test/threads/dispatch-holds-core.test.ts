import { eq } from "drizzle-orm";
import { environments, getThread, listDispatchHolds, listEvents } from "@bb/db";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  cancelDispatchHold,
  releaseDispatchHoldFromRequest,
} from "../../src/services/threads/dispatch-hold-release.js";
import { runDueDispatchHoldSweep } from "../../src/services/threads/dispatch-hold-sweeps.js";
import {
  listLiveThreadDispatchHolds,
  toDispatchHoldResponse,
} from "../../src/services/threads/dispatch-holds.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { getActiveThreadProvisionContext } from "../../src/services/threads/thread-provisioning-active-context.js";
import { onDaemonSocketOpen } from "../../src/ws/daemon-protocol.js";
import {
  listQueuedThreadCommands,
  registerTestHostRpcCapture,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
  type QueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/core-dispatch-holds";

/**
 * A managed worktree whose workspace is gone: the exact state a send has to
 * rebuild before it can run, and therefore the state that parks a turn.
 */
function seedReprovisionFixture(harness: TestAppHarness, hostId: string) {
  const { host, session } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
    status: "error",
    managed: true,
    workspaceProvisionType: "managed-worktree",
  });
  harness.db
    .update(environments)
    .set({ path: null, updatedAt: Date.now() })
    .where(eq(environments.id, environment.id))
    .run();
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  return { environment, host, project, session, thread };
}

/** A ready unmanaged workspace whose host can be disconnected at will. */
function seedReadyFixture(harness: TestAppHarness, hostId: string) {
  const { host, session } = seedHostSession(harness.deps, { id: hostId });
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
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  return { environment, host, project, session, thread };
}

function turnRequestCount(harness: TestAppHarness, threadId: string): number {
  return listEvents(harness.db, { threadId }).filter(
    (event) => event.type === "client/turn/requested",
  ).length;
}

describe("core:reprovision holds", () => {
  it("parks the turn as a live hold and settles it when the workspace is ready", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedReprovisionFixture(
        harness,
        "host-core-reprovision",
      );

      const sent = await acceptThreadSendRequest(harness.deps, {
        payload: {
          input: textInput("resume after restore"),
          mode: "auto",
          model: "gpt-5",
        },
        thread,
      });
      expect(sent.delivery).toBe("sent");

      // The turn is persisted but parked: the workspace it needs does not
      // exist yet, and the hold is what makes that wait visible.
      const holds = listLiveThreadDispatchHolds(harness.deps, thread.id);
      expect(holds).toHaveLength(1);
      expect(holds[0]?.holder).toBe("core:reprovision");
      expect(holds[0]?.userReleasable).toBe(false);
      expect(holds[0]?.resumeAt).toBeNull();
      expect(holds[0]?.reason).toBe("Waiting for workspace to be ready");
      // The turn this hold tracks is already persisted as a deferred turn
      // request, so the card must not offer an edit the server would refuse.
      const response = toDispatchHoldResponse(holds[0]!);
      expect(
        response.payload.kind === "inline" && response.payload.editable,
      ).toBe(false);
      expect(getThread(harness.db, thread.id)?.status).toBe("starting");
      expect(turnRequestCount(harness, thread.id)).toBe(1);

      const provision = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environment.id,
      );
      let start: QueuedCommand | null = null;
      try {
        await reportQueuedCommandSuccess(harness, provision, {
          path: WORKSPACE_PATH,
          branchName: `bb/${thread.id}`,
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: true,
          transcript: [],
        });
        start = await waitForQueuedCommandAfter(
          harness,
          provision.row.cursor,
          ({ command }) =>
            command.type === "thread.start" && command.threadId === thread.id,
        );

        // The deferred turn replayed exactly once, and the hold that tracked
        // the wait closed as released rather than cancelled.
        expect(turnRequestCount(harness, thread.id)).toBe(1);
        expect(
          listQueuedThreadCommands(harness, "thread.start", thread.id),
        ).toHaveLength(1);
        expect(listLiveThreadDispatchHolds(harness.deps, thread.id)).toEqual(
          [],
        );
        const settled = listDispatchHolds(harness.db, { threadId: thread.id });
        expect(settled).toHaveLength(1);
        expect(settled[0]?.releaseKind).toBe("owner");
        expect(settled[0]?.releasedAt).not.toBeNull();
      } finally {
        if (start !== null) {
          await reportQueuedCommandError(harness, start, {
            errorCode: "test_live_start_cleanup",
            errorMessage: "Test settled live thread start",
          });
        }
      }
    });
  });

  it("drops the parked turn when the hold is cancelled", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedReprovisionFixture(
        harness,
        "host-core-reprovision-cancel",
      );
      await acceptThreadSendRequest(harness.deps, {
        payload: {
          input: textInput("resume after restore"),
          mode: "auto",
          model: "gpt-5",
        },
        thread,
      });
      const provision = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environment.id,
      );
      const hold = listLiveThreadDispatchHolds(harness.deps, thread.id)[0]!;

      const cancelled = await cancelDispatchHold(harness.deps, hold);

      expect(cancelled.releaseKind).toBe("cancelled");
      expect(listLiveThreadDispatchHolds(harness.deps, thread.id)).toEqual([]);
      // Nothing can replay the parked turn any more: the provisioning context
      // is gone and the thread has left `starting`.
      expect(getActiveThreadProvisionContext(thread.id)).toBeNull();
      expect(getThread(harness.db, thread.id)?.status).not.toBe("starting");
      await waitForQueuedCommandAfter(
        harness,
        provision.row.cursor,
        ({ command }) =>
          command.type === "environment.provision.cancel" &&
          command.environmentId === environment.id,
      );
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toEqual([]);
    });
  });
});

describe("core:host-offline holds", () => {
  it("re-parks a due timer release onto a disconnected host and dispatches on reconnect", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedReadyFixture(
        harness,
        "host-core-offline",
      );
      await acceptThreadSendRequest(harness.deps, {
        payload: {
          holdUntil: Date.now() - 1_000,
          input: textInput("send when you can"),
          mode: "queue-if-active",
          model: "gpt-5",
        },
        thread,
      });
      harness.deps.hub.unregisterDaemon(session.id);

      await runDueDispatchHoldSweep(harness.deps, Date.now());

      // The timer fired and the dispatch failed, but the turn is not lost: it
      // moved into a new hold that names what it is waiting for.
      const settled = listDispatchHolds(harness.db, { threadId: thread.id });
      expect(settled.map((row) => row.releaseKind)).toContain("timer");
      const parked = listLiveThreadDispatchHolds(harness.deps, thread.id);
      expect(parked).toHaveLength(1);
      expect(parked[0]?.holder).toBe("core:host-offline");
      expect(parked[0]?.userReleasable).toBe(false);
      expect(parked[0]?.reason).toBe("Waiting for Test Host to reconnect");
      expect(turnRequestCount(harness, thread.id)).toBe(0);

      const socket = registerTestHostRpcCapture(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });
      onDaemonSocketOpen(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
        socket,
      });

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      try {
        expect(listLiveThreadDispatchHolds(harness.deps, thread.id)).toEqual(
          [],
        );
        expect(
          listDispatchHolds(harness.db, { threadId: thread.id }).map(
            (row) => row.releaseKind,
          ),
        ).toEqual(["timer", "owner"]);
        expect(turnRequestCount(harness, thread.id)).toBe(1);
      } finally {
        await reportQueuedCommandError(harness, start, {
          errorCode: "test_live_start_cleanup",
          errorMessage: "Test settled live thread start",
        });
      }
    });
  });

  it("fails an interactive send to a disconnected host without creating a hold", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedReadyFixture(
        harness,
        "host-core-offline-interactive",
      );
      harness.deps.hub.unregisterDaemon(session.id);

      const error = await acceptThreadSendRequest(harness.deps, {
        payload: {
          input: textInput("send now"),
          mode: "auto",
          model: "gpt-5",
        },
        thread,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      if (!(error instanceof ApiError)) {
        throw new Error("Expected an ApiError");
      }
      expect(error.status).toBe(502);
      expect(error.body.code).toBe("host_unavailable");
      expect(listDispatchHolds(harness.db, { threadId: thread.id })).toEqual(
        [],
      );
    });
  });

  it("keeps a user 'Release now' onto a disconnected host loud", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedReadyFixture(
        harness,
        "host-core-offline-release-now",
      );
      await acceptThreadSendRequest(harness.deps, {
        payload: {
          holdUntil: Date.now() + 60_000,
          input: textInput("send later"),
          mode: "queue-if-active",
          model: "gpt-5",
        },
        thread,
      });
      const hold = listLiveThreadDispatchHolds(harness.deps, thread.id)[0]!;
      harness.deps.hub.unregisterDaemon(session.id);

      const error = await releaseDispatchHoldFromRequest(harness.deps, {
        hold,
        releaseKind: "user",
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      // The user is watching, so they get the failure instead of a silent
      // re-park; only background releases wait for the host.
      expect(
        listDispatchHolds(harness.db, {
          threadId: thread.id,
          holder: "core:host-offline",
        }),
      ).toEqual([]);
    });
  });
});
