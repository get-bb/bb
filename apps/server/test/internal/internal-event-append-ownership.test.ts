import { eq } from "drizzle-orm";
import { events, getThread } from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import {
  hostDaemonEventBatchResponseSchema,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  internalAuthHeaders,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

interface SeedEventRouteArgs {
  hostType?: "persistent";
}

interface PostEventBatchArgs {
  harness: TestAppHarness;
  sessionId: string;
  events: HostDaemonEventEnvelope[];
}

async function postEventBatch(args: PostEventBatchArgs): Promise<Response> {
  return args.harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(args.harness),
    body: JSON.stringify({
      sessionId: args.sessionId,
      events: args.events,
    }),
  });
}

function setupEventRoute(args: SeedEventRouteArgs = {}) {
  return createTestAppHarness().then((harness) => {
    const { host, session } = seedHostSession(harness.deps, {
      type: args.hostType,
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
    return {
      environment,
      harness,
      host,
      project,
      session,
      thread,
    };
  });
}

describe("internal event append ownership", () => {
  it("assigns server-owned sequences and returns accepted event indexes", async () => {
    const { environment, harness, session, thread } = await setupEventRoute();
    try {
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 3,
        type: "system/error",
        scope: threadScope(),
        data: { message: "existing" },
      });

      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            threadId: thread.id,
            event: {
              type: "system/error",
              threadId: thread.id,
              scope: threadScope(),
              message: "first daemon",
            },
          },
          {
            threadId: thread.id,
            event: {
              type: "system/error",
              threadId: thread.id,
              scope: threadScope(),
              message: "second daemon",
            },
          },
        ],
      });

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        acceptedEvents: [
          {
            eventIndex: 0,
            threadId: thread.id,
            sequence: 4,
          },
          {
            eventIndex: 1,
            threadId: thread.id,
            sequence: 5,
          },
        ],
        rejectedEvents: [],
      });
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toMatchObject([
        { sequence: 3 },
        {
          sequence: 4,
        },
        {
          sequence: 5,
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("returns original event indexes after dropping orphan turn snapshots", async () => {
    const { harness, session, thread } = await setupEventRoute();
    try {
      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            threadId: thread.id,
            event: {
              type: "thread/tokenUsage/updated",
              threadId: thread.id,
              scope: turnScope("turn-from-source-thread"),
              providerThreadId: "provider-fork-session",
              tokenUsage: {
                total: {
                  totalTokens: 42,
                  inputTokens: 20,
                  cachedInputTokens: 5,
                  outputTokens: 12,
                  reasoningOutputTokens: 5,
                },
                last: {
                  totalTokens: 42,
                  inputTokens: 20,
                  cachedInputTokens: 5,
                  outputTokens: 12,
                  reasoningOutputTokens: 5,
                },
                modelContextWindow: 200_000,
              },
            },
          },
          {
            threadId: thread.id,
            event: {
              type: "system/error",
              threadId: thread.id,
              scope: threadScope(),
              message: "accepted after skipped",
            },
          },
        ],
      });

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        acceptedEvents: [
          {
            eventIndex: 1,
            threadId: thread.id,
            sequence: 1,
          },
        ],
        rejectedEvents: [],
      });
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toMatchObject([
        {
          sequence: 1,
          type: "system/error",
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("assigns distinct sequences for simultaneous requests on the same thread", async () => {
    const { harness, session, thread } = await setupEventRoute();
    try {
      const [firstResponse, secondResponse] = await Promise.all([
        postEventBatch({
          harness,
          sessionId: session.id,
          events: [
            {
              threadId: thread.id,
              event: {
                type: "system/error",
                threadId: thread.id,
                scope: threadScope(),
                message: "first simultaneous daemon",
              },
            },
          ],
        }),
        postEventBatch({
          harness,
          sessionId: session.id,
          events: [
            {
              threadId: thread.id,
              event: {
                type: "system/error",
                threadId: thread.id,
                scope: threadScope(),
                message: "second simultaneous daemon",
              },
            },
          ],
        }),
      ]);

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      const firstBody = hostDaemonEventBatchResponseSchema.parse(
        await readJson(firstResponse),
      );
      const secondBody = hostDaemonEventBatchResponseSchema.parse(
        await readJson(secondResponse),
      );
      expect(
        [...firstBody.acceptedEvents, ...secondBody.acceptedEvents]
          .map((event) => event.sequence)
          .sort((left, right) => left - right),
      ).toEqual([1, 2]);

      const storedRows = harness.db
        .select({
          sequence: events.sequence,
        })
        .from(events)
        .where(eq(events.threadId, thread.id))
        .all();

      expect(storedRows).toHaveLength(2);
      expect(
        storedRows
          .map((row) => row.sequence)
          .sort((left, right) => left - right),
      ).toEqual([1, 2]);
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects unowned thread events without blocking owned events in the same batch", async () => {
    const { harness, session, thread } = await setupEventRoute();
    try {
      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            threadId: "thr_missing",
            event: {
              type: "system/error",
              threadId: "thr_missing",
              scope: threadScope(),
              message: "stale daemon event",
            },
          },
          {
            threadId: thread.id,
            event: {
              type: "system/error",
              threadId: thread.id,
              scope: threadScope(),
              message: "owned daemon event",
            },
          },
        ],
      });

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        acceptedEvents: [
          {
            eventIndex: 1,
            threadId: thread.id,
            sequence: 1,
          },
        ],
        rejectedEvents: [
          {
            eventIndex: 0,
            reason: "thread_not_owned_by_host",
            threadId: "thr_missing",
          },
        ],
      });
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps owned event indexes aligned around an unowned middle row", async () => {
    const { environment, harness, project, session, thread } =
      await setupEventRoute();
    const secondThread = seedThread(harness.deps, {
      environmentId: environment.id,
      projectId: project.id,
      status: "active",
      title: "Second Thread",
    });
    try {
      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            threadId: thread.id,
            event: {
              type: "thread/name/updated",
              threadId: thread.id,
              providerThreadId: "provider-owned-first",
              scope: threadScope(),
              threadName: "First owned rename",
            },
          },
          {
            threadId: "thr_missing",
            event: {
              type: "thread/name/updated",
              threadId: "thr_missing",
              providerThreadId: "provider-unowned-middle",
              scope: threadScope(),
              threadName: "Rejected rename",
            },
          },
          {
            threadId: secondThread.id,
            event: {
              type: "thread/name/updated",
              threadId: secondThread.id,
              providerThreadId: "provider-owned-second",
              scope: threadScope(),
              threadName: "Second owned rename",
            },
          },
        ],
      });

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        acceptedEvents: [
          {
            eventIndex: 0,
            threadId: thread.id,
            sequence: 1,
          },
          {
            eventIndex: 2,
            threadId: secondThread.id,
            sequence: 1,
          },
        ],
        rejectedEvents: [
          {
            eventIndex: 1,
            reason: "thread_not_owned_by_host",
            threadId: "thr_missing",
          },
        ],
      });
      expect(getThread(harness.db, thread.id)?.title).toBe(
        "First owned rename",
      );
      expect(getThread(harness.db, secondThread.id)?.title).toBe(
        "Second owned rename",
      );
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, "thr_missing"))
          .all(),
      ).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("notifies a parent when a child provider process exits", async () => {
    const { environment, harness, project, session } = await setupEventRoute();
    const parentThread = seedThread(harness.deps, {
      environmentId: environment.id,
      projectId: project.id,
      status: "idle",
      title: "Project coordinator",
    });
    seedThreadRuntimeState(harness.deps, {
      environmentId: environment.id,
      inputText: "Coordinate child work",
      providerThreadId: "provider-parent-provider-exit",
      threadId: parentThread.id,
    });
    const childThread = seedThread(harness.deps, {
      environmentId: environment.id,
      parentThreadId: parentThread.id,
      projectId: project.id,
      status: "active",
      title: "Child provider exit worker",
    });
    try {
      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            threadId: childThread.id,
            event: {
              type: "system/error",
              threadId: childThread.id,
              scope: threadScope(),
              code: "provider_process_exited",
              message: "Provider process exited",
            },
          },
        ],
      });

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        acceptedEvents: [
          {
            eventIndex: 0,
            threadId: childThread.id,
            sequence: 1,
          },
        ],
        rejectedEvents: [],
      });
      expect(getThread(harness.db, childThread.id)?.status).toBe("error");

      const parentTurnCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === parentThread.id,
        3_000,
      );
      if (parentTurnCommand.command.type !== "turn.submit") {
        throw new Error(
          `Expected parent turn command, got ${parentTurnCommand.command.type}`,
        );
      }
      const [input] = parentTurnCommand.command.input;
      if (!input || input.type !== "text") {
        throw new Error("Expected parent notification text input");
      }
      const threadMention = `@thread:${childThread.id}`;
      expect(input.text).toContain(
        [`${threadMention} failed.`, "", "Review the thread before deciding next steps."].join(
          "\n",
        ),
      );
      expect(input.text).not.toContain("No failure output was recorded.");
      expect(input.mentions).toEqual([
        {
          start: input.text.indexOf(threadMention),
          end: input.text.indexOf(threadMention) + threadMention.length,
          resource: {
            kind: "thread",
            label: "Child provider exit worker",
            projectId: project.id,
            threadId: childThread.id,
          },
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  });
});
