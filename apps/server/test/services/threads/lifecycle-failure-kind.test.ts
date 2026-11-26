import { eq } from "drizzle-orm";
import {
  environments,
  getThread,
  listThreadsWithPendingInteractionState,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { runThreadLifecycleTransaction } from "../../../src/services/threads/lifecycle/run.js";
import type { ThreadLifecycleInput } from "../../../src/services/threads/lifecycle/machine.js";
import {
  toThreadListEntryResponses,
  toThreadResponseFromThread,
} from "../../../src/services/threads/thread-runtime-display.js";
import type { AppDeps } from "../../../src/types.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const HOST_ID = "host-failure";

const sendThreadStart: ThreadLifecycleInput = {
  type: "request.sent",
  request: {
    hostId: HOST_ID,
    kind: "thread-start",
    requestId: "creq_start",
    syncTitle: false,
  },
  now: 1,
};

interface FailureCase {
  name: string;
  failureKind: "provisioning" | null;
  withEnvironment: boolean;
  inputs: readonly ThreadLifecycleInput[];
  removeEnvironment?: boolean;
}

const CASES: readonly FailureCase[] = [
  {
    name: "provisioning failed",
    failureKind: "provisioning",
    withEnvironment: false,
    inputs: [{ type: "provisioning.failed" }],
  },
  {
    name: "the daemon was lost during the thread start",
    failureKind: null,
    withEnvironment: false,
    inputs: [
      sendThreadStart,
      { type: "daemon.lost", reason: "host-daemon-restarted", resuming: false },
    ],
  },
  {
    name: "the daemon refused the thread start command",
    failureKind: null,
    withEnvironment: false,
    inputs: [
      sendThreadStart,
      {
        type: "request.answered",
        requestId: "creq_start",
        answer: {
          kind: "refused",
          code: "provider_unavailable",
          commandType: "thread.start",
          expectedTurnCompleted: false,
          message: "Provider unavailable",
          scopeTurnId: null,
        },
      },
    ],
  },
  {
    name: "the provider failed before the thread started",
    failureKind: null,
    withEnvironment: false,
    inputs: [
      sendThreadStart,
      { type: "provider.failed", unstartedRequestId: "creq_start" },
    ],
  },
  {
    name: "a failed thread's environment row was deleted",
    failureKind: null,
    withEnvironment: true,
    removeEnvironment: true,
    inputs: [{ type: "provider.failed", unstartedRequestId: null }],
  },
];

function seedStartingThread(harness: TestAppHarness, withEnvironment: boolean) {
  const { host } = seedHostSession(harness.deps, { id: HOST_ID });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = withEnvironment
    ? seedEnvironment(harness.deps, { hostId: host.id, projectId: project.id })
    : null;
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment?.id ?? null,
    status: "starting",
  });
  return { environment, project, thread };
}

function reportedFailure(deps: AppDeps, threadId: string, projectId: string) {
  const thread = getThread(deps.db, threadId);
  if (thread === null) throw new Error(`missing thread ${threadId}`);
  const [entry] = toThreadListEntryResponses(deps, {
    threads: listThreadsWithPendingInteractionState(deps.db, {
      projectId,
    }).filter((row) => row.id === threadId),
  });
  return {
    status: thread.status,
    environmentId: thread.environmentId,
    stored: thread.failureKind,
    response: toThreadResponseFromThread(deps, { thread }).runtime.failure,
    listEntry: entry?.runtime.failure,
  };
}

describe("thread failure kind", () => {
  it.each(CASES)(
    "records $failureKind when $name with no environment",
    async (testCase) => {
      await withTestHarness(async (harness) => {
        const { environment, project, thread } = seedStartingThread(
          harness,
          testCase.withEnvironment,
        );
        for (const input of testCase.inputs) {
          const outcome = runThreadLifecycleTransaction(
            harness.deps,
            thread.id,
            input,
          );
          expect(outcome.refusal).toBeNull();
        }
        if (testCase.removeEnvironment && environment !== null) {
          harness.db
            .delete(environments)
            .where(eq(environments.id, environment.id))
            .run();
        }

        expect(reportedFailure(harness.deps, thread.id, project.id)).toEqual({
          status: "error",
          environmentId: null,
          stored: testCase.failureKind,
          response: testCase.failureKind,
          listEntry: testCase.failureKind,
        });
      });
    },
  );

  it("clears the provisioning failure when the thread is retried", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread } = seedStartingThread(harness, false);
      runThreadLifecycleTransaction(harness.deps, thread.id, {
        type: "provisioning.failed",
      });
      expect(reportedFailure(harness.deps, thread.id, project.id).stored).toBe(
        "provisioning",
      );

      const retried = runThreadLifecycleTransaction(harness.deps, thread.id, {
        type: "provisioning.started",
      });

      expect(retried.refusal).toBeNull();
      expect(reportedFailure(harness.deps, thread.id, project.id)).toEqual({
        status: "starting",
        environmentId: null,
        stored: null,
        response: null,
        listEntry: null,
      });
    });
  });
});
