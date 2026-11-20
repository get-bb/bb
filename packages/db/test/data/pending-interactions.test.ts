import { describe, expect, it } from "vitest";
import { noopNotifier } from "../../src/notifier.js";
import { createEnvironment } from "../../src/data/environments.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  createPendingInteraction,
  getActivePendingInteractionForThread,
  getPendingInteractionByProviderRequest,
  interruptPendingInteractionsForThreadIds,
  interruptPendingInteractionsForThreads,
  listHostThreadIdsWithInterruptiblePendingInteractions,
  listPendingInteractionsByThread,
  setPendingInteractionResolved,
  setPendingInteractionResolving,
} from "../../src/data/pending-interactions.js";
import {
  archiveThread,
  createThread,
  markThreadDeleted,
} from "../../src/data/threads.js";
import { createMigratedConnection } from "../../src/testing.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/test-project",
    },
  });
  const environment = createEnvironment(db, noopNotifier, {
      providerOwnsPath: false,
    projectId: project.id,
    hostId: host.id,
    status: "ready",
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "codex",
  });
  const siblingThread = createThread(db, noopNotifier, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "codex",
  });

  return { db, thread, siblingThread };
}

function commandApprovalPayload(command: string, itemId: string): string {
  return JSON.stringify({
    subject: {
      kind: "command",
      itemId,
      command,
      cwd: "/tmp/project",
    },
    reason: null,
    availableDecisions: ["allow_once", "allow_for_session", "deny"],
  });
}

function fileChangeApprovalPayload(itemId: string): string {
  return JSON.stringify({
    subject: {
      kind: "file_change",
      itemId,
    },
    reason: "Needs file write approval",
    availableDecisions: ["allow_once", "allow_for_session", "deny"],
  });
}

describe("pending interactions", () => {
  it("creates and looks up provider-correlated pending interactions", () => {
    const { db, thread } = setup();

    const created = createPendingInteraction(db, {
      threadId: thread.id,
      turnId: "turn-1",
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      providerRequestId: "request-1",
      payload: commandApprovalPayload("git push", "item-1"),
    });

    expect(created.status).toBe("pending");
    expect(
      getPendingInteractionByProviderRequest(db, {
        providerId: "codex",
        providerThreadId: "provider-thread-1",
        providerRequestId: "request-1",
      })?.id,
    ).toBe(created.id);
    expect(getActivePendingInteractionForThread(db, thread.id)?.id).toBe(
      created.id,
    );
  });

  it("rejects duplicate provider request identities", () => {
    const { db, siblingThread, thread } = setup();
    const created = createPendingInteraction(db, {
      threadId: thread.id,
      turnId: "turn-1",
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      providerRequestId: "request-1",
      payload: commandApprovalPayload("git push", "item-1"),
    });

    expect(() =>
      createPendingInteraction(db, {
        threadId: siblingThread.id,
        turnId: "turn-2",
        providerId: "codex",
        providerThreadId: "provider-thread-1",
        providerRequestId: "request-1",
        payload: commandApprovalPayload("git status", "item-2"),
      }),
    ).toThrow();
    expect(
      getPendingInteractionByProviderRequest(db, {
        providerId: "codex",
        providerThreadId: "provider-thread-1",
        providerRequestId: "request-1",
      })?.id,
    ).toBe(created.id);
  });

  it("lists pending interactions newest first and transitions them to resolved", () => {
    const { db, thread } = setup();

    const older = createPendingInteraction(db, {
      threadId: thread.id,
      turnId: "turn-1",
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      providerRequestId: "request-1",
      payload: commandApprovalPayload("git push", "item-1"),
    });
    const newer = createPendingInteraction(db, {
      threadId: thread.id,
      turnId: "turn-2",
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      providerRequestId: "request-2",
      payload: fileChangeApprovalPayload("item-2"),
    });

    expect(
      listPendingInteractionsByThread(db, { threadId: thread.id }).map(
        (row) => row.id,
      ),
    ).toEqual([newer.id, older.id]);

    const resolved = setPendingInteractionResolved(db, {
      id: older.id,
      resolution: JSON.stringify({
        decision: "allow_for_session",
        grantedPermissions: null,
      }),
    });

    expect(resolved).toMatchObject({
      id: older.id,
      status: "resolved",
    });
  });

  it("interrupts pending interactions for matching provider threads only", () => {
    const { db, thread, siblingThread } = setup();

    const interruptedTarget = createPendingInteraction(db, {
      threadId: thread.id,
      turnId: "turn-1",
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      providerRequestId: "request-1",
      payload: commandApprovalPayload("git push", "item-1"),
    });
    createPendingInteraction(db, {
      threadId: siblingThread.id,
      turnId: "turn-2",
      providerId: "claude-code",
      providerThreadId: "provider-thread-2",
      providerRequestId: "request-2",
      payload: commandApprovalPayload("rm -rf build", "item-2"),
    });

    const interrupted = interruptPendingInteractionsForThreads(db, {
      providerId: "codex",
      threadIds: [thread.id],
      statusReason: "Provider exited",
    });

    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({
      id: interruptedTarget.id,
      status: "interrupted",
      statusReason: "Provider exited",
    });
    expect(
      getActivePendingInteractionForThread(db, siblingThread.id)?.status,
    ).toBe("pending");
  });

  it(
    "chunks provider-thread interrupts to stay under SQLite variable limits",
    () => {
      const { db, siblingThread, thread } = setup();
      const threadIds = Array.from(
        { length: 1_050 },
        (_, index) => `thr_missing_batch_${index}`,
      );
      threadIds[0] = thread.id;
      threadIds[1_000] = siblingThread.id;
      const targetThreadIds = [thread.id, siblingThread.id];

      for (const [index, threadId] of targetThreadIds.entries()) {
        createPendingInteraction(db, {
          threadId,
          turnId: `turn-batched-interrupt-provider-${index}`,
          providerId: "codex",
          providerThreadId: `provider-thread-batched-interrupt-provider-${index}`,
          providerRequestId: `request-batched-interrupt-provider-${index}`,
          payload: commandApprovalPayload(
            "git push",
            `item-batched-interrupt-provider-${index}`,
          ),
        });
      }

      expect(
        new Set(
          interruptPendingInteractionsForThreads(db, {
            providerId: "codex",
            threadIds,
            statusReason: "Provider exited",
          }).map((row) => row.threadId),
        ),
      ).toEqual(new Set(targetThreadIds));
    },
  );

  it("lists exactly the host threads an interrupt of every host thread would reach", () => {
    const db = createMigratedConnection();
    const host = upsertHost(db, noopNotifier, { name: "interrupt-host" });
    const otherHost = upsertHost(db, noopNotifier, { name: "other-host" });
    const { project } = createProject(db, noopNotifier, {
      name: "interrupt-project",
      source: { type: "local_path", hostId: host.id, path: "/tmp/interrupt" },
    });
    const environmentOn = (hostId: string, path: string) =>
      createEnvironment(db, noopNotifier, {
        providerOwnsPath: false,
        projectId: project.id,
        hostId,
        path,
        status: "ready",
      });
    const environment = environmentOn(host.id, "/tmp/interrupt-host");
    const otherEnvironment = environmentOn(otherHost.id, "/tmp/interrupt-other");
    const newThread = (environmentId: string) =>
      createThread(db, noopNotifier, {
        projectId: project.id,
        environmentId,
        providerId: "codex",
      }).id;
    let request = 0;
    const providerInteraction = (threadId: string) =>
      createPendingInteraction(db, {
        threadId,
        turnId: "turn-1",
        providerId: "codex",
        providerThreadId: `provider-${threadId}`,
        providerRequestId: `request-${(request += 1)}`,
        payload: commandApprovalPayload("git push", `item-${request}`),
      });
    const pluginInteraction = (threadId: string) =>
      createPendingInteraction(db, {
        threadId,
        originKind: "plugin",
        pluginId: "plugin-1",
        rendererId: "renderer-1",
        turnId: null,
        payload: "{}",
      });

    const providerPending = newThread(environment.id);
    providerInteraction(providerPending);
    const providerResolving = newThread(environment.id);
    setPendingInteractionResolving(db, {
      id: providerInteraction(providerResolving).id,
      resolution: "{}",
    });
    const providerResolved = newThread(environment.id);
    setPendingInteractionResolved(db, {
      id: providerInteraction(providerResolved).id,
      resolution: "{}",
    });
    const pluginResolving = newThread(environment.id);
    setPendingInteractionResolving(db, {
      id: pluginInteraction(pluginResolving).id,
      resolution: "{}",
    });
    const archivedPending = newThread(environment.id);
    pluginInteraction(archivedPending);
    archiveThread(db, noopNotifier, archivedPending);
    const deletedPending = newThread(environment.id);
    providerInteraction(deletedPending);
    markThreadDeleted(db, noopNotifier, { threadId: deletedPending });
    newThread(environment.id);
    providerInteraction(newThread(otherEnvironment.id));

    const listed = listHostThreadIdsWithInterruptiblePendingInteractions(db, {
      hostId: host.id,
    });
    const interrupted = interruptPendingInteractionsForThreadIds(db, {
      statusReason: "Host daemon disconnected",
      threadIds: [
        providerPending,
        providerResolving,
        providerResolved,
        pluginResolving,
        archivedPending,
        deletedPending,
      ],
    });

    expect([...listed].sort()).toEqual(
      [providerPending, pluginResolving, archivedPending, deletedPending].sort(),
    );
    expect(new Set(interrupted.map((row) => row.threadId))).toEqual(
      new Set(listed),
    );
  });
});
