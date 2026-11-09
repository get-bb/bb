import { describe, expect, it, vi } from "vitest";
import type { ThreadEventRow } from "@bb/domain";
import {
  buildThreadTimelineFromEvents,
  resumeEventProjectionFold,
  startThreadTimelineProjectionFold,
  type ThreadEventWithMeta,
} from "../src/index.js";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import {
  createTimelineEventFactory,
  fromRows,
} from "./timeline-test-harness.js";

const options = {
  completedTurnDisplay: "collapse",
  includeDiagnosticOperations: false,
  includeNestedRows: true,
  isLatestPage: true,
  omitSettledDelegationChildRows: false,
  summarizeShellCommands: true,
  threadName: "",
  threadStatus: "active",
  workspaceRoot: null,
} as const;

function build(
  events: ThreadEventWithMeta[],
  fold?: ReturnType<typeof startThreadTimelineProjectionFold>,
) {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [],
    events,
    fold,
    options,
  });
}

type FirstTurnEnd = "completed" | "interrupted" | "interrupted-settled";

function streamingTurn(firstTurnEnd: FirstTurnEnd): {
  events: ThreadEventWithMeta[];
  resumableFrom: number;
} {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  const rows: ThreadEventRow[] = [
    event.turnStarted({ turnId: "turn-1" }),
    event.commandStarted({
      command: "ls",
      itemId: "command-1",
      turnId: "turn-1",
    }),
    event.commandOutputDelta({
      delta: "a\n",
      itemId: "command-1",
      turnId: "turn-1",
    }),
    ...(firstTurnEnd === "interrupted-settled"
      ? [
          event.commandCompleted({
            aggregatedOutput: "a\n",
            command: "ls",
            exitCode: 0,
            itemId: "command-1",
            turnId: "turn-1",
          }),
        ]
      : []),
    event.turnCompleted({
      status: firstTurnEnd === "completed" ? "completed" : "interrupted",
      turnId: "turn-1",
    }),
    event.turnStarted({ turnId: "turn-2" }),
  ];
  const resumableFrom = rows.length;
  rows.push(
    event.reasoningStarted({ itemId: "reasoning-2", turnId: "turn-2" }),
    event.reasoningDelta({
      delta: "Thinking",
      itemId: "reasoning-2",
      turnId: "turn-2",
    }),
    event.assistantDelta({
      delta: "Hello",
      itemId: "assistant-2",
      turnId: "turn-2",
    }),
    event.commandStarted({
      command: "pnpm test",
      itemId: "command-2",
      turnId: "turn-2",
    }),
    event.commandOutputDelta({
      delta: "ok\n",
      itemId: "command-2",
      turnId: "turn-2",
    }),
    event.commandOutputDelta({
      delta: "done\n",
      itemId: "command-1",
      turnId: "turn-1",
    }),
    event.commandCompleted({
      aggregatedOutput: "ok\n",
      command: "pnpm test",
      exitCode: 0,
      itemId: "command-2",
      turnId: "turn-2",
    }),
    event.assistantDelta({
      delta: " world",
      itemId: "assistant-2",
      turnId: "turn-2",
    }),
    event.commandStarted({
      command: "sleep 9",
      itemId: "command-3",
      turnId: "turn-2",
    }),
  );
  return { events: fromRows(rows), resumableFrom };
}

describe("event projection fold", () => {
  it.each([
    { firstTurnEnd: "completed", label: "completed earlier turn" },
    { firstTurnEnd: "interrupted", label: "interrupted earlier turn" },
    {
      firstTurnEnd: "interrupted-settled",
      label: "interrupted earlier turn with nothing pending",
    },
  ] as const)(
    "matches a cold build after every resumed event ($label)",
    ({ firstTurnEnd }) => {
      const { events, resumableFrom } = streamingTurn(firstTurnEnd);
      for (let start = resumableFrom; start < events.length; start += 1) {
        const fold = startThreadTimelineProjectionFold({
          acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
          events: events.slice(0, start),
          options,
        });
        expect(build(events.slice(0, start), fold)).toEqual(
          build(events.slice(0, start)),
        );
        for (let end = start + 1; end <= events.length; end += 1) {
          expect(
            resumeEventProjectionFold(fold, events.slice(end - 1, end)),
          ).toBe(true);
          const cold = build(events.slice(0, end));
          expect(build(events.slice(0, end), fold), `${start}..${end}`).toEqual(
            cold,
          );
          expect(build(events.slice(0, end), fold)).toEqual(cold);
        }
      }
    },
  );

  it("finishes without deep-copying the fold once an interrupted turn has nothing pending", () => {
    const { events, resumableFrom } = streamingTurn("interrupted-settled");
    const fold = startThreadTimelineProjectionFold({
      acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
      events: events.slice(0, resumableFrom),
      options,
    });
    expect(resumeEventProjectionFold(fold, events.slice(resumableFrom))).toBe(
      true,
    );
    const clone = vi.spyOn(globalThis, "structuredClone");
    try {
      expect(build(events, fold)).toEqual(build(events));
      expect(clone).not.toHaveBeenCalled();
    } finally {
      clone.mockRestore();
    }
  });

  it("refuses events that change the fold's request and turn lookups", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const events = fromRows([
      event.turnStarted({ turnId: "turn-1" }),
      event.assistantDelta({
        delta: "Hi",
        itemId: "assistant-1",
        turnId: "turn-1",
      }),
    ]);
    const fold = startThreadTimelineProjectionFold({
      acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
      events,
      options,
    });
    const [nextTurn] = fromRows([event.turnStarted({ turnId: "turn-2" })]);
    expect(resumeEventProjectionFold(fold, [nextTurn!])).toBe(false);
    expect(resumeEventProjectionFold(fold, [events[0]!])).toBe(false);
    expect(fold.events).toHaveLength(2);
  });
});
