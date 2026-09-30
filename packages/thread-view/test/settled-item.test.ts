import { describe, expect, it } from "vitest";
import type { ThreadEventRow } from "@bb/domain";
import {
  buildThreadTimelineFromEvents,
  buildThreadTimelineTurnDetailsFromEvents,
} from "../src/build-thread-timeline.js";
import { findSettledItemCandidates } from "../src/settled-item-prototype.js";
import {
  decodeSettledItem,
  decodeSettledItemRecord,
} from "../src/settled-item.js";
import {
  createTimelineEventFactory,
  fromRows,
} from "./timeline-test-harness.js";

const options = { threadName: "Example", threadStatus: "idle" as const };
const f = () =>
  createTimelineEventFactory({ threadId: "thread", turnId: "turn" });

function fixture() {
  const factory = f();
  return [
    factory.turnStarted(),
    factory.assistantCompleted({ itemId: "before", text: "Before" }),
    factory.commandStarted({ itemId: "cmd", command: "cat file" }),
    factory.commandOutputDelta({ itemId: "cmd", delta: "content" }),
    factory.assistantCompleted({ itemId: "during", text: "During" }),
    factory.commandCompleted({
      itemId: "cmd",
      command: "cat file",
      aggregatedOutput: "content",
      exitCode: 0,
    }),
    factory.assistantCompleted({ itemId: "after", text: "After" }),
    factory.turnCompleted(),
  ];
}

function compact(rows: ThreadEventRow[]) {
  const events = fromRows(rows);
  const candidates = findSettledItemCandidates(events, options);
  const hidden = new Set(
    candidates.flatMap((candidate) => [
      ...candidate.removedIds,
      ...(candidate.data === null ? [] : [candidate.ownerId]),
    ]),
  );
  const items = candidates
    .filter((candidate) => candidate.data !== null)
    .map((candidate) => {
      const owner = rows.find((row) => row.id === candidate.ownerId);
      if (!owner) throw new Error("Missing owner");
      if (candidate.data === null) throw new Error("Expected summary");
      return decodeSettledItem(candidate.data);
    });
  return {
    events: events.filter((row) => !hidden.has(row.meta.id)),
    items,
    settledToolFlushSequences: candidates.flatMap((candidate) =>
      candidate.data === null
        ? []
        : (decodeSettledItemRecord(candidate.data).toolFlushSequences ?? []),
    ),
    candidates,
  };
}

describe("settled item projection", () => {
  it.each(["flat", "collapse"] as const)(
    "preserves interleaved timeline rows with %s turns without replaying command events",
    (completedTurnDisplay) => {
      const rows = fixture();
      const result = compact(rows);
      expect(result.candidates).toHaveLength(1);
      expect(
        result.events.some(
          (row) => row.event.type === "item/commandExecution/outputDelta",
        ),
      ).toBe(false);
      const args = {
        acceptedClientRequestContext: {
          acceptedClientRequestEvents: [],
          rejectedClientRequestEvents: [],
        },
        contextWindowEvents: [],
        options: {
          ...options,
          workspaceRoot: null,
          completedTurnDisplay,
          includeNestedRows: true,
          includeDiagnosticOperations: false,
          isLatestPage: true,
        },
      };
      expect(
        buildThreadTimelineFromEvents({
          ...args,
          events: result.events,
          settledItems: result.items,
          settledToolFlushSequences: result.settledToolFlushSequences,
        }),
      ).toEqual(
        buildThreadTimelineFromEvents({ ...args, events: fromRows(rows) }),
      );
    },
  );

  it("keeps one mutable output in the summary payload", () => {
    const [candidate] = compact(fixture()).candidates;
    if (candidate.data === null) throw new Error("Expected summary");
    const stored = {
      version: 1,
      message: decodeSettledItem(candidate.data),
    };
    if (stored.message.kind !== "command") throw new Error("Expected command");
    expect(stored.message.output).toBe("content");
    stored.message.output = "truncated";
    expect(decodeSettledItem(JSON.stringify(stored))).toMatchObject({
      output: "truncated",
    });
    expect(stored.message.output).toBe("truncated");
    expect(candidate.data).not.toContain('"aggregatedOutput"');
  });

  it("rejects malformed summaries and unsupported versions", () => {
    const [candidate] = compact(fixture()).candidates;
    if (candidate.data === null) throw new Error("Expected summary");
    expect(() =>
      decodeSettledItem(
        candidate.data?.replace('"version":1', '"version":2') ?? "",
      ),
    ).toThrow();
    const stored = {
      version: 1,
      message: decodeSettledItem(candidate.data),
    };
    stored.message.sourceSeqEnd = -1;
    expect(() => decodeSettledItem(JSON.stringify(stored))).toThrow();
  });

  it("keeps unfinished turns ordinary", () => {
    expect(compact(fixture().slice(0, -1)).candidates).toHaveLength(0);
  });

  it("keeps output not represented by the completion ordinary", () => {
    const rows = fixture();
    const owner = rows.find(
      (row) =>
        row.type === "item/completed" &&
        row.data.item.type === "commandExecution",
    );
    if (
      owner?.type !== "item/completed" ||
      owner.data.item.type !== "commandExecution"
    )
      throw new Error("Missing command");
    delete owner.data.item.aggregatedOutput;
    expect(compact(rows).candidates).toHaveLength(0);
  });
  it("preserves nested turn details", () => {
    const rows = fixture();
    const result = compact(rows);
    const detailOptions = {
      ...options,
      workspaceRoot: null,
      completedTurnDisplay: "collapse" as const,
      includeDiagnosticOperations: false,
      turnId: "turn",
      sourceSeqStart: rows[0].seq,
    };
    expect(
      buildThreadTimelineTurnDetailsFromEvents({
        events: result.events,
        settledItems: result.items,
        settledToolFlushSequences: result.settledToolFlushSequences,
        options: detailOptions,
      }),
    ).toEqual(
      buildThreadTimelineTurnDetailsFromEvents({
        events: fromRows(rows),
        options: detailOptions,
      }),
    );
  });

  it("keeps commands crossing a new request ordinary", () => {
    const factory = f();
    const rows = [
      factory.turnStarted(),
      factory.commandStarted({ itemId: "cmd", command: "pwd" }),
      factory.clientTurnRequested({ text: "Next request" }),
      factory.commandCompleted({
        itemId: "cmd",
        command: "pwd",
        aggregatedOutput: "/repo",
      }),
      factory.turnCompleted(),
    ];
    expect(compact(rows).candidates).toHaveLength(0);
  });

  it("keeps reused command IDs and reopened turns ordinary", () => {
    const factory = f();
    const rows = [
      factory.turnStarted(),
      factory.commandStarted({ itemId: "cmd", command: "pwd" }),
      factory.commandCompleted({
        itemId: "cmd",
        command: "pwd",
        aggregatedOutput: "/repo",
      }),
      factory.turnCompleted(),
      factory.turnStarted(),
      factory.commandStarted({ itemId: "cmd", command: "ls" }),
      factory.commandCompleted({
        itemId: "cmd",
        command: "ls",
        aggregatedOutput: "file",
      }),
      factory.turnCompleted(),
    ];
    expect(compact(rows).candidates).toHaveLength(0);
  });

  it("keeps late output ordinary", () => {
    const factory = f();
    const rows = [
      factory.turnStarted(),
      factory.commandStarted({ itemId: "cmd", command: "pwd" }),
      factory.commandCompleted({
        itemId: "cmd",
        command: "pwd",
        aggregatedOutput: "/repo",
      }),
      factory.commandOutputDelta({ itemId: "cmd", delta: "late" }),
      factory.turnCompleted(),
    ];
    expect(compact(rows).candidates).toHaveLength(0);
  });
  it("renders a selected summary with retained turn context and rejects missing context", () => {
    const rows = fixture();
    const result = compact(rows);
    const args = {
      acceptedClientRequestContext: {
        acceptedClientRequestEvents: [],
        rejectedClientRequestEvents: [],
      },
      contextWindowEvents: [],
      options: {
        ...options,
        workspaceRoot: null,
        completedTurnDisplay: "flat" as const,
        includeNestedRows: true,
        includeDiagnosticOperations: false,
        isLatestPage: true,
      },
    };
    const source = fromRows(rows).filter(
      ({ event }) =>
        event.type === "turn/started" ||
        event.type === "turn/completed" ||
        event.type === "item/commandExecution/outputDelta" ||
        ((event.type === "item/started" || event.type === "item/completed") &&
          event.item.type === "commandExecution"),
    );
    expect(
      buildThreadTimelineFromEvents({
        ...args,
        events: source.filter(
          ({ event }) =>
            event.type === "turn/started" || event.type === "turn/completed",
        ),
        settledItems: result.items,
        settledToolFlushSequences: result.settledToolFlushSequences,
      }),
    ).toEqual(buildThreadTimelineFromEvents({ ...args, events: source }));
    expect(() =>
      buildThreadTimelineFromEvents({
        ...args,
        events: [],
        settledItems: result.items,
        settledToolFlushSequences: result.settledToolFlushSequences,
      }),
    ).toThrow("without turn/started");
  });
});

describe("settled text, reasoning and edits", () => {
  it.each(["flat", "collapse"] as const)(
    "preserves all four item kinds with %s display",
    (completedTurnDisplay) => {
      const factory = f();
      const changes = [
        { path: "file.ts", kind: "update" as const, diff: "-old\n+new" },
      ];
      const rows = [
        factory.turnStarted(),
        factory.assistantDelta({ itemId: "answer", delta: "hello" }),
        factory.reasoningStarted({ itemId: "thought" }),
        factory.reasoningDelta({ itemId: "thought", delta: "considering" }),
        factory.commandStarted({ itemId: "cmd", command: "cat file.ts" }),
        factory.commandOutputDelta({ itemId: "cmd", delta: "old" }),
        factory.fileChangeStarted({ itemId: "edit", changes }),
        factory.fileChangeCompleted({ itemId: "edit", changes }),
        factory.commandCompleted({
          itemId: "cmd",
          command: "cat file.ts",
          aggregatedOutput: "old",
          exitCode: 0,
        }),
        factory.reasoningCompleted({ itemId: "thought", text: "considering" }),
        factory.assistantCompleted({ itemId: "answer", text: "hello world" }),
        factory.turnCompleted(),
      ];
      const result = compact(rows);
      expect(result.candidates).toHaveLength(4);
      expect(result.items.map((message) => message.kind).sort()).toEqual([
        "assistant-text",
        "command",
        "file-edit",
        "operation",
      ]);
      const args = {
        acceptedClientRequestContext: {
          acceptedClientRequestEvents: [],
          rejectedClientRequestEvents: [],
        },
        contextWindowEvents: [],
        options: {
          ...options,
          workspaceRoot: null,
          completedTurnDisplay,
          includeNestedRows: true,
          includeDiagnosticOperations: false,
          isLatestPage: true,
        },
      };
      expect(
        buildThreadTimelineFromEvents({
          ...args,
          events: result.events,
          settledItems: result.items,
          settledToolFlushSequences: result.settledToolFlushSequences,
        }),
      ).toEqual(
        buildThreadTimelineFromEvents({ ...args, events: fromRows(rows) }),
      );
    },
  );

  it("keeps unfinished and reused assistant identities ordinary", () => {
    const factory = f();
    const rows = [
      factory.turnStarted(),
      factory.assistantDelta({ itemId: "answer", delta: "one" }),
      factory.assistantCompleted({ itemId: "answer", text: "one" }),
      factory.assistantDelta({ itemId: "answer", delta: "two" }),
      factory.assistantCompleted({ itemId: "answer", text: "two" }),
      factory.turnCompleted(),
    ];
    expect(compact(rows).candidates).toHaveLength(0);
  });
});

describe("settled item interaction with ordinary tool state", () => {
  it("preserves interruption of an ordinary tool when text becomes visible before a late completion", () => {
    const factory = f();
    const rows = [
      factory.turnStarted(),
      factory.delegationStarted({
        itemId: "ordinary",
        childRef: "child",
        label: "worker",
        background: false,
      }),
      factory.delegationCompleted({
        itemId: "ordinary",
        childRef: "child",
        label: "worker",
        background: false,
      }),
      factory.delegationStarted({
        itemId: "ordinary",
        childRef: "child",
        label: "worker",
        background: false,
      }),
      factory.assistantDelta({ itemId: "answer", delta: "visible\n" }),
      factory.assistantCompleted({
        itemId: "answer",
        text: "visible\nfinished",
      }),
      factory.turnCompleted(),
      factory.delegationCompleted({
        itemId: "ordinary",
        childRef: "child",
        label: "worker",
        background: false,
      }),
    ];
    const result = compact(rows);
    expect(result.candidates).toHaveLength(1);
    expect(result.settledToolFlushSequences).toEqual([rows[4].seq]);
    const args = {
      acceptedClientRequestContext: {
        acceptedClientRequestEvents: [],
        rejectedClientRequestEvents: [],
      },
      contextWindowEvents: [],
      options: {
        ...options,
        workspaceRoot: null,
        completedTurnDisplay: "flat" as const,
        includeNestedRows: true,
        includeDiagnosticOperations: false,
        isLatestPage: true,
      },
    };
    const expected = buildThreadTimelineFromEvents({
      ...args,
      events: fromRows(rows),
    });
    expect(
      buildThreadTimelineFromEvents({
        ...args,
        events: result.events,
        settledItems: result.items,
        settledToolFlushSequences: result.settledToolFlushSequences,
      }),
    ).toEqual(expected);
    expect(
      buildThreadTimelineFromEvents({
        ...args,
        events: result.events,
        settledItems: result.items,
      }),
    ).not.toEqual(expected);
  });

  it("removes only empty reasoning history and retains its original completion", () => {
    const factory = f();
    const rows = [
      factory.turnStarted(),
      factory.reasoningStarted({ itemId: "empty" }),
      factory.reasoningDelta({ itemId: "empty", delta: "" }),
      factory.reasoningCompleted({ itemId: "empty", text: "" }),
      factory.turnCompleted(),
    ];
    const result = compact(rows);
    expect(result.candidates).toEqual([
      {
        ownerId: rows[3].id,
        sequence: rows[3].seq,
        removedIds: [rows[1].id, rows[2].id],
        data: null,
      },
    ]);
    expect(result.events.map((row) => row.meta.id)).toContain(rows[3].id);
    expect(result.items).toHaveLength(0);
  });
});

it("keeps same-item text from different parents ordinary", () => {
  const factory = f();
  const rows = [
    factory.turnStarted(),
    factory.assistantDelta({
      itemId: "shared",
      parentToolCallId: "first",
      delta: "first\n",
    }),
    factory.assistantDelta({
      itemId: "shared",
      parentToolCallId: "second",
      delta: "second\n",
    }),
    factory.assistantCompleted({
      itemId: "shared",
      parentToolCallId: "second",
      text: "second",
    }),
    factory.turnCompleted(),
  ];
  expect(compact(rows).candidates).toHaveLength(0);
});
