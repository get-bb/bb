import { listEvents, listQueuedThreadMessages } from "@bb/db";
import { turnRequestEventDataSchema, turnScope } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import {
  seedThread,
  seedThreadFixture,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface ChildTurn {
  turnId: string;
  compacted?: boolean;
  messages: { text: string; parentToolCallId?: string }[];
}

function seedParentAndChild(harness: TestAppHarness) {
  const {
    project,
    environment,
    session,
    thread: parent,
  } = seedThreadFixture(harness);
  seedThreadRuntimeState(harness.deps, {
    threadId: parent.id,
    environmentId: environment.id,
    providerThreadId: "parent-provider-thread",
  });
  const child = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    parentThreadId: parent.id,
    parentNotifications: "auto",
    status: "active",
    title: "Worker child",
  });
  return { parent, child, environment, session };
}

function childTurnEvents(
  childId: string,
  turn: ChildTurn,
): HostDaemonEventEnvelope[] {
  const scope = turnScope(turn.turnId);
  const providerThreadId = "provider-child";
  const compaction: HostDaemonEventEnvelope[] = turn.compacted
    ? [
        {
          threadId: childId,
          event: {
            type: "item/completed",
            threadId: childId,
            providerThreadId,
            scope,
            item: {
              id: `${turn.turnId}-compaction`,
              type: "contextCompaction",
            },
          },
        },
      ]
    : [];
  return [
    ...compaction,
    ...turn.messages.map((message, index) => ({
      threadId: childId,
      event: {
        type: "item/completed" as const,
        threadId: childId,
        providerThreadId,
        scope,
        item: {
          id: `${turn.turnId}-message-${index}`,
          type: "agentMessage" as const,
          text: message.text,
          ...(message.parentToolCallId
            ? { parentToolCallId: message.parentToolCallId }
            : {}),
        },
      },
    })),
    {
      threadId: childId,
      event: {
        type: "turn/completed" as const,
        threadId: childId,
        providerThreadId,
        scope,
        status: "completed" as const,
      },
    },
  ];
}

function readParentNotices(harness: TestAppHarness, parentId: string) {
  const delivered = listEvents(harness.db, { threadId: parentId })
    .filter((row) => row.type === "client/turn/requested")
    .map((row) => turnRequestEventDataSchema.parse(JSON.parse(row.data)))
    .filter((data) => data.initiator === "system")
    .map((data) => ({ text: JSON.stringify(data.input), version: "sent" }));
  const queued = listQueuedThreadMessages(harness.db, parentId).map((row) => ({
    text: row.content,
    version: `${row.id}@${row.updatedAt}`,
  }));
  return [...delivered, ...queued];
}

async function runChildTurns(
  harness: TestAppHarness,
  turns: ChildTurn[],
): Promise<string[]> {
  const seeded = seedParentAndChild(harness);
  const readNotices = () => readParentNotices(harness, seeded.parent.id);
  const latestNotices: string[] = [];
  vi.useFakeTimers();
  for (const turn of turns) {
    const before = JSON.stringify(readNotices());
    await postChildTurn(harness, { ...seeded, turn });
    await vi.waitFor(() =>
      expect(JSON.stringify(readNotices())).not.toBe(before),
    );
    latestNotices.push(readNotices().at(-1)!.text);
  }
  return latestNotices;
}

async function postChildTurn(
  harness: TestAppHarness,
  args: ReturnType<typeof seedParentAndChild> & { turn: ChildTurn },
): Promise<void> {
  const { child, environment, session, turn } = args;
  seedTurnStarted(harness.deps, {
    environmentId: environment.id,
    threadId: child.id,
    turnId: turn.turnId,
    providerThreadId: "provider-child",
  });
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId: session.id,
      eventGroups: groupHostDaemonEvents(childTurnEvents(child.id, turn)),
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  await vi.advanceTimersByTimeAsync(2_000);
}

afterEach(() => vi.useRealTimers());

describe("child completion output is scoped to the completed root turn", () => {
  it("does not repeat a previous result for later turns without output", async () => {
    await withTestHarness(async (harness) => {
      const notices = await runChildTurns(harness, [
        {
          turnId: "turn-1",
          messages: [{ text: "This slot is already counted." }],
        },
        { turnId: "turn-2", messages: [{ text: "" }] },
        { turnId: "turn-3", messages: [] },
        { turnId: "turn-4", messages: [{ text: "  " }] },
      ]);

      expect(notices).toHaveLength(4);
      expect(notices[0]).toContain("This slot is already counted.");
      for (const notice of notices.slice(1)) {
        expect(notice).toContain("No final output was recorded.");
        expect(notice).not.toContain("This slot is already counted.");
      }
    });
  });

  it("does not notify the parent for a turn that only compacted context", async () => {
    await withTestHarness(async (harness) => {
      const seeded = seedParentAndChild(harness);
      vi.useFakeTimers();
      await postChildTurn(harness, {
        ...seeded,
        turn: { turnId: "turn-compact", compacted: true, messages: [] },
      });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(readParentNotices(harness, seeded.parent.id)).toEqual([]);

      await postChildTurn(harness, {
        ...seeded,
        turn: {
          turnId: "turn-compacted-mid-turn",
          compacted: true,
          messages: [{ text: "Result after compaction." }],
        },
      });
      await vi.waitFor(() =>
        expect(readParentNotices(harness, seeded.parent.id)).toEqual([
          expect.objectContaining({
            text: expect.stringContaining("Result after compaction."),
          }),
        ]),
      );
    });
  });

  it("uses the root final message, not nested agent output", async () => {
    await withTestHarness(async (harness) => {
      const notices = await runChildTurns(harness, [
        {
          turnId: "turn-1",
          messages: [
            { text: "Subagent detail.", parentToolCallId: "spawn-1" },
            { text: "Root result after nested work." },
          ],
        },
        {
          turnId: "turn-2",
          messages: [{ text: "Nested only.", parentToolCallId: "spawn-2" }],
        },
      ]);

      expect(notices).toHaveLength(2);
      expect(notices[0]).toContain("Root result after nested work.");
      expect(notices[0]).not.toContain("Subagent detail.");
      expect(notices[1]).toContain("No final output was recorded.");
      expect(notices[1]).not.toContain("Nested only.");
      expect(notices[1]).not.toContain("Root result after nested work.");
    });
  });
});
