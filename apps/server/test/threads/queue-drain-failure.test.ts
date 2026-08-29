import {
  getQueuedThreadMessage,
  listEvents,
  setQueuedThreadMessageFailureReason,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import { recordQueuedMessageDrainFailure } from "../../src/services/threads/queue-drain-failure.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/queue-drain-failure-project";

/**
 * A thread with a parked row on a host that is either connected or not.
 *
 * `seedHostSession` opens a daemon session; `seedHost` alone leaves the host
 * enrolled but away, which is exactly the state a drain hits when a laptop
 * shuts. Nothing else about the fixture differs, so a test that flips this flag
 * is testing the host's liveness and nothing else.
 */
function seedParkedRow(
  harness: TestAppHarness,
  args: { hostConnected: boolean; hostName: string; sendAt?: number },
) {
  const host = args.hostConnected
    ? seedHostSession(harness.deps, { name: args.hostName }).host
    : seedHost(harness.deps, { name: args.hostName });
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
  });
  const row = seedQueuedMessage(harness.deps, {
    threadId: thread.id,
    content: textInput("Capture the Safari trace"),
    waitingOn: { kind: "thread-busy" },
    ...(args.sendAt === undefined ? {} : { sendAt: args.sendAt }),
  });
  return { host, thread, row };
}

function reread(harness: TestAppHarness, queuedMessageId: string) {
  const row = getQueuedThreadMessage(harness.db, queuedMessageId);
  if (row === null) throw new Error("the parked row vanished");
  return toThreadQueuedMessage(row);
}

describe("recordQueuedMessageDrainFailure", () => {
  it("re-parks on the named host when the machine is the thing that is missing", async () => {
    await withTestHarness(async (harness) => {
      const { thread, row } = seedParkedRow(harness, {
        hostConnected: false,
        hostName: "M4",
        // A due row that could not be delivered: the instant has passed and
        // keeping it would leave the due sweep re-claiming a row that cannot go.
        sendAt: Date.now() - 1_000,
      });

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new ApiError(502, "host_unavailable", "Host is not connected"),
        row,
        thread,
      });

      const parked = reread(harness, row.id);
      expect(parked.waitingOn).toEqual({ kind: "host-offline", hostName: "M4" });
      expect(parked.sendAt).toBeNull();
      // An absent machine is a wait, not a failure: the row recovers by itself
      // when the host comes back, so presenting it as an error would be wrong.
      expect(parked.failureReason).toBeNull();
      // A drain failure changes the row, not the transcript.
      expect(listEvents(harness.db, { threadId: thread.id })).toEqual([]);
    });
  });

  it("records the reason and keeps the wait when the host is present", async () => {
    await withTestHarness(async (harness) => {
      const { thread, row } = seedParkedRow(harness, {
        hostConnected: true,
        hostName: "M4",
      });

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new ApiError(409, "thread_not_writable", "Thread is archived"),
        row,
        thread,
      });

      const parked = reread(harness, row.id);
      expect(parked.failureReason).toBe("Thread is archived");
      // The row is still parked on what parked it. A failure says what went
      // wrong last time, not what the row is waiting for, and a park would
      // have erased it on the very next attempt.
      expect(parked.waitingOn).toEqual({ kind: "thread-busy" });
      expect(listEvents(harness.db, { threadId: thread.id })).toEqual([]);
    });
  });

  it("does not leak an internal fault's wording onto the row", async () => {
    await withTestHarness(async (harness) => {
      const { thread, row } = seedParkedRow(harness, {
        hostConnected: true,
        hostName: "M4",
      });

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new Error("Cannot read properties of undefined (reading 'id')"),
        row,
        thread,
      });

      // `ApiError` messages are written for a caller; anything else was
      // written for a log and has no business on a queued row.
      expect(reread(harness, row.id).failureReason).toBe(
        "The message could not be sent.",
      );
    });
  });

  it("lets a later successful park clear a failure the row was showing", async () => {
    await withTestHarness(async (harness) => {
      const { thread, row } = seedParkedRow(harness, {
        hostConnected: false,
        hostName: "M4",
      });

      setQueuedThreadMessageFailureReason(harness.db, harness.deps.hub, {
        id: row.id,
        threadId: row.threadId,
        failureReason: "Thread is archived",
      });

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new ApiError(502, "host_unavailable", "Host is not connected"),
        row,
        thread,
      });

      // The host is away, so this attempt re-parks rather than failing — and a
      // fresh statement of why the row is waiting supersedes the stale failure
      // instead of showing the reader two contradictory explanations.
      const parked = reread(harness, row.id);
      expect(parked.waitingOn).toEqual({ kind: "host-offline", hostName: "M4" });
      expect(parked.failureReason).toBeNull();
    });
  });
});
