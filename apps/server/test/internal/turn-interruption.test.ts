import { eq } from "drizzle-orm";
import { events, getThread, listQueuedThreadMessages } from "@bb/db";
import { turnScope, type ThreadEvent } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  internalAuthHeaders,
  listQueuedThreadCommands,
} from "../helpers/commands.js";
import {
  seedEvent,
  seedThread,
  seedThreadFixture,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function postEvents(
  harness: TestAppHarness,
  sessionId: string,
  batch: ThreadEvent[],
) {
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId,
      eventGroups: groupHostDaemonEvents(
        batch.map((event) => ({ threadId: event.threadId, event })),
      ),
    }),
  });
  expect(response.status).toBe(200);
}

describe("provider turn interruption", () => {
  it.each(["active", "starting", "stopping"] as const)(
    "settles an interrupted root turn from %s without manufacturing a manual stop",
    async (status) => {
      await withTestHarness(async (harness) => {
        const { thread, environment, session } = seedThreadFixture(harness, {
          thread: { status },
        });
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          sequence: 1,
          type: "turn/started",
          scope: turnScope("root-turn"),
          data: { providerThreadId: "provider-thread" },
        });
        const completion: ThreadEvent = {
          type: "turn/completed",
          threadId: thread.id,
          providerThreadId: "provider-thread",
          scope: turnScope("root-turn"),
          status: "interrupted",
        };
        await postEvents(harness, session.id, [completion]);
        expect(getThread(harness.db, thread.id)?.status).toBe("idle");
        const settled = getThread(harness.db, thread.id);
        await postEvents(harness, session.id, [completion]);
        expect(getThread(harness.db, thread.id)).toEqual(settled);
        const stored = harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all();
        expect(
          stored.some((event) => event.type === "system/thread/interrupted"),
        ).toBe(false);
        expect(
          stored
            .filter((event) => event.type === "turn/completed")
            .every((event) => JSON.parse(event.data).status === "interrupted"),
        ).toBe(true);
        expect(
          listQueuedThreadCommands(harness, "turn.submit", thread.id),
        ).toEqual([]);
      });
    },
  );

  it("does not settle the root turn when a nested turn is interrupted", async () => {
    await withTestHarness(async (harness) => {
      const { thread, session } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      const identity = {
        threadId: thread.id,
        providerThreadId: "provider-thread",
      };
      await postEvents(harness, session.id, [
        { ...identity, type: "turn/started", scope: turnScope("root-turn") },
        {
          ...identity,
          type: "turn/started",
          scope: turnScope("nested-turn"),
          parentToolCallId: "delegate-call",
        },
        {
          ...identity,
          type: "turn/completed",
          scope: turnScope("nested-turn"),
          status: "interrupted",
        },
      ]);
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
    });
  });

  it("dispatches a user-queued follow-up when the current root turn is interrupted", async () => {
    await withTestHarness(async (harness) => {
      const { thread, session, environment } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        inputText: "Original work",
        providerThreadId: "provider-thread",
      });
      const identity = {
        threadId: thread.id,
        providerThreadId: "provider-thread",
        scope: turnScope("root-turn"),
      };
      await postEvents(harness, session.id, [
        { ...identity, type: "turn/started" },
      ]);
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "text", text: "User-queued follow-up" }],
            mode: "queue-if-active",
          }),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ delivery: "queued" });
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toEqual([]);
      await postEvents(harness, session.id, [
        { ...identity, type: "turn/completed", status: "interrupted" },
      ]);
      await expect
        .poll(() => listQueuedThreadCommands(harness, "turn.submit", thread.id))
        .toHaveLength(1);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
    });
  });

  it.each(["completed", "interrupted", "failed"] as const)(
    "does not settle a newer root turn when an older turn is %s",
    async (status) => {
      await withTestHarness(async (harness) => {
        const { thread, session } = seedThreadFixture(harness, {
          thread: { status: "active" },
        });
        const identity = {
          threadId: thread.id,
          providerThreadId: "provider-thread",
        };
        await postEvents(harness, session.id, [
          { ...identity, type: "turn/started", scope: turnScope("old-turn") },
          { ...identity, type: "turn/started", scope: turnScope("new-turn") },
          {
            ...identity,
            type: "turn/completed",
            scope: turnScope("old-turn"),
            status,
          },
        ]);
        expect(getThread(harness.db, thread.id)?.status).toBe("active");
        await postEvents(harness, session.id, [
          {
            ...identity,
            type: "turn/completed",
            scope: turnScope("new-turn"),
            status: "interrupted",
          },
        ]);
        expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      });
    },
  );

  it("settles a child and notifies its parent with the interrupted outcome", async () => {
    await withTestHarness(async (harness) => {
      const {
        thread: parent,
        project,
        environment,
        session,
      } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: parent.id,
        environmentId: environment.id,
        inputText: "Coordinate child work",
        providerThreadId: "provider-parent",
      });
      const child = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: parent.id,
        status: "active",
      });
      const identity = {
        threadId: child.id,
        providerThreadId: "provider-child",
      };
      await postEvents(harness, session.id, [
        { ...identity, type: "turn/started", scope: turnScope("child-turn") },
        {
          ...identity,
          type: "turn/completed",
          scope: turnScope("child-turn"),
          status: "interrupted",
        },
      ]);
      expect(getThread(harness.db, child.id)?.status).toBe("idle");
      await expect
        .poll(
          () => listQueuedThreadCommands(harness, "turn.submit", parent.id),
          {
            timeout: 5_000,
          },
        )
        .toHaveLength(1);
      const parentEvents = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, parent.id))
        .all();
      expect(
        parentEvents.some((event) =>
          event.data.includes('"systemMessageKind":"child-interrupted"'),
        ),
      ).toBe(true);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", child.id),
      ).toEqual([]);
    });
  });
});
