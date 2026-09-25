import {
  getQueuedThreadMessage,
  listEvents,
  listQueuedThreadMessages,
} from "@bb/db";
import { turnRequestEventDataSchema } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { finalizeStoppedThread } from "../../src/services/threads/thread-lifecycle.js";
import { interruptEnvironmentProvisioningForHost } from "../../src/services/environments/environment-engine.js";
import { failThreadProvisioning } from "../../src/services/threads/thread-provisioning-environment.js";
import { recordQueuedMessageDrainFailure } from "../../src/services/threads/queue-drain-failure.js";
import {
  seedQueuedMessage,
  seedEnvironment,
  seedHost,
  seedThread,
  seedThreadFixture,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedParentAndChild(
  harness: TestAppHarness,
  childStatus: "active" | "starting" | "idle",
) {
  const { project, environment, thread: parent } = seedThreadFixture(harness);
  seedThreadRuntimeState(harness.deps, {
    threadId: parent.id,
    environmentId: environment.id,
    providerThreadId: "parent-provider-thread",
  });
  const child = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    parentThreadId: parent.id,
    status: childStatus,
    title: "Worker child",
  });
  return { parent, child, environment };
}

function parentSystemRequests(harness: TestAppHarness, parentThreadId: string) {
  return listEvents(harness.db, { threadId: parentThreadId })
    .filter((row) => row.type === "client/turn/requested")
    .map((row) => turnRequestEventDataSchema.parse(JSON.parse(row.data)))
    .filter((data) => data.initiator === "system");
}

afterEach(() => vi.useRealTimers());

describe("child outcomes without provider completion", () => {
  it("notifies the parent when Stop synthesizes an open turn interruption", async () => {
    await withTestHarness(async (harness) => {
      const { parent, child, environment } = seedParentAndChild(
        harness,
        "active",
      );
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: child.id,
        turnId: "child-turn",
      });

      vi.useFakeTimers();
      finalizeStoppedThread(harness.deps, { threadId: child.id });
      finalizeStoppedThread(harness.deps, { threadId: child.id });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(parentSystemRequests(harness, parent.id)).toMatchObject([
        { systemMessageKind: "child-interrupted" },
      ]);
    });
  });

  it("notifies the parent when setup fails before the child starts a turn", async () => {
    await withTestHarness(async (harness) => {
      const { parent, child, environment } = seedParentAndChild(
        harness,
        "starting",
      );

      vi.useFakeTimers();
      failThreadProvisioning(harness.deps, {
        thread: child,
        environmentId: environment.id,
        detail: "Workspace setup failed",
      });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(parentSystemRequests(harness, parent.id)).toMatchObject([
        { systemMessageKind: "child-failed" },
      ]);
      expect(
        JSON.stringify(parentSystemRequests(harness, parent.id)[0]?.input),
      ).toContain("failed during workspace setup before a turn began");
    });
  });

  it("notifies the parent when an environment fails during setup", async () => {
    await withTestHarness(async (harness) => {
      const { parent } = seedParentAndChild(harness, "idle");
      const host = seedHost(harness.deps);
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: parent.projectId,
        status: "provisioning",
      });
      seedThread(harness.deps, {
        projectId: parent.projectId,
        environmentId: environment.id,
        parentThreadId: parent.id,
        status: "starting",
      });

      vi.useFakeTimers();
      interruptEnvironmentProvisioningForHost(harness.deps, {
        hostId: host.id,
        reason: "Host disconnected during setup",
      });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(parentSystemRequests(harness, parent.id)).toMatchObject([
        { systemMessageKind: "child-failed" },
      ]);
    });
  });

  it("notifies the parent only after a queued send exhausts retries", async () => {
    await withTestHarness(async (harness) => {
      const { parent, child } = seedParentAndChild(harness, "idle");
      const row = seedQueuedMessage(harness.deps, {
        threadId: child.id,
        content: textInput("Continue the child work"),
        waitingOn: { kind: "thread-busy" },
      });

      vi.useFakeTimers();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        recordQueuedMessageDrainFailure(harness.deps, {
          error: new Error("dispatch failed"),
          now: Date.now(),
          row,
          thread: child,
        });
      }
      expect(
        getQueuedThreadMessage(harness.db, row.id)?.nextAttemptAt,
      ).not.toBeNull();
      expect(parentSystemRequests(harness, parent.id)).toHaveLength(0);

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new Error("dispatch failed"),
        now: Date.now(),
        row,
        thread: child,
      });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(
        getQueuedThreadMessage(harness.db, row.id)?.nextAttemptAt,
      ).toBeNull();
      expect(parentSystemRequests(harness, parent.id)).toMatchObject([
        { systemMessageKind: "child-failed" },
      ]);
      expect(
        JSON.stringify(parentSystemRequests(harness, parent.id)[0]?.input),
      ).toContain("could not send a queued message after retrying");
      expect(listQueuedThreadMessages(harness.db, parent.id)).toHaveLength(0);
    });
  });
});
