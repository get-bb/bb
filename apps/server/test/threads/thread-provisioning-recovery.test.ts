import { dispatchTurnDuringReprovision } from "../../src/services/threads/thread-turn-dispatch.js";
import { requestThreadStopForCurrentState } from "../../src/services/threads/thread-lifecycle.js";
import { runEnvironmentProvisioningSweep } from "../../src/services/system/periodic-sweeps.js";
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
import {
  saveThreadProvisionContext,
  clearThreadProvisionSchedule,
  readThreadProvisionContext,
  getThreadProvisionContext,
} from "../../src/services/threads/thread-startup-store.js";
import { createThreadStartup } from "../../src/services/threads/thread-startup-store.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
} from "../../src/services/threads/thread-provisioning.js";
import {
  listQueuedThreadCommands,
  reportNextEnvironmentAttachSuccess,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  type QueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedHost,
  seedSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { installFakeEnvironmentProvider } from "../helpers/environment-provider.js";
import { withTestHarness } from "../helpers/test-app.js";

const THREAD_START_EXECUTION = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "accept-edits",
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
          headSha: null,
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
      const requestedContext = createThreadStartup({
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
      const attachedContext = {
        ...requestedContext,
        state: { ...requestedContext.state, environmentId: environment.id },
      };
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
            headSha: null,
          }),
        },
      );
      saveThreadProvisionContext({
        replace: false,
        db: harness.db,
        threadId: thread.id,
        context: {
          ...attachedContext,
          state: { ...attachedContext.state, workspaceReadyEventSequence },
        },
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
      const requestedContext = createThreadStartup({
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
      const attachedContext = {
        ...requestedContext,
        state: { ...requestedContext.state, environmentId: environment.id },
      };
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
            headSha: null,
          }),
        },
      );
      saveThreadProvisionContext({
        replace: false,
        db: harness.db,
        threadId: thread.id,
        context: {
          ...attachedContext,
          state: { ...attachedContext.state, workspaceReadyEventSequence },
        },
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
        environmentProviderId: "personal-workspace",
        environmentProviderPluginId: "bb-plugin-environment-personal-workspace",
        isGitRepo: false,
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
        environmentProviderId: "personal-workspace",
        environmentProviderPluginId: "bb-plugin-environment-personal-workspace",
        isGitRepo: false,
      });
      harness.db
        .update(environments)
        .set({ path: null, updatedAt: Date.now() })
        .where(eq(environments.id, environment.id))
        .run();
      installFakeEnvironmentProvider({
        id: "personal-workspace",
        pluginId: "bb-plugin-environment-personal-workspace",
        displayName: "Personal workspace",
        requires: {
          projectCheckout: false,
          gitCheckout: false,
          gitRemote: false,
          projectless: false,
        },
        decide: () => ({
          action: "ready",
          environment: {
            type: "host",
            hostId: host.id,
            path: "/tmp/error-retry-before-late-ready-rebuilt",
          },
        }),
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
              input: [{ type: "text", text: "retry before ready" }],
              mode: "auto",
            }),
          },
        );

        expect(response.status).toBe(200);
        expect(getThread(harness.db, thread.id)?.status).toBe("starting");
        await reportNextEnvironmentAttachSuccess(harness, thread.id);
        startCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.start" && command.threadId === thread.id,
        );

        const rebuilt = getEnvironment(
          harness.db,
          getThread(harness.db, thread.id)?.environmentId ?? "",
        );
        expect(rebuilt?.status).toBe("ready");
        expect(rebuilt?.path).toBe(
          "/tmp/error-retry-before-late-ready-rebuilt",
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

it.each(["metadata", "workspace"])(
  "recovers %s preparation from the thread after losing process state",
  async (stage) => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-durable-start",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/durable-start",
        status: stage === "workspace" ? "provisioning" : "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "starting",
      });
      const requested = requestThreadProvision(harness.deps, {
        thread,
        environmentIntent: { type: "reuse", environmentId: environment.id },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input: textInput("preserve this first message"),
        startedOnBehalfOf: null,
        titleProvided: true,
      });
      if (stage === "workspace") {
        const sequence = appendThreadProvisioningEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          provisioningId: requested.state.provisioningId,
          status: "active",
          entries: [],
        });
        saveThreadProvisionContext({
          db: harness.db,
          replace: false,
          threadId: thread.id,
          context: {
            ...{
              ...requested,
              state: { ...requested.state, environmentId: environment.id },
            },
            state: {
              ...{
                ...requested,
                state: { ...requested.state, environmentId: environment.id },
              }.state,
              provisionEventSequence: sequence,
            },
          },
        });
      }
      clearThreadProvisionSchedule(thread.id);
      expect(
        readThreadProvisionContext(harness.db, thread.id)?.state.provisioningId,
      ).toBe(requested.state.provisioningId);
      const advance =
        stage === "workspace"
          ? runEnvironmentProvisioningSweep(harness.deps)
          : advanceThreadProvisioning(harness.deps, { threadId: thread.id });
      if (stage === "workspace") {
        await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.attach" &&
            command.environmentId === environment.id,
        );
        await reportNextEnvironmentAttachSuccess(harness, thread.id);
      }
      const command = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      expect(command.command).toMatchObject({
        input: textInput("preserve this first message"),
      });
      clearThreadProvisionSchedule(thread.id);
      expect(readThreadProvisionContext(harness.db, thread.id)).toBeNull();
      await advanceThreadProvisioning(harness.deps, { threadId: thread.id });
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toHaveLength(1);
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        environment.id,
      );
      await reportQueuedCommandError(harness, command, {
        errorCode: "test_cleanup",
        errorMessage: "test cleanup",
      });
      await advance;
    });
  },
);

it("rejects an older startup checkpoint after a new attempt has been persisted", async () => {
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, { id: "host-startup-cas" });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      path: "/tmp/startup-cas",
      status: "ready",
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      status: "starting",
    });
    const args = {
      thread,
      environmentIntent: {
        type: "reuse" as const,
        environmentId: environment.id,
      },
      execution: THREAD_START_EXECUTION,
      fork: null,
      startedOnBehalfOf: null,
      titleProvided: true,
    };
    const first = requestThreadProvision(harness.deps, {
      ...args,
      input: textInput("first"),
    });
    const second = requestThreadProvision(harness.deps, {
      ...args,
      input: textInput("second"),
    });
    saveThreadProvisionContext({
      db: harness.db,
      replace: false,
      threadId: thread.id,
      context: first,
    });
    expect(
      getThreadProvisionContext(harness.db, thread.id)?.state.provisioningId,
    ).toBe(second.state.provisioningId);
    clearThreadProvisionSchedule(thread.id);
    expect(
      readThreadProvisionContext(harness.db, thread.id)?.request.input,
    ).toEqual(textInput("second"));
  });
});

it("retries failed setup on the same environment without reallocating its workspace", async () => {
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      path: "/tmp/retry-existing-setup",
      status: "error",
      environmentProviderId: "git-worktree",
      environmentProviderSelection: {
        machine: { type: "existing", hostId: host.id },
        inputs: {},
      },
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "error",
    });
    expect(
      await dispatchTurnDuringReprovision({
        deps: harness.deps,
        thread,
        environment,
        execution: THREAD_START_EXECUTION,
        input: textInput("retry original input"),
        initiator: "user",
        senderThreadId: null,
      }),
    ).toBe(true);
    const attach = await waitForQueuedCommand(
      harness,
      ({ command }) => command.type === "environment.attach",
    );
    expect(attach.command).toMatchObject({
      environmentId: environment.id,
      path: environment.path,
    });
    expect(getEnvironment(harness.db, environment.id)).toMatchObject({
      attempt: 1,
      status: "provisioning",
    });
    await reportNextEnvironmentAttachSuccess(harness, thread.id);
    const start = await waitForQueuedCommand(
      harness,
      ({ command }) => command.type === "thread.start",
    );
    expect(start.command).toMatchObject({
      input: textInput("retry original input"),
    });
    expect(getThread(harness.db, thread.id)?.environmentId).toBe(
      environment.id,
    );
    expect(getEnvironment(harness.db, environment.id)?.status).toBe("ready");
  });
});

it.each(["success", "failure"])(
  "preserves cancellation after attachment when setup later reports %s",
  async (outcome) => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/cancel-attached-setup",
        status: "provisioning",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "starting",
      });
      requestThreadProvision(harness.deps, {
        thread,
        environmentIntent: { type: "reuse", environmentId: environment.id },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input: textInput("cancel during setup"),
        startedOnBehalfOf: null,
        titleProvided: true,
      });
      await advanceThreadProvisioning(harness.deps, { threadId: thread.id });
      const attach = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.attach",
      );
      requestThreadStopForCurrentState(
        harness.deps,
        getThread(harness.db, thread.id)!,
        environment,
      );
      const cancel = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.attach.cancel",
      );
      await reportQueuedCommandSuccess(harness, cancel, { aborted: true });
      if (outcome === "success")
        await reportQueuedCommandSuccess(harness, attach, {
          path: environment.path!,
          isGitRepo: false,
          isWorktree: false,
          branchName: null,
          defaultBranch: null,
        });
      else
        await reportQueuedCommandError(harness, attach, {
          errorCode: "provision_cancelled",
          errorMessage: "Setup was cancelled",
        });
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("ready");
      expect(
        listEvents(harness.db, { threadId: thread.id }).some(
          (event) => event.type === "system/error",
        ),
      ).toBe(false);
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toHaveLength(0);
    });
  },
);

it("waits for the host to reconnect before recovering workspace setup", async () => {
  await withTestHarness(async (harness) => {
    const host = seedHost(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      path: "/tmp/reconnect-setup",
      status: "provisioning",
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "starting",
    });
    requestThreadProvision(harness.deps, {
      thread,
      environmentIntent: { type: "reuse", environmentId: environment.id },
      execution: THREAD_START_EXECUTION,
      fork: null,
      input: textInput("recover after reconnect"),
      startedOnBehalfOf: null,
      titleProvided: true,
    });
    await advanceThreadProvisioning(harness.deps, { threadId: thread.id });
    await runEnvironmentProvisioningSweep(harness.deps);
    expect(getThread(harness.db, thread.id)?.status).toBe("starting");
    expect(getEnvironment(harness.db, environment.id)?.status).toBe(
      "provisioning",
    );
    seedSession(harness.deps, host.id);
    await runEnvironmentProvisioningSweep(harness.deps);
    const attach = await waitForQueuedCommand(
      harness,
      ({ command }) => command.type === "environment.attach",
    );
    expect(attach.command).toMatchObject({ environmentId: environment.id });
    await reportNextEnvironmentAttachSuccess(harness, thread.id);
    await waitForQueuedCommand(
      harness,
      ({ command }) => command.type === "thread.start",
    );
    expect(getEnvironment(harness.db, environment.id)?.status).toBe("ready");
  });
});
