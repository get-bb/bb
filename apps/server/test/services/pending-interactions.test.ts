import { setTimeout as sleep } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { pendingInteractions as pendingInteractionTable } from "@bb/db";
import type { PendingInteractionCreate } from "@bb/domain";
import { handleHostSessionOpened } from "../../src/internal/session-owner-side-effects.js";
import { PendingInteractionLifecycle } from "../../src/services/interactions/pending-interactions.js";
import type { AppDeps } from "../../src/types.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedSession,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  createAllowForSessionResolution,
  createAllowOnceResolution,
  createCommandApprovalPayload,
  createFileChangeApprovalPayload,
  createPermissionGrantApprovalPayload,
  createUserAnswerResolution,
  createUserQuestionPayload,
} from "../helpers/pending-interactions.js";
import { withTestHarness } from "../helpers/test-app.js";

function registerPendingInteraction(
  deps: Pick<AppDeps, "db" | "hub">,
  lifecycle: PendingInteractionLifecycle,
  interaction: PendingInteractionCreate,
) {
  seedTurnStarted(deps, {
    threadId: interaction.threadId,
    turnId: interaction.turnId,
    providerThreadId: interaction.providerThreadId,
  });
  return lifecycle.registerPendingInteraction({
    interaction,
  });
}

describe("pending interaction lifecycle", () => {
  it("includes project and pending state metadata in interaction change notifications", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-notification-metadata",
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
      });
      const notifyThread = vi.spyOn(harness.hub, "notifyThread");

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-notification-metadata-1",
          providerId: "codex",
          providerThreadId: "provider-thread-notification-metadata",
          providerRequestId: "request-notification-metadata",
          payload: createCommandApprovalPayload({
            itemId: "item-notification-metadata-1",
            reason: "Needs approval",
            command: "git status",
            cwd: "/tmp/project",
          }),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      expect(notifyThread).toHaveBeenCalledWith(
        thread.id,
        ["interactions-changed"],
        { hasPendingInteraction: true, projectId: project.id },
      );

      harness.deps.pendingInteractions.completeResolvingInteraction({
        interactionId: created.interaction.id,
        resolution: createAllowOnceResolution(),
      });

      expect(notifyThread).toHaveBeenCalledWith(
        thread.id,
        ["interactions-changed"],
        { hasPendingInteraction: false, projectId: project.id },
      );
    });
  });

  it("skips corrupt rows when listing pending interactions", async () => {
    await withTestHarness(async (harness) => {
      const logger = {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      };
      const lifecycle = new PendingInteractionLifecycle({
        config: harness.deps.config,
        db: harness.db,
        hub: harness.hub,
        lifecycleDedupers: harness.deps.lifecycleDedupers,
        logger,
        machineAuth: harness.deps.machineAuth,
        telemetry: harness.deps.telemetry,
        terminalSessions: harness.deps.terminalSessions,
      });
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-corrupt-list",
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
      });

      const corrupt = registerPendingInteraction(harness.deps, lifecycle, {
        threadId: thread.id,
        turnId: "turn-corrupt-list-1",
        providerId: "codex",
        providerThreadId: "provider-thread-corrupt-list",
        providerRequestId: "request-corrupt-list-1",
        payload: createCommandApprovalPayload({
          itemId: "item-corrupt-list-1",
          reason: "Needs approval",
          command: "git push",
          cwd: "/tmp/project",
        }),
      });
      if (corrupt.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${corrupt.reason}`,
        );
      }

      harness.db
        .update(pendingInteractionTable)
        .set({
          status: "resolved",
          resolution: "{",
          resolvedAt: Date.now(),
        })
        .where(eq(pendingInteractionTable.id, corrupt.interaction.id))
        .run();

      const valid = registerPendingInteraction(harness.deps, lifecycle, {
        threadId: thread.id,
        turnId: "turn-corrupt-list-2",
        providerId: "codex",
        providerThreadId: "provider-thread-corrupt-list",
        providerRequestId: "request-corrupt-list-2",
        payload: createCommandApprovalPayload({
          itemId: "item-corrupt-list-2",
          reason: "Needs approval",
          command: "git status",
          cwd: "/tmp/project",
        }),
      });
      if (valid.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${valid.reason}`,
        );
      }

      expect(lifecycle.listThreadInteractions(thread.id)).toEqual([
        valid.interaction,
      ]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          field: "resolution",
          interactionId: corrupt.interaction.id,
        }),
        "Skipping corrupt pending interaction row",
      );
      expect(() =>
        lifecycle.getThreadInteraction({
          threadId: thread.id,
          interactionId: corrupt.interaction.id,
        }),
      ).toThrow("Stored pending interaction resolution is invalid");
    });
  });

  it("resolves user-question interactions with user answers", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-user-question-answer",
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
        providerId: "claude-code",
      });

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-user-question-answer",
          providerId: "claude-code",
          providerThreadId: "provider-thread-user-question-answer",
          providerRequestId: "request-user-question-answer",
          payload: createUserQuestionPayload(),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      const answerResolution = createUserAnswerResolution({
        freeText: "Use staging until QA signs off.",
      });
      const resolving =
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
          resolution: answerResolution,
        });

      expect(resolving).toMatchObject({
        id: created.interaction.id,
        resolution: answerResolution,
        status: "resolving",
      });

      const completed =
        harness.deps.pendingInteractions.completeResolvingInteraction({
          interactionId: created.interaction.id,
          resolution: answerResolution,
        });

      expect(completed).toMatchObject({
        id: created.interaction.id,
        resolution: answerResolution,
        status: "resolved",
      });
    });
  });

  it("interrupts pending user-question interactions without orphaning state", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-user-question-interrupted",
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
        providerId: "claude-code",
      });

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-user-question-interrupted",
          providerId: "claude-code",
          providerThreadId: "provider-thread-user-question-interrupted",
          providerRequestId: "request-user-question-interrupted",
          payload: createUserQuestionPayload(),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      const interrupted =
        harness.deps.pendingInteractions.interruptPendingInteraction({
          interactionId: created.interaction.id,
          reason: "Provider exited",
        });

      expect(interrupted).toMatchObject({
        id: created.interaction.id,
        resolution: null,
        status: "interrupted",
        statusReason: "Provider exited",
      });
      expect(() =>
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
          resolution: createUserAnswerResolution(),
        }),
      ).toThrowError(
        `Pending interaction ${created.interaction.id} is already interrupted`,
      );
    });
  });

  it("rejects reused provider request ids after the original interaction is terminal", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-terminal-dedupe",
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
      });

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-terminal-dedupe-1",
          providerId: "codex",
          providerThreadId: "provider-thread-terminal-dedupe",
          providerRequestId: "request-terminal-dedupe",
          payload: createCommandApprovalPayload({
            itemId: "item-terminal-dedupe-1",
            reason: "Needs approval",
            command: "git push",
            cwd: "/tmp/project",
          }),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      harness.deps.pendingInteractions.resolvePendingInteraction({
        threadId: thread.id,
        interactionId: created.interaction.id,
        resolution: createAllowOnceResolution(),
      });
      harness.deps.pendingInteractions.completeResolvingInteraction({
        interactionId: created.interaction.id,
        resolution: createAllowOnceResolution(),
      });

      expect(
        registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: "turn-terminal-dedupe-2",
            providerId: "codex",
            providerThreadId: "provider-thread-terminal-dedupe",
            providerRequestId: "request-terminal-dedupe",
            payload: createCommandApprovalPayload({
              itemId: "item-terminal-dedupe-2",
              reason: "Needs approval again",
              command: "git push",
              cwd: "/tmp/project",
              availableDecisions: ["allow_once", "deny"],
            }),
          },
        ),
      ).toEqual({
        outcome: "rejected",
        reason:
          "Provider request request-terminal-dedupe was already handled and cannot be reused",
      });
    });
  });

  it("deduplicates active provider requests across daemon sessions when payloads match", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-reconnect-dedupe",
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
      });
      const interaction: PendingInteractionCreate = {
        threadId: thread.id,
        turnId: "turn-reconnect-dedupe",
        providerId: "codex",
        providerThreadId: "provider-thread-reconnect-dedupe",
        providerRequestId: "request-reconnect-dedupe",
        payload: createCommandApprovalPayload({
          itemId: "item-reconnect-dedupe",
          reason: "Needs approval",
          command: "git push",
          cwd: "/tmp/project",
        }),
      };

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        interaction,
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      const duplicate = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        interaction,
      );

      expect(duplicate).toEqual({
        outcome: "existing",
        interaction: created.interaction,
      });
    });
  });

  it("interrupts resolving interactions when a replacement session reuses the same instance id", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-same-instance-reconnect",
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
      });
      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-same-instance-reconnect",
          providerId: "codex",
          providerThreadId: "provider-thread-same-instance-reconnect",
          providerRequestId: "request-same-instance-reconnect",
          payload: createUserQuestionPayload(),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }
      harness.deps.pendingInteractions.resolvePendingInteraction({
        threadId: thread.id,
        interactionId: created.interaction.id,
        resolution: createUserAnswerResolution({
          freeText: "Use the existing branch.",
        }),
      });

      const replacementSession = seedSession(harness.deps, host.id);
      await handleHostSessionOpened(harness.deps, {
        activeThreads: [],
        hostId: host.id,
        openedSession: replacementSession,
        previousSession: session,
      });

      const row = harness.db
        .select()
        .from(pendingInteractionTable)
        .where(eq(pendingInteractionTable.id, created.interaction.id))
        .get();
      expect(row).toMatchObject({
        status: "interrupted",
        statusReason:
          "Host daemon disconnected while awaiting user interaction; retry the thread to continue",
      });
    });
  });

  it("rejects active provider request reuse with a different payload", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-reconnect-payload-mismatch",
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
      });
      const baseInteraction: PendingInteractionCreate = {
        threadId: thread.id,
        turnId: "turn-reconnect-payload-mismatch",
        providerId: "codex",
        providerThreadId: "provider-thread-reconnect-payload-mismatch",
        providerRequestId: "request-reconnect-payload-mismatch",
        payload: createCommandApprovalPayload({
          itemId: "item-reconnect-payload-mismatch",
          reason: "Needs approval",
          command: "git push",
          cwd: "/tmp/project",
        }),
      };

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        baseInteraction,
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      expect(
        registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            ...baseInteraction,
            payload: createCommandApprovalPayload({
              itemId: "item-reconnect-payload-mismatch",
              reason: "Different approval",
              command: "git push",
              cwd: "/tmp/project",
            }),
          },
        ),
      ).toEqual({
        outcome: "rejected",
        reason:
          "Provider request request-reconnect-payload-mismatch is already awaiting a different interaction payload",
      });
    });
  });

  it("rejects interactions from providers that do not own the thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-provider-mismatch",
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
        providerId: "codex",
      });

      expect(
        registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: "turn-provider-mismatch",
            providerId: "claude-code",
            providerThreadId: "provider-thread-provider-mismatch",
            providerRequestId: "request-provider-mismatch",
            payload: createCommandApprovalPayload({
              itemId: "item-provider-mismatch",
              reason: "Needs approval",
              command: "git push",
              cwd: "/tmp/project",
              availableDecisions: ["allow_once", "deny"],
            }),
          },
        ),
      ).toEqual({
        outcome: "rejected",
        reason: `Thread ${thread.id} belongs to provider codex, not claude-code`,
      });
    });
  });

  it("treats reordered permission grants as idempotent resolution retries", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-idempotent-permissions",
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
      });

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-idempotent-permissions",
          providerId: "codex",
          providerThreadId: "provider-thread-idempotent-permissions",
          providerRequestId: "request-idempotent-permissions",
          payload: createPermissionGrantApprovalPayload({
            itemId: "item-idempotent-permissions",
            reason: "Needs workspace access",
            toolName: "Bash",
            permissions: {
              network: null,
              fileSystem: {
                read: ["/tmp/project/a", "/tmp/project/b"],
                write: ["/tmp/project/c", "/tmp/project/d"],
              },
            },
          }),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      const firstResolution =
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
          resolution: createAllowOnceResolution({
            network: null,
            fileSystem: {
              read: ["/tmp/project/a", "/tmp/project/b"],
              write: ["/tmp/project/c", "/tmp/project/d"],
            },
          }),
        });
      expect(firstResolution.status).toBe("resolving");

      const retryResolution =
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
          resolution: createAllowOnceResolution({
            network: null,
            fileSystem: {
              read: ["/tmp/project/b", "/tmp/project/a"],
              write: ["/tmp/project/d", "/tmp/project/c"],
            },
          }),
        });

      expect(retryResolution).toMatchObject({
        id: created.interaction.id,
        status: "resolving",
        resolution: firstResolution.resolution,
      });
      const resolvingRow = harness.db
        .select()
        .from(pendingInteractionTable)
        .where(eq(pendingInteractionTable.id, created.interaction.id))
        .get();
      expect(resolvingRow).toMatchObject({
        status: "resolving",
        resolution: JSON.stringify(firstResolution.resolution),
      });

      const completed =
        harness.deps.pendingInteractions.completeResolvingInteraction({
          interactionId: created.interaction.id,
          resolution: createAllowOnceResolution({
            network: null,
            fileSystem: {
              read: ["/tmp/project/a", "/tmp/project/b"],
              write: ["/tmp/project/c", "/tmp/project/d"],
            },
          }),
        });
      expect(completed?.status).toBe("resolved");
      const resolvedRow = harness.db
        .select()
        .from(pendingInteractionTable)
        .where(eq(pendingInteractionTable.id, created.interaction.id))
        .get();
      expect(resolvedRow).toMatchObject({
        status: "resolved",
      });
    });
  });

  it("rejects permission allow resolutions that grant nothing", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-empty-grant",
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
      });

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-empty-grant",
          providerId: "codex",
          providerThreadId: "provider-thread-empty-grant",
          providerRequestId: "request-empty-grant",
          payload: createPermissionGrantApprovalPayload({
            itemId: "item-empty-grant",
            reason: "Needs network access",
            toolName: "WebFetch",
            permissions: {
              network: { enabled: true },
              fileSystem: null,
            },
          }),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      expect(() =>
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
          resolution: createAllowForSessionResolution({
            network: null,
            fileSystem: null,
          }),
        }),
      ).toThrow(
        "Allowed permission resolutions must grant at least one permission",
      );

      expect(
        harness.deps.pendingInteractions.getThreadInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
        }).status,
      ).toBe("pending");
    });
  });

  it("allows command approvals to grant explicit session permissions for session decisions", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-command-grant",
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
      });

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-command-grant",
          providerId: "codex",
          providerThreadId: "provider-thread-command-grant",
          providerRequestId: "request-command-grant",
          payload: createCommandApprovalPayload({
            itemId: "item-command-grant",
            reason: "Needs network",
            command: "curl https://example.com",
            sessionGrant: {
              network: { enabled: true },
              fileSystem: null,
            },
          }),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      expect(
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
          resolution: createAllowForSessionResolution({
            network: { enabled: true },
            fileSystem: null,
          }),
        }),
      ).toEqual(
        expect.objectContaining({
          status: "resolving",
          resolution: expect.objectContaining({
            decision: "allow_for_session",
            grantedPermissions: {
              network: { enabled: true },
              fileSystem: null,
            },
          }),
        }),
      );
    });
  });

  it("rejects narrowed command session approval grants", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-narrowed-command-grant",
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
      });

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-narrowed-command-grant",
          providerId: "codex",
          providerThreadId: "provider-thread-narrowed-command-grant",
          providerRequestId: "request-narrowed-command-grant",
          payload: createCommandApprovalPayload({
            itemId: "item-narrowed-command-grant",
            reason: "Needs network and file access",
            command: "curl https://example.com > out.txt",
            sessionGrant: {
              network: { enabled: true },
              fileSystem: {
                read: [],
                write: ["/tmp/project"],
              },
            },
          }),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      expect(() =>
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
          resolution: createAllowForSessionResolution({
            network: { enabled: true },
            fileSystem: null,
          }),
        }),
      ).toThrow(
        "Command and file-change session approvals must grant the requested session permissions exactly",
      );
    });
  });

  it("rejects session command approvals without granted permissions", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-null-session-grant",
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
      });

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-null-session-grant",
          providerId: "codex",
          providerThreadId: "provider-thread-null-session-grant",
          providerRequestId: "request-null-session-grant",
          payload: createCommandApprovalPayload({
            itemId: "item-null-session-grant",
            reason: "Needs network",
            command: "curl https://example.com",
            sessionGrant: {
              network: { enabled: true },
              fileSystem: null,
            },
          }),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      expect(() =>
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
          resolution: createAllowForSessionResolution(null),
        }),
      ).toThrow(
        "Session approval resolutions must include granted permissions",
      );
    });
  });

  it("rejects file-change approvals that try to grant write-scope permissions", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-file-change-grant",
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
      });

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-file-change-grant",
          providerId: "codex",
          providerThreadId: "provider-thread-file-change-grant",
          providerRequestId: "request-file-change-grant",
          payload: createFileChangeApprovalPayload({
            itemId: "item-file-change-grant",
            reason: "Needs file write approval",
            writeScope: "/tmp/project",
            availableDecisions: ["allow_once", "allow_for_session", "deny"],
          }),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      expect(() =>
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
          resolution: createAllowForSessionResolution({
            network: null,
            fileSystem: {
              read: [],
              write: ["/tmp/project"],
            },
          }),
        }),
      ).toThrow(
        "This approval subject and decision cannot grant the requested permissions",
      );
    });
  });

  it("rejects a second active interaction on the same thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-concurrent-reject",
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
      });

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-concurrent-reject-1",
          providerId: "codex",
          providerThreadId: "provider-thread-concurrent-reject",
          providerRequestId: "request-concurrent-reject-1",
          payload: createCommandApprovalPayload({
            itemId: "item-concurrent-reject-1",
            reason: "Needs approval",
            command: "git push",
            cwd: "/tmp/project",
          }),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      expect(
        registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: "turn-concurrent-reject-2",
            providerId: "codex",
            providerThreadId: "provider-thread-concurrent-reject",
            providerRequestId: "request-concurrent-reject-2",
            payload: createFileChangeApprovalPayload({
              itemId: "item-concurrent-reject-2",
              reason: "Needs file write approval",
            }),
          },
        ),
      ).toEqual({
        outcome: "rejected",
        reason: `Thread ${thread.id} is already awaiting user interaction`,
      });
    });
  });

  it("rejects command approvals with no available decisions", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-empty-decisions",
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
      });

      expect(
        registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: "turn-empty-decisions",
            providerId: "codex",
            providerThreadId: "provider-thread-empty-decisions",
            providerRequestId: "request-empty-decisions",
            payload: createCommandApprovalPayload({
              itemId: "item-empty-decisions",
              reason: "Needs approval",
              command: "git push",
              cwd: "/tmp/project",
              availableDecisions: [],
            }),
          },
        ),
      ).toEqual({
        outcome: "rejected",
        reason: "Approvals must include at least one available decision",
      });
    });
  });

  it("rejects resolving interrupted interactions", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-resolve-interrupted",
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
      });

      const created = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-resolve-interrupted",
          providerId: "codex",
          providerThreadId: "provider-thread-resolve-interrupted",
          providerRequestId: "request-resolve-interrupted",
          payload: createCommandApprovalPayload({
            itemId: "item-resolve-interrupted",
            reason: "Needs approval",
            command: "git push",
            cwd: "/tmp/project",
          }),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      harness.deps.pendingInteractions.interruptPendingInteraction({
        interactionId: created.interaction.id,
        reason: "Provider exited",
      });

      expect(() =>
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
          resolution: createAllowOnceResolution(),
        }),
      ).toThrowError(
        `Pending interaction ${created.interaction.id} is already interrupted`,
      );
    });
  });

  it("does not expire pending interactions on persistent hosts", async () => {
    await withTestHarness(async (harness) => {
      const pendingInteractions = new PendingInteractionLifecycle({
        config: harness.deps.config,
        db: harness.db,
        hub: harness.hub,
        lifecycleDedupers: harness.deps.lifecycleDedupers,
        logger: harness.deps.logger,
        machineAuth: harness.deps.machineAuth,
        telemetry: harness.deps.telemetry,
        terminalSessions: harness.deps.terminalSessions,
      });
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-no-expiry",
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
      });

      const created = registerPendingInteraction(
        harness.deps,
        pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-no-expiry",
          providerId: "codex",
          providerThreadId: "provider-thread-no-expiry",
          providerRequestId: "request-no-expiry",
          payload: createCommandApprovalPayload({
            itemId: "item-no-expiry",
            reason: "Needs approval",
            command: "git push",
            cwd: "/tmp/project",
          }),
        },
      );
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }

      await sleep(50);

      expect(
        pendingInteractions.getThreadInteraction({
          threadId: thread.id,
          interactionId: created.interaction.id,
        }).status,
      ).toBe("pending");
    });
  });
});
