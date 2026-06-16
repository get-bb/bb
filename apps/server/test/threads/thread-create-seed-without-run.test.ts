import { getThread, listEvents } from "@bb/db";
import { turnRequestEventDataSchema } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import {
  canThreadSpawnChild,
  MAX_THREAD_HIERARCHY_DEPTH,
} from "../../src/services/threads/thread-parent.js";
import {
  listQueuedThreadCommands,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function threadStartTurnRequest(harness: { db: Parameters<typeof listEvents>[0] }, threadId: string) {
  const events = listEvents(harness.db, { threadId });
  const turnRequest = events.find(
    (event) => event.type === "client/turn/requested",
  );
  if (!turnRequest) {
    throw new Error("Expected a client/turn/requested thread-start event");
  }
  return turnRequestEventDataSchema.parse(JSON.parse(turnRequest.data));
}

describe("thread creation with startedOnBehalfOf (seed-without-run)", () => {
  it("persists an agent thread-start anchor without dispatching a provider run", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-seed-without-run",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/seed-without-run-project",
      });
      // A ready source environment lets the unmanaged workspace reuse it so
      // provisioning completes synchronously — the point where a normal start
      // would dispatch a provider run.
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/seed-without-run-project",
      });
      const sourceThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const fork = await createThreadFromRequest(harness.deps, {
        childOrigin: "fork",
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: "/tmp/seed-without-run-project" },
        },
        input: textInput("Forked anchor message"),
        origin: "app",
        parentThreadId: sourceThread.id,
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: {
          initiator: "agent",
          senderThreadId: sourceThread.id,
        },
      });

      // The displayed thread-start turn is attributed to the source agent so it
      // renders as "Message from {source}".
      const turnRequest = threadStartTurnRequest(harness, fork.id);
      expect(turnRequest.initiator).toBe("agent");
      expect(turnRequest.senderThreadId).toBe(sourceThread.id);
      expect(turnRequest.target).toEqual({ kind: "thread-start" });

      // Provisioning is advanced asynchronously; the seed-without-run path lands
      // the thread in `idle` (ready to accept the user's turn) instead of
      // dispatching a provider run.
      await vi.waitFor(() => {
        expect(getThread(harness.db, fork.id)?.status).toBe("idle");
      });

      // Approach A: no provider run is dispatched — the forked agent waits for
      // the user's first message.
      expect(
        listQueuedThreadCommands(harness, "thread.start", fork.id),
      ).toEqual([]);
      expect(getThread(harness.db, fork.id)?.childOrigin).toBe("fork");
    });
  });

  it("dispatches a provider run for a normal user start (no startedOnBehalfOf)", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-normal-start",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/normal-start-project",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/normal-start-project",
      });

      const thread = await createThreadFromRequest(harness.deps, {
        childOrigin: null,
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: "/tmp/normal-start-project" },
        },
        input: textInput("Just start normally"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });

      const turnRequest = threadStartTurnRequest(harness, thread.id);
      expect(turnRequest.initiator).toBe("user");
      expect(turnRequest.senderThreadId).toBeNull();

      // A normal start dispatches the provider thread.start command once
      // provisioning advances.
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      expect(queuedStart.command.type).toBe("thread.start");
    });
  });
});

describe("canThreadSpawnChild", () => {
  it("reflects hierarchy depth against the cap", async () => {
    expect(MAX_THREAD_HIERARCHY_DEPTH).toBe(4);
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-can-spawn-child",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/can-spawn-child-project",
      });

      const root = seedThread(harness.deps, { projectId: project.id });
      const level2 = seedThread(harness.deps, {
        projectId: project.id,
        parentThreadId: root.id,
      });
      const level3 = seedThread(harness.deps, {
        projectId: project.id,
        parentThreadId: level2.id,
      });
      const level4 = seedThread(harness.deps, {
        projectId: project.id,
        parentThreadId: level3.id,
      });

      // Depths 1..3 are below the cap so a new child stays within it.
      expect(canThreadSpawnChild(harness.deps, { thread: root })).toBe(true);
      expect(canThreadSpawnChild(harness.deps, { thread: level2 })).toBe(true);
      expect(canThreadSpawnChild(harness.deps, { thread: level3 })).toBe(true);
      // Depth 4 is at the cap — no further children allowed.
      expect(canThreadSpawnChild(harness.deps, { thread: level4 })).toBe(false);
    });
  });
});

describe("thread creation child-thread boundary validation", () => {
  // Each case shares one project + ready source environment so a parent thread
  // is a live, same-project thread and child creation resolves an environment.
  async function withChildBoundaryHarness(
    name: string,
    run: (args: {
      harness: TestAppHarness;
      hostId: string;
      path: string;
      projectId: string;
      sourceThreadId: string;
    }) => Promise<void>,
  ) {
    await withTestHarness(async (harness) => {
      const path = `/tmp/${name}-project`;
      const { host } = seedHostSession(harness.deps, { id: `host-${name}` });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path,
      });
      const sourceThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      await run({
        harness,
        hostId: host.id,
        path,
        projectId: project.id,
        sourceThreadId: sourceThread.id,
      });
    });
  }

  async function captureCreateError(create: () => Promise<unknown>) {
    try {
      await create();
    } catch (error) {
      if (error instanceof ApiError) {
        return error;
      }
      throw error;
    }
    throw new Error("Expected createThreadFromRequest to throw an ApiError");
  }

  it("rejects startedOnBehalfOf whose senderThreadId differs from parentThreadId", async () => {
    await withChildBoundaryHarness(
      "behalf-sender-mismatch",
      async ({ harness, hostId, path, projectId, sourceThreadId }) => {
        const error = await captureCreateError(() =>
          createThreadFromRequest(harness.deps, {
            childOrigin: "fork",
            environment: {
              type: "host",
              hostId,
              workspace: { type: "unmanaged", path },
            },
            input: textInput("Forged sender"),
            origin: "app",
            parentThreadId: sourceThreadId,
            projectId,
            providerId: "codex",
            startedOnBehalfOf: {
              initiator: "agent",
              senderThreadId: "thr_someone_else",
            },
          }),
        );
        expect(error.status).toBe(400);
        expect(error.body.code).toBe("invalid_request");
        expect(error.body.message).toBe(
          "startedOnBehalfOf.senderThreadId must match parentThreadId",
        );
      },
    );
  });

  it("rejects startedOnBehalfOf without a parentThreadId", async () => {
    await withChildBoundaryHarness(
      "behalf-no-parent",
      async ({ harness, hostId, path, projectId, sourceThreadId }) => {
        const error = await captureCreateError(() =>
          createThreadFromRequest(harness.deps, {
            childOrigin: null,
            environment: {
              type: "host",
              hostId,
              workspace: { type: "unmanaged", path },
            },
            input: textInput("Orphan anchor"),
            origin: "app",
            projectId,
            providerId: "codex",
            startedOnBehalfOf: {
              initiator: "agent",
              senderThreadId: sourceThreadId,
            },
          }),
        );
        expect(error.status).toBe(400);
        expect(error.body.code).toBe("invalid_request");
        expect(error.body.message).toBe(
          "startedOnBehalfOf requires a parentThreadId",
        );
      },
    );
  });

  it("rejects childOrigin without a parentThreadId", async () => {
    await withChildBoundaryHarness(
      "child-origin-no-parent",
      async ({ harness, hostId, path, projectId }) => {
        const error = await captureCreateError(() =>
          createThreadFromRequest(harness.deps, {
            childOrigin: "side-chat",
            environment: {
              type: "host",
              hostId,
              workspace: { type: "unmanaged", path },
            },
            input: textInput("Parentless side chat"),
            origin: "app",
            projectId,
            providerId: "codex",
            startedOnBehalfOf: null,
          }),
        );
        expect(error.status).toBe(400);
        expect(error.body.code).toBe("invalid_request");
        expect(error.body.message).toBe("childOrigin requires a parentThreadId");
      },
    );
  });

  it("rejects startedOnBehalfOf without a childOrigin", async () => {
    await withChildBoundaryHarness(
      "started-on-behalf-no-origin",
      async ({ harness, hostId, path, projectId, sourceThreadId }) => {
        const error = await captureCreateError(() =>
          createThreadFromRequest(harness.deps, {
            childOrigin: null,
            environment: {
              type: "host",
              hostId,
              workspace: { type: "unmanaged", path },
            },
            input: textInput("Untagged seed"),
            origin: "app",
            parentThreadId: sourceThreadId,
            projectId,
            providerId: "codex",
            startedOnBehalfOf: {
              initiator: "agent",
              senderThreadId: sourceThreadId,
            },
          }),
        );
        expect(error.status).toBe(400);
        expect(error.body.code).toBe("invalid_request");
        expect(error.body.message).toBe(
          "startedOnBehalfOf requires a childOrigin",
        );
      },
    );
  });

  it("accepts a fork anchored to its source thread", async () => {
    await withChildBoundaryHarness(
      "valid-fork",
      async ({ harness, hostId, path, projectId, sourceThreadId }) => {
        const fork = await createThreadFromRequest(harness.deps, {
          childOrigin: "fork",
          environment: {
            type: "host",
            hostId,
            workspace: { type: "unmanaged", path },
          },
          input: textInput("Forked anchor"),
          origin: "app",
          parentThreadId: sourceThreadId,
          projectId,
          providerId: "codex",
          startedOnBehalfOf: {
            initiator: "agent",
            senderThreadId: sourceThreadId,
          },
        });
        expect(getThread(harness.db, fork.id)?.childOrigin).toBe("fork");
        expect(getThread(harness.db, fork.id)?.parentThreadId).toBe(
          sourceThreadId,
        );
      },
    );
  });

  it("forks a side chat from the parent's provider session and runs its question", async () => {
    await withChildBoundaryHarness(
      "side-chat-native-fork",
      async ({ harness, hostId, path, projectId, sourceThreadId }) => {
        // Give the parent a live provider session so the side chat clones it.
        seedTurnStarted(harness.deps, {
          threadId: sourceThreadId,
          turnId: "turn-parent",
          providerThreadId: "provider-parent-session",
        });

        const sideChat = await createThreadFromRequest(harness.deps, {
          childOrigin: "side-chat",
          environment: {
            type: "host",
            hostId,
            workspace: { type: "unmanaged", path },
          },
          input: textInput("What did this code do?"),
          origin: "app",
          parentThreadId: sourceThreadId,
          projectId,
          providerId: "codex",
          startedOnBehalfOf: null,
        });

        // The side chat is provisioned as a native fork: the dispatched
        // thread.start carries the parent's provider session id so the child
        // clones the full history, AND it still carries the user's question so
        // the question turn runs immediately.
        const queuedStart = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.start" &&
            command.threadId === sideChat.id,
        );
        if (queuedStart.command.type !== "thread.start") {
          throw new Error("Expected a thread.start command");
        }
        expect(queuedStart.command.fork).toEqual({
          sourceProviderThreadId: "provider-parent-session",
        });
        const startInputText = queuedStart.command.input
          .filter((entry) => entry.type === "text")
          .map((entry) => entry.text)
          .join("\n");
        expect(startInputText).toContain("What did this code do?");
      },
    );
  });

  it("rejects a fork when the parent has no active provider session", async () => {
    await withChildBoundaryHarness(
      "fork-no-parent-session",
      async ({ harness, hostId, path, projectId, sourceThreadId }) => {
        // Parent has no turn/started ⇒ no provider session to clone. A fork is
        // sent with empty input, so there is nothing to run a fresh turn with
        // either. The create must fail rather than dispatch an empty,
        // session-less start.
        const error = await captureCreateError(() =>
          createThreadFromRequest(harness.deps, {
            childOrigin: "fork",
            environment: {
              type: "host",
              hostId,
              workspace: { type: "unmanaged", path },
            },
            input: [],
            origin: "app",
            parentThreadId: sourceThreadId,
            projectId,
            providerId: "codex",
            startedOnBehalfOf: {
              initiator: "agent",
              senderThreadId: sourceThreadId,
            },
          }),
        );
        expect(error.status).toBe(400);
        expect(error.body.code).toBe("invalid_request");
        expect(error.body.message).toBe(
          "Cannot fork: parent has no active session to clone",
        );
      },
    );
  });

  it("accepts a side chat with a parent and null startedOnBehalfOf", async () => {
    await withChildBoundaryHarness(
      "valid-side-chat",
      async ({ harness, hostId, path, projectId, sourceThreadId }) => {
        const sideChat = await createThreadFromRequest(harness.deps, {
          childOrigin: "side-chat",
          environment: {
            type: "host",
            hostId,
            workspace: { type: "unmanaged", path },
          },
          input: textInput("Side chat opener"),
          origin: "app",
          parentThreadId: sourceThreadId,
          projectId,
          providerId: "codex",
          startedOnBehalfOf: null,
        });
        expect(getThread(harness.db, sideChat.id)?.childOrigin).toBe(
          "side-chat",
        );
        expect(getThread(harness.db, sideChat.id)?.parentThreadId).toBe(
          sourceThreadId,
        );
      },
    );
  });
});
