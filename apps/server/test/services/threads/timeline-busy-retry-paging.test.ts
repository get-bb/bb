import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type ClientTurnRequestId,
} from "@bb/domain";
import { getThread } from "@bb/db";
import {
  isThreadTimelineDelta,
  timelineRowChildren,
  type ThreadTimelineResponse,
  type TimelineRow,
} from "@bb/server-contract";
import {
  createThreadTimelineWindows,
  type ThreadTimelineWindowRequest,
} from "../../../src/services/threads/thread-timeline-windows.js";
import { seedEvent, seedThreadFixture } from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { clearCrossBuildTimelineCaches } from "../../provider-corpus/corpus-harness.js";

const ALPHA = "Reply with only: alpha-during-compact";
const BETA = "Reply with only: beta-during-compact";

function requestId(value: number): ClientTurnRequestId {
  return encodeClientTurnRequestIdNumber({ value });
}

interface BusyRetriedThread {
  threadId: string;
  deliverRetries(): void;
  giveUpOnAlpha(): void;
}

function seedBusyRefusedThread(harness: TestAppHarness): BusyRetriedThread {
  const { environment, thread } = seedThreadFixture(harness, {
    thread: { providerId: "codex" },
  });
  let sequence = 1;
  const threadEvent = (
    type: "client/turn/requested" | "client/turn/rejected" | "system/error",
    data: Record<string, unknown>,
  ) =>
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      sequence: sequence++,
      type,
      scope: threadScope(),
      data,
    });
  const turnEvent = (
    turnId: string,
    type: "turn/started" | "turn/input/accepted" | "item/completed",
    data: Record<string, unknown>,
  ) =>
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "provider-thread",
      sequence: sequence++,
      type,
      scope: turnScope(turnId),
      data,
    });
  const completeTurn = (turnId: string) =>
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "provider-thread",
      sequence: sequence++,
      type: "turn/completed",
      scope: turnScope(turnId),
      data: { providerThreadId: "provider-thread", status: "completed" },
    });
  const request = (args: {
    id: ClientTurnRequestId;
    initiator: "user" | "system";
    retryOf?: ClientTurnRequestId;
    target: Record<string, unknown>;
    text: string;
  }) =>
    threadEvent("client/turn/requested", {
      direction: "outbound",
      source: "tell",
      initiator: args.initiator,
      request: { method: "turn/start", params: {} },
      requestId: args.id,
      ...(args.retryOf === undefined
        ? {}
        : { retryOfRequestId: args.retryOf, retryAttempt: 2 }),
      senderThreadId: null,
      input: [
        {
          type: "text",
          text: args.text,
          mentions: [],
          ...(args.retryOf === undefined ? {} : { visibility: "agent-only" }),
        },
      ],
      target: args.target,
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
    });
  const runTurn = (args: {
    id: ClientTurnRequestId;
    reply: string;
    turnId: string;
  }) => {
    turnEvent(args.turnId, "turn/started", {
      providerThreadId: "provider-thread",
    });
    turnEvent(args.turnId, "turn/input/accepted", {
      providerThreadId: "provider-thread",
      clientRequestId: args.id,
    });
    turnEvent(args.turnId, "item/completed", {
      providerThreadId: "provider-thread",
      item: {
        type: "agentMessage",
        id: `${args.turnId}-reply`,
        text: args.reply,
      },
    });
    completeTurn(args.turnId);
  };
  const busy = (id: ClientTurnRequestId) =>
    threadEvent("client/turn/rejected", {
      requestId: id,
      reason: "thread_busy",
      message: "The agent is compacting context.",
    });
  const retry = (args: {
    id: ClientTurnRequestId;
    original: ClientTurnRequestId;
    text: string;
  }) =>
    request({
      id: args.id,
      initiator: "system",
      retryOf: args.original,
      target: { kind: "new-turn" },
      text: args.text,
    });

  request({
    id: requestId(1),
    initiator: "user",
    target: { kind: "new-turn" },
    text: "Start",
  });
  runTurn({ id: requestId(1), reply: "started", turnId: "turn-start" });
  request({
    id: requestId(2),
    initiator: "user",
    target: { kind: "new-turn" },
    text: "/compact",
  });
  turnEvent("turn-compact", "turn/started", {
    providerThreadId: "provider-thread",
  });
  turnEvent("turn-compact", "turn/input/accepted", {
    providerThreadId: "provider-thread",
    clientRequestId: requestId(2),
  });
  request({
    id: requestId(3),
    initiator: "user",
    target: { kind: "steer", expectedTurnId: "turn-compact" },
    text: ALPHA,
  });
  request({
    id: requestId(4),
    initiator: "user",
    target: { kind: "steer", expectedTurnId: "turn-compact" },
    text: BETA,
  });
  busy(requestId(3));
  busy(requestId(4));
  completeTurn("turn-compact");

  return {
    threadId: thread.id,
    deliverRetries() {
      retry({ id: requestId(5), original: requestId(3), text: ALPHA });
      runTurn({
        id: requestId(5),
        reply: "alpha-during-compact",
        turnId: "turn-alpha",
      });
      retry({ id: requestId(6), original: requestId(4), text: BETA });
      runTurn({
        id: requestId(6),
        reply: "beta-during-compact",
        turnId: "turn-beta",
      });
    },
    giveUpOnAlpha() {
      retry({ id: requestId(7), original: requestId(3), text: ALPHA });
      busy(requestId(7));
      threadEvent("system/error", {
        code: "provider_busy",
        message:
          "The agent answered busy 2 times in a row, so bb stopped re-sending this message.",
      });
    },
  };
}

function full(
  response: ReturnType<ReturnType<typeof createThreadTimelineWindows>["read"]>,
): ThreadTimelineResponse {
  if (isThreadTimelineDelta(response)) {
    throw new Error("expected a full timeline window");
  }
  return response;
}

function conversationRows(rows: readonly TimelineRow[]): string[] {
  const out: string[] = [];
  const visit = (visited: readonly TimelineRow[]) => {
    for (const row of visited) {
      if (row.kind === "conversation") {
        out.push(
          row.role === "user"
            ? `user ${row.turnId} ${row.turnRequest.kind}/${row.turnRequest.status}: ${row.text}`
            : `assistant ${row.turnId}: ${row.text}`,
        );
      }
      const children = timelineRowChildren(row);
      if (children !== null) visit(children);
    }
  };
  visit(rows);
  return out;
}

function readAllPages(
  harness: TestAppHarness,
  threadId: string,
  segmentLimit: number,
  windows = createThreadTimelineWindows(harness.deps),
): string[][] {
  const thread = getThread(harness.deps.db, threadId);
  if (thread === null) throw new Error(`missing thread ${threadId}`);
  const base: ThreadTimelineWindowRequest = {
    deferContent: false,
    includeNestedRows: false,
    page: { kind: "latest", segmentLimit },
  };
  const pages: string[][] = [];
  let page = full(windows.read(thread, base, undefined));
  pages.push(conversationRows(page.rows));
  while (page.timelinePage.olderCursor !== null) {
    page = full(
      windows.read(
        thread,
        {
          ...base,
          page: {
            kind: "older",
            beforeCursor: page.timelinePage.olderCursor,
            segmentLimit,
          },
        },
        undefined,
      ),
    );
    pages.push(conversationRows(page.rows));
  }
  return pages.reverse();
}

function withoutTurnIds(rows: readonly string[]): string[] {
  return rows.map((row) => row.replace(/^user \S+ /u, "user "));
}

const REFUSED_TIMELINE = [
  "user message/accepted: Start",
  "assistant turn-start: started",
  "user message/accepted: /compact",
  `user steer/pending: ${ALPHA}`,
  `user steer/pending: ${BETA}`,
];

const DELIVERED_TIMELINE = [
  "user turn-start message/accepted: Start",
  "assistant turn-start: started",
  "user turn-compact message/accepted: /compact",
  `user turn-alpha message/accepted: ${ALPHA}`,
  "assistant turn-alpha: alpha-during-compact",
  `user turn-beta message/accepted: ${BETA}`,
  "assistant turn-beta: beta-during-compact",
];

describe("busy-refused messages across timeline pages", () => {
  it.each([1, 2, 3, 20])(
    "renders each delivered message once, in its retry's turn, with %i segments per page",
    async (segmentLimit) => {
      await withTestHarness(async (harness) => {
        const thread = seedBusyRefusedThread(harness);
        thread.deliverRetries();
        clearCrossBuildTimelineCaches(harness.deps.db);
        const pages = readAllPages(harness, thread.threadId, segmentLimit);
        if (segmentLimit < 20) {
          expect(pages.length).toBeGreaterThan(1);
        }
        expect(pages.flat()).toEqual(DELIVERED_TIMELINE);
      });
    },
  );

  it.each([1, 2, 20])(
    "shows both messages pending while bb still re-sends them, with %i segments per page",
    async (segmentLimit) => {
      await withTestHarness(async (harness) => {
        const thread = seedBusyRefusedThread(harness);
        clearCrossBuildTimelineCaches(harness.deps.db);
        const pages = readAllPages(harness, thread.threadId, segmentLimit);
        expect(withoutTurnIds(pages.flat())).toEqual(REFUSED_TIMELINE);
      });
    },
  );

  it.each([1, 2])(
    "serves delivered pages after the retries are accepted on a window cache that held pending pages, with %i segments per page",
    async (segmentLimit) => {
      await withTestHarness(async (harness) => {
        const thread = seedBusyRefusedThread(harness);
        clearCrossBuildTimelineCaches(harness.deps.db);
        const windows = createThreadTimelineWindows(harness.deps);
        expect(
          withoutTurnIds(
            readAllPages(
              harness,
              thread.threadId,
              segmentLimit,
              windows,
            ).flat(),
          ),
        ).toEqual(REFUSED_TIMELINE);

        thread.deliverRetries();
        expect(
          readAllPages(harness, thread.threadId, segmentLimit, windows).flat(),
        ).toEqual(DELIVERED_TIMELINE);
      });
    },
  );

  it.each([1, 2, 20])(
    "shows a message failed once bb gives up on it, with %i segments per page",
    async (segmentLimit) => {
      await withTestHarness(async (harness) => {
        const thread = seedBusyRefusedThread(harness);
        thread.giveUpOnAlpha();
        clearCrossBuildTimelineCaches(harness.deps.db);
        const pages = readAllPages(harness, thread.threadId, segmentLimit);
        expect(withoutTurnIds(pages.flat())).toEqual([
          ...REFUSED_TIMELINE.slice(0, 3),
          `user steer/rejected: ${ALPHA}`,
          `user steer/pending: ${BETA}`,
        ]);
      });
    },
  );
});
