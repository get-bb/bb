import {
  environments,
  getEnvironment,
  getThread,
  listEvents,
  threads,
  workTogetherRoomResourceReservations,
} from "@bb/db";
import { systemThreadProvisioningEventDataSchema } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  dispatchManagedEnvironmentReprovision,
  MANAGED_REPROVISION_IN_PROGRESS,
  MANAGED_REPROVISION_STARTED,
} from "../../src/services/environments/environment-provisioning-internal.js";
import { beginProjectDeletion } from "../../src/services/projects/project-deletion.js";
import { runStartupRecoverySweep } from "../../src/services/system/periodic-sweeps.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { requestThreadStopForCurrentState } from "../../src/services/threads/thread-lifecycle.js";
import { advanceThreadProvisioning } from "../../src/services/threads/thread-provisioning.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  requireManagedWorktreeEnvironmentProvisionLiveCommand,
  listQueuedEnvironmentCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("environment reprovisioning", () => {
  it("starts managed reprovision at most once per environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-reprovision-once",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reprovision-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reprovision-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: null,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const firstAttempt = await dispatchManagedEnvironmentReprovision(
        harness.deps,
        {
          environment,
          projectId: thread.projectId,
          provisionEventSequence: 1,
          provisioningId: "tpv-reprovision-once-first",
          threadId: thread.id,
        },
      );
      const secondAttempt = await dispatchManagedEnvironmentReprovision(
        harness.deps,
        {
          environment,
          projectId: thread.projectId,
          provisionEventSequence: 2,
          provisioningId: "tpv-reprovision-once-second",
          threadId: thread.id,
        },
      );

      expect(firstAttempt).toMatchObject({
        status: MANAGED_REPROVISION_STARTED,
        provisionEventSequence: expect.any(Number),
      });
      expect(secondAttempt).toBe(MANAGED_REPROVISION_IN_PROGRESS);
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "provisioning",
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionLiveCommand(queued);
      expect(managedCommand.command.branchName).toBe(`bb/${thread.id}`);
      expect(managedCommand.command.type).toBe("environment.provision");
    });
  });

  it("preserves the stored branch name during managed reprovision", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-reprovision-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reprovision-branch-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reprovision-branch-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/existing-readable-branch",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      await dispatchManagedEnvironmentReprovision(harness.deps, {
        environment,
        projectId: thread.projectId,
        provisionEventSequence: 1,
        provisioningId: "tpv-reprovision-branch",
        threadId: thread.id,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionLiveCommand(queued);
      expect(managedCommand.command.branchName).toBe(
        "bb/existing-readable-branch",
      );
    });
  });

  it("uses the persisted base branch during managed reprovision", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-reprovision-base-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reprovision-base-branch-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reprovision-base-branch-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/base-branch-thread",
        baseBranch: "release/2026-05",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      await dispatchManagedEnvironmentReprovision(harness.deps, {
        environment,
        projectId: thread.projectId,
        provisionEventSequence: 1,
        provisioningId: "tpv-reprovision-base-branch",
        threadId: thread.id,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionLiveCommand(queued);
      expect(managedCommand.command.startPoint.baseBranch).toBe(
        "release/2026-05",
      );
    });
  });

  it("uses the source default base branch during managed reprovision", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-reprovision-default-base-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reprovision-default-base-branch-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reprovision-default-base-branch-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/default-base-branch-thread",
        baseBranch: null,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      await dispatchManagedEnvironmentReprovision(harness.deps, {
        environment,
        projectId: thread.projectId,
        provisionEventSequence: 1,
        provisioningId: "tpv-reprovision-default-base-branch",
        threadId: thread.id,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionLiveCommand(queued);
      expect(managedCommand.command.startPoint.baseBranch).toBeNull();
    });
  });

  it("fails closed instead of branch-falling back when a pinned environment has no Room reservation", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-reprovision-missing-room-reservation",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reprovision-missing-room-reservation-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reprovision-missing-room-reservation-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        baseRevision: "a".repeat(40),
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      await expect(
        dispatchManagedEnvironmentReprovision(harness.deps, {
          environment,
          projectId: thread.projectId,
          provisionEventSequence: 1,
          provisioningId: "tpv-reprovision-missing-room-reservation",
          threadId: thread.id,
        }),
      ).rejects.toMatchObject({
        body: { code: "invalid_request" },
        status: 409,
      });
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.provision",
          environment.id,
        ),
      ).toHaveLength(0);
    });
  });

  it("accepts the measured descendant only for a previously verified pinned Room reprovision", async () => {
    await withTestHarness(async (harness) => {
      const baseRevision = "a".repeat(40);
      const descendantRevision = "b".repeat(40);
      const { host } = seedHostSession(harness.deps, {
        id: "host-reprovision-verified-room",
      });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reprovision-verified-room-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reprovision-verified-room-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        baseBranch: "main",
        baseRevision,
        baseRevisionVerifiedAt: 1,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      harness.db
        .insert(workTogetherRoomResourceReservations)
        .values({
          bindingId: "10000000-0000-4000-8000-000000000001",
          workspaceId: "10000000-0000-4000-8000-000000000002",
          taskId: "10000000-0000-4000-8000-000000000003",
          cellId: "10000000-0000-4000-8000-000000000004",
          repositoryBindingId: "10000000-0000-4000-8000-000000000005",
          repositoryBindingVersion: 1,
          providerRepositoryId: "42",
          baseBranch: "main",
          baseRevision,
          generatedBranch: environment.branchName ?? `bb/${thread.id}`,
          candidateHostId: "10000000-0000-4000-8000-000000000006",
          bbHostId: host.id,
          projectName: project.name,
          providerId: "codex",
          sourcePath: source.path,
          environmentTemplate: "managed-worktree",
          projectId: project.id,
          projectSourceId: source.id,
          environmentId: environment.id,
          primaryThreadId: thread.id,
          createdAt: 1,
          updatedAt: 1,
        })
        .run();

      await dispatchManagedEnvironmentReprovision(harness.deps, {
        environment,
        projectId: thread.projectId,
        provisionEventSequence: 1,
        provisioningId: "tpv-reprovision-verified-room",
        threadId: thread.id,
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environment.id,
      );
      const managed =
        requireManagedWorktreeEnvironmentProvisionLiveCommand(queued);
      expect(managed.command.startPoint).toEqual({
        kind: "revision",
        baseBranch: "main",
        baseRevision,
        providerRepositoryId: "42",
        allowExistingDescendant: true,
      });

      await reportQueuedCommandSuccess(harness, queued, {
        path: environment.path ?? "/tmp/reprovision-verified-room-target",
        isGitRepo: true,
        isWorktree: true,
        branchName: environment.branchName,
        defaultBranch: "main",
        verifiedBaseRevision: descendantRevision,
        transcript: [],
      });

      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "ready",
        baseRevision,
        baseRevisionVerifiedAt: expect.any(Number),
        provisionFailure: null,
      });
    });
  });

  it("fails reprovision before mutating state when the host is disconnected", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, {
        id: "host-reprovision-offline",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reprovision-offline-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reprovision-offline-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      let thrownError: ApiError | null = null;
      try {
        await dispatchManagedEnvironmentReprovision(harness.deps, {
          environment,
          projectId: thread.projectId,
          provisionEventSequence: 1,
          provisioningId: "tpv-reprovision-offline",
          threadId: thread.id,
        });
      } catch (error) {
        if (error instanceof ApiError) {
          thrownError = error;
        } else {
          throw error;
        }
      }

      expect(thrownError).toMatchObject({
        body: {
          code: "host_unavailable",
          message: "Host is not connected",
          details: {
            reason: "disconnected",
            hostStatus: "disconnected",
            suspendedAt: null,
            destroyedAt: null,
          },
        },
        status: 502,
      });
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
    });
  });

  it("fails host-backed thread creation before creating provisioning state when the host is disconnected", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, {
        id: "host-thread-create-offline",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-create-offline-project",
      });

      let thrownError: ApiError | null = null;
      try {
        await createThreadFromRequest(harness.deps, {
          startedOnBehalfOf: null,
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
          },
          input: textInput("offline create"),
          origin: "cli",
          projectId: project.id,
          providerId: "codex",
        });
      } catch (error) {
        if (error instanceof ApiError) {
          thrownError = error;
        } else {
          throw error;
        }
      }

      expect(thrownError).toMatchObject({
        body: {
          code: "host_unavailable",
          message: "Host is not connected",
        },
        status: 502,
      });
      expect(harness.db.select({ id: threads.id }).from(threads).all()).toEqual(
        [],
      );
      expect(
        harness.db.select({ id: environments.id }).from(environments).all(),
      ).toEqual([]);
    });
  });

  it("finalizes a tombstoned thread instead of activating it when provisioning succeeds late", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-provision-after-delete",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/provision-after-delete-project",
      });

      const thread = await createThreadFromRequest(harness.deps, {
        startedOnBehalfOf: null,
        environment: {
          type: "host",
          hostId: host.id,
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "default" },
          },
        },
        input: textInput("delete mid-provision"),
        origin: "cli",
        projectId: project.id,
        providerId: "codex",
      });
      const provisionCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.initiator?.threadId === thread.id,
      );
      if (provisionCommand.command.type !== "environment.provision") {
        throw new Error("Expected environment provision command");
      }
      const environmentId = provisionCommand.command.environmentId;

      // Project deletion tombstones the thread (deletedAt set) but keeps the
      // row until finalization, leaving a window for the provision result.
      beginProjectDeletion(harness.deps, { projectId: project.id });
      expect(getThread(harness.db, thread.id)).toMatchObject({
        deletedAt: expect.any(Number),
      });

      await reportQueuedCommandSuccess(harness, provisionCommand, {
        path: "/tmp/provision-after-delete-workspace",
        isGitRepo: false,
        isWorktree: false,
        branchName: null,
        defaultBranch: null,
        verifiedBaseRevision: null,
        transcript: [],
      });

      // The late success must not activate the tombstoned thread: it is
      // finalized (hard-deleted) and the orphaned workspace heads straight
      // into cleanup instead of staying provisioned.
      expect(getThread(harness.db, thread.id)).toBeNull();
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environmentId,
      );
      expect(getEnvironment(harness.db, environmentId)).toMatchObject({
        status: "destroying",
      });
    });
  });

  it("preserves a stopped pre-start thread when stale provision failure settles", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pre-start-provision-cancel",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/pre-start-provision-cancel-project",
      });

      const thread = await createThreadFromRequest(harness.deps, {
        startedOnBehalfOf: null,
        environment: {
          type: "host",
          hostId: host.id,
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "default" },
          },
        },
        input: textInput("stop before provisioning finishes"),
        origin: "cli",
        projectId: project.id,
        providerId: "codex",
      });
      const provisionCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.initiator?.threadId === thread.id,
      );
      if (provisionCommand.command.type !== "environment.provision") {
        throw new Error("Expected environment provision command");
      }

      const environment = getEnvironment(
        harness.db,
        provisionCommand.command.environmentId,
      );
      const currentThread = getThread(harness.db, thread.id);
      if (!environment || !currentThread) {
        throw new Error("Expected provisioned thread and environment");
      }
      requestThreadStopForCurrentState(harness.deps, currentThread, {
        hostId: environment.hostId,
        id: environment.id,
      });

      const cancelCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision.cancel" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, cancelCommand, {
        aborted: true,
      });
      await reportQueuedCommandError(harness, provisionCommand, {
        errorCode: "host_unavailable",
        errorMessage: "Host is not connected",
      });

      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "idle",
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "destroyed",
      });
      const events = listEvents(harness.db, { threadId: thread.id });
      expect(events.map((event) => event.type)).not.toContain("system/error");
      const provisioningStatuses = events
        .filter((event) => event.type === "system/thread-provisioning")
        .map(
          (event) =>
            systemThreadProvisioningEventDataSchema.parse(
              JSON.parse(event.data),
            ).status,
        );
      expect(provisioningStatuses).toContain("cancelled");
      expect(provisioningStatuses).not.toContain("failed");
    });
  });

  it("logs expected live provision cancellation without a warning", async () => {
    await withTestHarness(async (harness) => {
      const logger = {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      };
      harness.deps.logger = logger;
      const { host } = seedHostSession(harness.deps, {
        id: "host-provision-cancel-log",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/provision-cancel-log-project",
      });

      const thread = await createThreadFromRequest(harness.deps, {
        environment: {
          type: "host",
          hostId: host.id,
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "default" },
          },
        },
        input: textInput("cancelled provisioning log"),
        origin: "cli",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });
      const provisionCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.initiator?.threadId === thread.id,
      );
      if (provisionCommand.command.type !== "environment.provision") {
        throw new Error("Expected environment provision command");
      }
      const initiator = provisionCommand.command.initiator;
      if (!initiator) {
        throw new Error("Expected environment provision initiator");
      }

      await reportQueuedCommandError(harness, provisionCommand, {
        errorCode: "provision_cancelled",
        errorMessage: "Workspace provisioning was cancelled",
      });

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          commandType: "environment.provision",
          environmentId: provisionCommand.command.environmentId,
          errorCode: "provision_cancelled",
          errorMessage: "Workspace provisioning was cancelled",
          errorStatus: 502,
          executionId: expect.stringMatching(/^rpc_/),
          hostId: host.id,
          initiatorThreadId: thread.id,
          provisioningId: initiator.provisioningId,
        }),
        "Live environment provisioning cancelled",
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({
          environmentId: provisionCommand.command.environmentId,
        }),
        "Live environment provision command failed",
      );
    });
  });

  it("cancels shared provisioning after the last stopped waiter and handles stale provision failure", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-shared-provision-cancel",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/shared-provision-cancel-project",
      });

      const firstThread = await createThreadFromRequest(harness.deps, {
        startedOnBehalfOf: null,
        environment: {
          type: "host",
          hostId: host.id,
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "default" },
          },
        },
        input: textInput("first shared provisioning thread"),
        origin: "cli",
        projectId: project.id,
        providerId: "codex",
      });
      const provisionCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.initiator?.threadId === firstThread.id,
      );
      if (provisionCommand.command.type !== "environment.provision") {
        throw new Error("Expected environment provision command");
      }

      const environment = getEnvironment(
        harness.db,
        provisionCommand.command.environmentId,
      );
      if (!environment) {
        throw new Error("Expected provisioning environment");
      }

      const secondThread = await createThreadFromRequest(harness.deps, {
        startedOnBehalfOf: null,
        environment: {
          type: "reuse",
          environmentId: environment.id,
        },
        input: textInput("second shared provisioning thread"),
        origin: "cli",
        projectId: project.id,
        providerId: "codex",
      });
      await advanceThreadProvisioning(harness.deps, {
        threadId: secondThread.id,
      });
      expect(getThread(harness.db, secondThread.id)).toMatchObject({
        environmentId: environment.id,
        status: "starting",
      });

      const currentFirstThread = getThread(harness.db, firstThread.id);
      if (!currentFirstThread) {
        throw new Error("Expected first shared provisioning thread");
      }
      requestThreadStopForCurrentState(harness.deps, currentFirstThread, {
        hostId: environment.hostId,
        id: environment.id,
      });

      expect(getThread(harness.db, firstThread.id)).toMatchObject({
        status: "idle",
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.provision.cancel",
          environment.id,
        ),
      ).toEqual([]);

      const currentSecondThread = getThread(harness.db, secondThread.id);
      if (!currentSecondThread) {
        throw new Error("Expected second shared provisioning thread");
      }
      requestThreadStopForCurrentState(harness.deps, currentSecondThread, {
        hostId: environment.hostId,
        id: environment.id,
      });

      const cancelCommand = await waitForQueuedCommandAfter(
        harness,
        provisionCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.provision.cancel" &&
          command.environmentId === environment.id,
      );
      expect(getThread(harness.db, secondThread.id)).toMatchObject({
        status: "stopping",
      });

      await reportQueuedCommandError(harness, provisionCommand, {
        errorCode: "host_unavailable",
        errorMessage: "Host is not connected",
      });

      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "destroyed",
      });
      for (const threadId of [firstThread.id, secondThread.id]) {
        const events = listEvents(harness.db, { threadId });
        expect(events.map((event) => event.type)).not.toContain("system/error");
        const provisioningStatuses = events
          .filter((event) => event.type === "system/thread-provisioning")
          .map(
            (event) =>
              systemThreadProvisioningEventDataSchema.parse(
                JSON.parse(event.data),
              ).status,
          );
        expect(provisioningStatuses).toContain("cancelled");
        expect(provisioningStatuses).not.toContain("failed");
      }

      await reportQueuedCommandSuccess(harness, cancelCommand, {
        aborted: true,
      });

      expect(getThread(harness.db, firstThread.id)).toMatchObject({
        status: "idle",
      });
      expect(getThread(harness.db, secondThread.id)).toMatchObject({
        status: "idle",
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "destroyed",
      });
    });
  });

  it("marks orphaned provisioning environments interrupted on startup recovery", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-orphaned-env-provision",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        status: "provisioning",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "starting",
      });
      await runStartupRecoverySweep(harness.deps);

      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
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
});
