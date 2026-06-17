import { eq } from "drizzle-orm";
import { environments, getEnvironment, getThread, listEvents } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  type ResolvedThreadExecutionOptions,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { runThreadLifecycleSweep } from "../../src/services/system/periodic-sweeps.js";
import {
  appendThreadProvisioningEvent,
  buildCwdBranchEntries,
} from "../../src/services/threads/thread-events.js";
import { rememberActiveThreadProvisionContext } from "../../src/services/threads/thread-provisioning-active-context.js";
import {
  createEnvironmentAttachedContext,
  createEnvironmentPendingContext,
  createMetadataPendingContext,
  createWorkspaceReadyContext,
} from "../../src/services/threads/thread-provisioning-context.js";
import { advanceThreadProvisioning } from "../../src/services/threads/thread-provisioning.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
  type QueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const THREAD_START_EXECUTION = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "workspace-write",
  source: "client/turn/requested",
} satisfies ResolvedThreadExecutionOptions;

describe("thread provisioning recovery", () => {
  it("marks workspace-ready thread starts interrupted instead of reissuing RPC after restart", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-start-recovery",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-start-recovery",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "starting",
      });
      appendThreadProvisioningEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        provisioningId: "tpv_thread_start_recovery",
        status: "active",
        entries: buildCwdBranchEntries({
          path: "/tmp/thread-start-recovery",
          branchName: null,
        }),
      });

      await runThreadLifecycleSweep(harness.deps);

      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toEqual([]);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "error",
      });
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.type,
        ),
      ).toEqual(["system/thread-provisioning", "system/error"]);
    });
  });

  it("does not record a restart error while same-process workspace-ready provisioning is still live", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-live-thread-start-recovery",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/live-thread-start-recovery",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "starting",
      });
      const requestedContext = createMetadataPendingContext({
        clientRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
        environmentIntent: {
          type: "reuse",
          environmentId: environment.id,
        },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input: textInput("start after workspace ready"),
        titleProvided: true,
        seedWithoutRun: false,
      });
      const attachedContext = createEnvironmentAttachedContext(
        createEnvironmentPendingContext(requestedContext, { branchSlug: null }),
        { attachedEnvironmentId: environment.id },
      );
      const workspaceReadyEventSequence = appendThreadProvisioningEvent(
        harness.deps,
        {
          threadId: thread.id,
          environmentId: environment.id,
          provisioningId: attachedContext.state.provisioningId,
          status: "active",
          entries: buildCwdBranchEntries({
            path: "/tmp/live-thread-start-recovery",
            branchName: null,
          }),
        },
      );
      rememberActiveThreadProvisionContext({
        threadId: thread.id,
        context: createWorkspaceReadyContext(attachedContext, {
          workspaceReadyEventSequence,
        }),
      });

      let startCommand: QueuedCommand | null = null;
      try {
        await runThreadLifecycleSweep(harness.deps);
        startCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.start" && command.threadId === thread.id,
        );

        expect(getThread(harness.db, thread.id)?.status).not.toBe("error");
        expect(
          listEvents(harness.db, { threadId: thread.id }).map(
            (event) => event.type,
          ),
        ).not.toContain("system/error");
      } finally {
        if (startCommand !== null) {
          await reportQueuedCommandError(harness, startCommand, {
            errorCode: "test_live_start_cleanup",
            errorMessage: "Test settled live thread start",
          });
        }
      }
    });
  });

  it("does not fail an already active thread when provisioning is advanced again", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-late-provisioning-advance",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/late-provisioning-advance",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      appendThreadProvisioningEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        provisioningId: "tpv_late_provisioning_advance",
        status: "completed",
        entries: [],
      });

      await advanceThreadProvisioning(harness.deps, {
        threadId: thread.id,
      });

      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "active",
      });
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.type,
        ),
      ).toEqual(["system/thread-provisioning"]);
    });
  });

  it("does not fail a thread start that settled before the first turn started event", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-settled-start-before-turn",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/settled-start-before-turn",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "starting",
      });
      const requestedContext = createMetadataPendingContext({
        clientRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
        environmentIntent: {
          type: "reuse",
          environmentId: environment.id,
        },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input: textInput("start before first turn event"),
        titleProvided: true,
        seedWithoutRun: false,
      });
      const attachedContext = createEnvironmentAttachedContext(
        createEnvironmentPendingContext(requestedContext, { branchSlug: null }),
        { attachedEnvironmentId: environment.id },
      );
      const workspaceReadyEventSequence = appendThreadProvisioningEvent(
        harness.deps,
        {
          threadId: thread.id,
          environmentId: environment.id,
          provisioningId: attachedContext.state.provisioningId,
          status: "active",
          entries: buildCwdBranchEntries({
            path: "/tmp/settled-start-before-turn",
            branchName: null,
          }),
        },
      );
      rememberActiveThreadProvisionContext({
        threadId: thread.id,
        context: createWorkspaceReadyContext(attachedContext, {
          workspaceReadyEventSequence,
        }),
      });

      await runThreadLifecycleSweep(harness.deps);
      const startCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );

      await reportQueuedCommandSuccess(harness, startCommand, {
        providerThreadId: "provider-settled-start-before-turn",
      });
      await advanceThreadProvisioning(harness.deps, {
        threadId: thread.id,
      });

      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "active",
      });
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.type,
        ),
      ).not.toContain("system/error");
    });
  });

  it("starts an errored pre-start thread when retry happens after the environment is ready", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-ready-retry-after-lost-provision",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/ready-retry-after-lost-provision",
        status: "ready",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "error",
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
          input: [{ type: "text", text: "initial lost start" }],
          target: { kind: "new-turn" },
          execution: THREAD_START_EXECUTION,
          initiator: "user",
          senderThreadId: null,
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });

      let startCommand: QueuedCommand | null = null;
      try {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input: [{ type: "text", text: "retry after ready" }],
              mode: "auto",
            }),
          },
        );

        expect(response.status).toBe(200);
        startCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.start" && command.threadId === thread.id,
        );
        expect(getThread(harness.db, thread.id)?.status).toBe("active");
        expect(
          listEvents(harness.db, { threadId: thread.id }).map(
            (event) => event.type,
          ),
        ).toContain("client/turn/requested");
      } finally {
        if (startCommand !== null) {
          await reportQueuedCommandError(harness, startCommand, {
            errorCode: "test_live_start_cleanup",
            errorMessage: "Test settled live thread start",
          });
        }
      }
    });
  });

  it("reprovisions an errored pre-start thread when retry happens before the environment is ready", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-error-retry-before-late-ready",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/error-retry-before-late-ready",
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
        status: "error",
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
          input: [{ type: "text", text: "initial lost start" }],
          target: { kind: "new-turn" },
          execution: THREAD_START_EXECUTION,
          initiator: "user",
          senderThreadId: null,
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });

      let startCommand: QueuedCommand | null = null;
      try {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input: [{ type: "text", text: "retry before ready" }],
              mode: "auto",
            }),
          },
        );

        expect(response.status).toBe(200);
        expect(getThread(harness.db, thread.id)?.status).toBe("starting");
        expect(getEnvironment(harness.db, environment.id)?.status).toBe(
          "provisioning",
        );
        const provisionCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.provision" &&
            command.environmentId === environment.id,
        );
        if (
          provisionCommand.command.type !== "environment.provision" ||
          provisionCommand.command.workspaceProvisionType === "unmanaged"
        ) {
          throw new Error("Expected managed environment.provision command");
        }
        await reportQueuedCommandSuccess(harness, provisionCommand, {
          path: "/tmp/error-retry-before-late-ready",
          branchName: `bb/${thread.id}`,
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: true,
          transcript: [],
        });
        startCommand = await waitForQueuedCommandAfter(
          harness,
          provisionCommand.row.cursor,
          ({ command }) =>
            command.type === "thread.start" && command.threadId === thread.id,
        );

        expect(getEnvironment(harness.db, environment.id)?.status).toBe(
          "ready",
        );
      } finally {
        if (startCommand !== null) {
          await reportQueuedCommandError(harness, startCommand, {
            errorCode: "test_live_start_cleanup",
            errorMessage: "Test settled live thread start",
          });
        }
      }
    });
  });
});
