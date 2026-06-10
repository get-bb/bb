import { getThread, listEvents } from "@bb/db";
import { turnRequestEventDataSchema } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
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
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

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
        automationId: null,
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
        automationId: null,
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
