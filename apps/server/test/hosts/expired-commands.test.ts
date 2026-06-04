import { eq } from "drizzle-orm";
import {
  COMPLETED_COMMAND_PAYLOAD_RETENTION_MS,
  createPendingInteraction,
  getEnvironment,
  getEnvironmentOperation,
  getPendingInteraction,
  getThread,
  getThreadOperation,
  hostDaemonCommandAttempts,
  hostDaemonCommands,
  queueCommand,
  setPendingInteractionResolving,
} from "@bb/db";
import { setEnvironmentStatus } from "@bb/db/internal-environment-lifecycle";
import { describe, expect, it } from "vitest";
import {
  handleExpiredCommands,
  settleLegacyTerminalizedExpiredLifecycleCommands,
} from "../../src/services/hosts/expired-commands.js";
import { runPeriodicSweeps } from "../../src/services/system/periodic-sweeps.js";
import { type TestAppHarness, withTestHarness } from "../helpers/test-app.js";
import {
  seedEnvironment,
  seedHost,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  queueEnvironmentDestroyLifecycleCommand,
  queueEnvironmentProvisionLifecycleCommand,
  queueThreadStartLifecycleCommand,
  queueThreadStopLifecycleCommand,
} from "../helpers/lifecycle-commands.js";
import { ensureCommandDelivered } from "../helpers/commands.js";

const EXPIRED_RESULT_PAYLOAD = JSON.stringify({
  errorCode: "command_expired",
  errorMessage: "Command expired after retry",
});

interface DeliverExpiredCommandArgs {
  commandId: string;
  hostId: string;
}

function deliverExpiredCommand(
  harness: TestAppHarness,
  args: DeliverExpiredCommandArgs,
): { commandId: string; attemptId: string } {
  const attemptId = ensureCommandDelivered(harness, {
    commandId: args.commandId,
    hostId: args.hostId,
    sessionId: null,
  });
  harness.db
    .update(hostDaemonCommandAttempts)
    .set({
      status: "expired",
      settledAt: Date.now(),
    })
    .where(eq(hostDaemonCommandAttempts.id, attemptId))
    .run();
  return {
    commandId: args.commandId,
    attemptId,
  };
}

function markCommandTerminalizedBeforeSettlement(
  harness: TestAppHarness,
  commandId: string,
  completedAt: number,
): void {
  harness.db
    .update(hostDaemonCommands)
    .set({
      state: "error",
      completedAt,
      resultPayload: EXPIRED_RESULT_PAYLOAD,
    })
    .where(eq(hostDaemonCommands.id, commandId))
    .run();
}

describe("expired commands", () => {
  it.each([
    {
      type: "environment.destroy" as const,
      buildPayload: (args: {
        environmentId: string;
        threadId: string;
        workspacePath: string;
        workspaceProvisionType: string;
      }) => ({
        type: "environment.destroy" as const,
        environmentId: args.environmentId,
        workspaceContext: {
          workspacePath: args.workspacePath,
          workspaceProvisionType: args.workspaceProvisionType,
        },
      }),
    },
    {
      type: "environment.provision" as const,
      buildPayload: (args: {
        environmentId: string;
        threadId: string;
        workspacePath: string;
        workspaceProvisionType: string;
      }) => ({
        type: "environment.provision" as const,
        environmentId: args.environmentId,
        initiator: null,
        workspaceProvisionType: "unmanaged" as const,
        path: args.workspacePath,
      }),
    },
    {
      type: "thread.start" as const,
      buildPayload: (args: {
        environmentId: string;
        threadId: string;
        workspacePath: string;
        workspaceProvisionType: string;
      }) => ({
        type: "thread.start" as const,
        environmentId: args.environmentId,
        threadId: args.threadId,
        requestId: "creq_23456789ab",
        input: [{ type: "text" as const, text: "hello" }],
        workspaceContext: {
          workspacePath: args.workspacePath,
          workspaceProvisionType: args.workspaceProvisionType,
        },
        projectId: "proj_test",
        providerId: "codex",
        options: {
          model: "gpt-5",
          reasoningLevel: "medium" as const,
          workflowsEnabled: false,
          permissionMode: "full" as const,
          permissionEscalation: null,
          serviceTier: "default" as const,
        },
        instructions: "instructions",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append" as const,
      }),
    },
    {
      type: "thread.stop" as const,
      buildPayload: (args: {
        environmentId: string;
        threadId: string;
        workspacePath: string;
        workspaceProvisionType: string;
      }) => ({
        type: "thread.stop" as const,
        environmentId: args.environmentId,
        threadId: args.threadId,
      }),
    },
  ])(
    "reports expired $type results with the original command type",
    async ({ type, buildPayload }) => {
      await withTestHarness(async (harness) => {
        const host = seedHost(harness.deps, { id: `host-expired-${type}` });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: `/tmp/${type.replace(".", "-")}`,
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          status: "created",
        });
        const command = queueCommand(harness.db, harness.hub, {
          hostId: host.id,
          sessionId: null,
          type,
          payload: JSON.stringify(
            buildPayload({
              environmentId: environment.id,
              threadId: thread.id,
              workspacePath: environment.path ?? `/tmp/${thread.id}`,
              workspaceProvisionType: environment.workspaceProvisionType,
            }),
          ),
        });
        const expired = deliverExpiredCommand(harness, {
          commandId: command.id,
          hostId: host.id,
        });

        const resultPromise = harness.hub.waitForCommandResult(
          command.id,
          1_000,
        );
        await handleExpiredCommands(harness.deps, {
          commands: [expired],
        });

        await expect(resultPromise).resolves.toMatchObject({
          commandId: command.id,
          errorCode: "command_expired",
          errorMessage: "Command expired after retry",
          ok: false,
          type,
        });
      });
    },
  );

  it("settles expired commands without owners without parsing payload JSON", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, {
        id: "host-expired-invalid-workspace-status",
      });
      const command = queueCommand(harness.db, harness.hub, {
        hostId: host.id,
        sessionId: null,
        type: "host.write_file_relative",
        payload: "{",
      });
      const expired = deliverExpiredCommand(harness, {
        commandId: command.id,
        hostId: host.id,
      });

      const resultPromise = harness.hub.waitForCommandResult(command.id, 1_000);
      await handleExpiredCommands(harness.deps, {
        commands: [expired],
      });

      await expect(resultPromise).resolves.toMatchObject({
        commandId: command.id,
        errorCode: "command_expired",
        errorMessage: "Command expired after retry",
        ok: false,
        type: "host.write_file_relative",
      });
      expect(
        harness.db
          .select()
          .from(hostDaemonCommands)
          .where(eq(hostDaemonCommands.id, command.id))
          .get(),
      ).toMatchObject({
        state: "error",
        resultPayload: EXPIRED_RESULT_PAYLOAD,
      });
    });
  });

  it("settles expired environment.destroy through environment cleanup settlement", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-expired-destroy" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      const command = queueEnvironmentDestroyLifecycleCommand(harness, {
        hostId: host.id,
        environmentId: environment.id,
        sessionId: null,
        command: {
          type: "environment.destroy",
          environmentId: environment.id,
          workspaceContext: {
            workspacePath: environment.path ?? "/tmp/expired-destroy",
            workspaceProvisionType: environment.workspaceProvisionType,
          },
        },
      });
      setEnvironmentStatus(harness.db, harness.hub, environment.id, {
        status: "destroying",
      });
      const expired = deliverExpiredCommand(harness, {
        commandId: command.id,
        hostId: host.id,
      });

      await handleExpiredCommands(harness.deps, {
        commands: [expired],
      });

      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({
        failureReason: "Command expired after retry",
        state: "failed",
      });
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("ready");
      expect(
        harness.db
          .select()
          .from(hostDaemonCommands)
          .where(eq(hostDaemonCommands.id, command.id))
          .get(),
      ).toMatchObject({
        state: "error",
        resultPayload: EXPIRED_RESULT_PAYLOAD,
      });
    });
  });

  it("settles expired environment.provision through environment provisioning settlement", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-expired-provision" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        status: "provisioning",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "provisioning",
      });
      const command = queueEnvironmentProvisionLifecycleCommand(harness, {
        hostId: host.id,
        environmentId: environment.id,
        sessionId: null,
        command: {
          type: "environment.provision",
          environmentId: environment.id,
          initiator: null,
          workspaceProvisionType: "unmanaged",
          path: environment.path ?? "/tmp/expired-provision",
        },
      });
      const expired = deliverExpiredCommand(harness, {
        commandId: command.id,
        hostId: host.id,
      });

      await handleExpiredCommands(harness.deps, {
        commands: [expired],
      });

      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "provision",
        }),
      ).toMatchObject({
        failureReason: "Command expired after retry",
        state: "failed",
      });
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
      expect(getThread(harness.db, thread.id)?.status).toBe("error");
    });
  });

  it("settles expired thread.start through thread lifecycle settlement", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-expired-thread-start" });
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
        status: "created",
      });
      const command = queueThreadStartLifecycleCommand(harness, {
        hostId: host.id,
        threadId: thread.id,
        sessionId: null,
        command: {
          type: "thread.start",
          environmentId: environment.id,
          threadId: thread.id,
          requestId: "creq_23456789ac",
          input: [{ type: "text", text: "hello" }],
          workspaceContext: {
            workspacePath: environment.path ?? "/tmp/expired-thread-start",
            workspaceProvisionType: environment.workspaceProvisionType,
          },
          projectId: project.id,
          providerId: "codex",
          options: {
            model: "gpt-5",
            reasoningLevel: "medium",
            workflowsEnabled: false,
            permissionMode: "full",
            permissionEscalation: null,
            serviceTier: "default",
          },
          instructions: "instructions",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
      });
      const expired = deliverExpiredCommand(harness, {
        commandId: command.id,
        hostId: host.id,
      });

      await handleExpiredCommands(harness.deps, {
        commands: [expired],
      });

      expect(
        getThreadOperation(harness.db, {
          threadId: thread.id,
          kind: "start",
        }),
      ).toMatchObject({
        failureReason: "Command expired after retry",
        state: "failed",
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("error");
    });
  });

  it("settles expired thread.stop through thread lifecycle settlement", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-expired-thread-stop" });
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
        status: "active",
      });
      const command = queueThreadStopLifecycleCommand(harness, {
        hostId: host.id,
        threadId: thread.id,
        sessionId: null,
        command: {
          type: "thread.stop",
          environmentId: environment.id,
          threadId: thread.id,
        },
      });
      const expired = deliverExpiredCommand(harness, {
        commandId: command.id,
        hostId: host.id,
      });

      await handleExpiredCommands(harness.deps, {
        commands: [expired],
      });

      expect(
        getThreadOperation(harness.db, {
          threadId: thread.id,
          kind: "stop",
        }),
      ).toMatchObject({
        failureReason: "Command expired after retry",
        state: "failed",
      });
    });
  });

  it("settles expired interactive.resolve through pending interaction settlement", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, {
        id: "host-expired-interactive-resolve",
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
        status: "active",
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn_expired_interactive",
      });
      const interaction = createPendingInteraction(harness.db, {
        threadId: thread.id,
        turnId: "turn_expired_interactive",
        providerId: "codex",
        providerThreadId: "provider-expired-interactive",
        providerRequestId: "request-expired-interactive",
        sessionId: "session-expired-interactive",
        payload: JSON.stringify({
          kind: "approval",
          subject: {
            kind: "command",
            itemId: "item-expired-interactive",
            command: "git status",
            cwd: null,
            actions: [],
            sessionGrant: null,
          },
          reason: null,
          availableDecisions: ["deny"],
        }),
      });
      const resolution = { decision: "deny" };
      const command = queueCommand(harness.db, harness.hub, {
        hostId: host.id,
        sessionId: null,
        type: "interactive.resolve",
        payload: JSON.stringify({
          type: "interactive.resolve",
          environmentId: environment.id,
          threadId: thread.id,
          interactionId: interaction.id,
          providerId: "codex",
          providerThreadId: "provider-expired-interactive",
          providerRequestId: "request-expired-interactive",
          resolution,
        }),
      });
      setPendingInteractionResolving(harness.db, {
        commandId: command.id,
        id: interaction.id,
        resolution: JSON.stringify(resolution),
      });
      const expired = deliverExpiredCommand(harness, {
        commandId: command.id,
        hostId: host.id,
      });

      await handleExpiredCommands(harness.deps, {
        commands: [expired],
      });

      expect(getPendingInteraction(harness.db, interaction.id)).toMatchObject({
        status: "interrupted",
        statusReason: "Command expired after retry",
      });
    });
  });

  it("settles expired turn.submit through thread lifecycle settlement", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-expired-turn-submit" });
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
        status: "active",
      });
      const command = queueCommand(harness.db, harness.hub, {
        hostId: host.id,
        sessionId: null,
        type: "turn.submit",
        payload: JSON.stringify({
          type: "turn.submit",
          environmentId: environment.id,
          threadId: thread.id,
          requestId: "creq_23456789ad",
          target: { mode: "auto", expectedTurnId: null },
          input: [{ type: "text", text: "hello" }],
          options: {
            model: "gpt-5",
            reasoningLevel: "medium",
            workflowsEnabled: false,
            permissionMode: "full",
            permissionEscalation: null,
            serviceTier: "default",
          },
          resumeContext: {
            workspaceContext: {
              workspacePath: environment.path ?? "/tmp/expired-turn-submit",
              workspaceProvisionType: environment.workspaceProvisionType,
            },
            projectId: project.id,
            providerId: "codex",
            providerThreadId: "provider-expired-turn-submit",
            instructions: "instructions",
            dynamicTools: [],
            injectedSkillSources: [],
            instructionMode: "append",
          },
        }),
      });
      const expired = deliverExpiredCommand(harness, {
        commandId: command.id,
        hostId: host.id,
      });

      await handleExpiredCommands(harness.deps, {
        commands: [expired],
      });

      expect(getThread(harness.db, thread.id)?.status).toBe("error");
    });
  });

  it("settles legacy terminalized lifecycle rows before periodic durable pruning", async () => {
    await withTestHarness(async (harness) => {
      const now = Date.now();
      const oldCompletedAt =
        now - COMPLETED_COMMAND_PAYLOAD_RETENTION_MS - 1_000;
      const host = seedHost(harness.deps, {
        id: "host-legacy-expired-destroy-prune",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        path: "/tmp/legacy-expired-destroy-prune",
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      const command = queueEnvironmentDestroyLifecycleCommand(harness, {
        hostId: host.id,
        environmentId: environment.id,
        sessionId: null,
        command: {
          type: "environment.destroy",
          environmentId: environment.id,
          workspaceContext: {
            workspacePath:
              environment.path ?? "/tmp/legacy-expired-destroy-prune",
            workspaceProvisionType: environment.workspaceProvisionType,
          },
        },
      });
      setEnvironmentStatus(harness.db, harness.hub, environment.id, {
        status: "destroying",
      });
      markCommandTerminalizedBeforeSettlement(
        harness,
        command.id,
        oldCompletedAt,
      );

      await runPeriodicSweeps(harness.deps);

      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({
        failureReason: "Command expired after retry",
        state: "failed",
      });
      expect(
        harness.db
          .select()
          .from(hostDaemonCommands)
          .where(eq(hostDaemonCommands.id, command.id))
          .get(),
      ).toMatchObject({
        payload: "{}",
        resultPayload: null,
        state: "error",
      });
    });
  });

  it("repairs legacy terminalized thread and interaction owner rows once", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-legacy-expired-mixed" });
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
        status: "active",
      });
      const stopCommand = queueThreadStopLifecycleCommand(harness, {
        hostId: host.id,
        threadId: thread.id,
        sessionId: null,
        command: {
          type: "thread.stop",
          environmentId: environment.id,
          threadId: thread.id,
        },
      });
      markCommandTerminalizedBeforeSettlement(harness, stopCommand.id, 100);

      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn_legacy_interactive",
      });
      const interaction = createPendingInteraction(harness.db, {
        threadId: thread.id,
        turnId: "turn_legacy_interactive",
        providerId: "codex",
        providerThreadId: "provider-legacy-interactive",
        providerRequestId: "request-legacy-interactive",
        sessionId: "session-legacy-interactive",
        payload: JSON.stringify({
          kind: "approval",
          subject: {
            kind: "command",
            itemId: "item-legacy-interactive",
            command: "git status",
            cwd: null,
            actions: [],
            sessionGrant: null,
          },
          reason: null,
          availableDecisions: ["deny"],
        }),
      });
      const resolution = { decision: "deny" };
      const interactionCommand = queueCommand(harness.db, harness.hub, {
        hostId: host.id,
        sessionId: null,
        type: "interactive.resolve",
        payload: JSON.stringify({
          type: "interactive.resolve",
          environmentId: environment.id,
          threadId: thread.id,
          interactionId: interaction.id,
          providerId: "codex",
          providerThreadId: "provider-legacy-interactive",
          providerRequestId: "request-legacy-interactive",
          resolution,
        }),
      });
      setPendingInteractionResolving(harness.db, {
        commandId: interactionCommand.id,
        id: interaction.id,
        resolution: JSON.stringify(resolution),
      });
      markCommandTerminalizedBeforeSettlement(
        harness,
        interactionCommand.id,
        200,
      );

      await expect(
        settleLegacyTerminalizedExpiredLifecycleCommands(harness.deps),
      ).resolves.toEqual({ hasMore: false, settled: 2 });

      expect(
        getThreadOperation(harness.db, {
          threadId: thread.id,
          kind: "stop",
        }),
      ).toMatchObject({
        failureReason: "Command expired after retry",
        state: "failed",
      });
      expect(getPendingInteraction(harness.db, interaction.id)).toMatchObject({
        status: "interrupted",
        statusReason: "Command expired after retry",
      });
      await expect(
        settleLegacyTerminalizedExpiredLifecycleCommands(harness.deps),
      ).resolves.toEqual({ hasMore: false, settled: 0 });
    });
  });
});
