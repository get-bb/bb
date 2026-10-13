import { setExperiments } from "@bb/db";
import { turnScope, type Thread } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import {
  internalAuthHeaders,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PROVIDER_THREAD_ID = "provider-turn-trace";

afterEach(() => vi.restoreAllMocks());

function seedIdleThread(harness: TestAppHarness): {
  sessionId: string;
  thread: Thread;
} {
  const { host, session } = seedHostSession(harness.deps, {
    id: "host-turn-trace",
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/turn-trace",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/turn-trace",
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: PROVIDER_THREAD_ID,
    threadId: thread.id,
  });
  return { sessionId: session.id, thread };
}

async function postEvents(
  harness: TestAppHarness,
  sessionId: string,
  envelopes: HostDaemonEventEnvelope[],
): Promise<void> {
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId,
      eventGroups: groupHostDaemonEvents(envelopes),
    }),
  });
  expect(response.status).toBe(200);
}

function spyOnTurnTraceLogs(harness: TestAppHarness): () => unknown[] {
  const info = vi.spyOn(harness.deps.logger, "info");
  return () =>
    info.mock.calls
      .filter((call) => call[1] === "Turn trace")
      .map((call) => call[0]);
}

async function sendFollowUp(
  harness: TestAppHarness,
  thread: Thread,
): Promise<void> {
  await expect(
    acceptThreadSendRequest(harness.deps, {
      payload: {
        input: textInput("traced follow-up"),
        mode: "start",
        model: "gpt-5",
        permissionMode: "full",
        reasoningLevel: "medium",
        serviceTier: "default",
      },
      thread,
    }),
  ).resolves.toEqual({ ok: true, delivery: "sent" });
}

describe("turn trace", () => {
  it("logs one trace joining the send, the daemon spans, and the first output batch", async () => {
    await withTestHarness(
      { performanceDiagnosticsAvailable: true },
      async (harness) => {
        setExperiments(harness.db, { performanceDiagnostics: true });
        const turnTraceLogs = spyOnTurnTraceLogs(harness);
        const { sessionId, thread } = seedIdleThread(harness);

        await sendFollowUp(harness, thread);
        const submit = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "turn.submit",
        );
        const daemonTrace = {
          spans: [
            { name: "skills.staged" as const, atMs: 1.5 },
            { name: "bridge.turnStarted" as const, atMs: 4 },
          ],
        };
        await reportQueuedCommandSuccess(harness, submit, {
          trace: daemonTrace,
        });
        await postEvents(harness, sessionId, [
          {
            threadId: thread.id,
            event: {
              type: "turn/started",
              threadId: thread.id,
              providerThreadId: PROVIDER_THREAD_ID,
              scope: turnScope("turn-traced"),
            },
          },
        ]);
        expect(turnTraceLogs()).toEqual([]);

        await postEvents(harness, sessionId, [
          {
            threadId: thread.id,
            event: {
              type: "item/agentMessage/delta",
              threadId: thread.id,
              providerThreadId: PROVIDER_THREAD_ID,
              itemId: "item-traced",
              delta: "hi",
              scope: turnScope("turn-traced"),
            },
          },
        ]);

        await vi.waitFor(() => expect(turnTraceLogs()).toHaveLength(1));
        const spanOffset = expect.any(Number);
        expect(turnTraceLogs()[0]).toMatchObject({
          turnTrace: {
            threadId: thread.id,
            hostId: "host-turn-trace",
            commandType: "turn.submit",
            outcome: "output",
            daemon: daemonTrace,
            spans: {
              "send.received": 0,
              "dispatch.checkpoint.done": spanOffset,
              "runtimeConfig.built": spanOffset,
              "command.sent": spanOffset,
              "send.responded": spanOffset,
              "command.settled": spanOffset,
              "firstOutput.batchReceived": spanOffset,
              "firstOutput.committed": spanOffset,
              "firstOutput.notified": spanOffset,
            },
            rpcs: expect.arrayContaining([
              expect.objectContaining({ type: "turn.submit", ok: true }),
            ]),
          },
        });
      },
    );
  });

  it("records nothing while the performance diagnostics experiment is off", async () => {
    await withTestHarness(
      { performanceDiagnosticsAvailable: true },
      async (harness) => {
        const turnTraceLogs = spyOnTurnTraceLogs(harness);
        const { sessionId, thread } = seedIdleThread(harness);

        await sendFollowUp(harness, thread);
        const submit = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "turn.submit",
        );
        await reportQueuedCommandSuccess(harness, submit, {
          trace: { spans: [] },
        });
        await postEvents(harness, sessionId, [
          {
            threadId: thread.id,
            event: {
              type: "turn/started",
              threadId: thread.id,
              providerThreadId: PROVIDER_THREAD_ID,
              scope: turnScope("turn-untraced"),
            },
          },
          {
            threadId: thread.id,
            event: {
              type: "item/agentMessage/delta",
              threadId: thread.id,
              providerThreadId: PROVIDER_THREAD_ID,
              itemId: "item-untraced",
              delta: "hi",
              scope: turnScope("turn-untraced"),
            },
          },
        ]);

        expect(turnTraceLogs()).toEqual([]);
      },
    );
  });
});
