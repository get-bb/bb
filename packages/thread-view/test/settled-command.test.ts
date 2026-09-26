import { describe, expect, it } from "vitest";
import type { ThreadEventRow } from "@bb/domain";
import {
  buildThreadTimelineFromEvents,
  buildThreadTimelineTurnDetailsFromEvents,
} from "../src/build-thread-timeline.js";
import { findSettledCommandCandidates } from "../src/settled-command-prototype.js";
import { decodeSettledCommand } from "../src/settled-command.js";
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
  const candidates = findSettledCommandCandidates(events, options);
  const hidden = new Set(
    candidates.flatMap((candidate) => [
      ...candidate.removedIds,
      candidate.ownerId,
    ]),
  );
  const commands = candidates.map((candidate) => {
    const owner = rows.find((row) => row.id === candidate.ownerId);
    if (!owner) throw new Error("Missing owner");
    return decodeSettledCommand(candidate.data);
  });
  return {
    events: events.filter((row) => !hidden.has(row.meta.id)),
    commands,
    candidates,
  };
}

describe("settled command projection", () => {
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
          settledCommands: result.commands,
        }),
      ).toEqual(
        buildThreadTimelineFromEvents({ ...args, events: fromRows(rows) }),
      );
    },
  );

  it("keeps one mutable output in the summary payload", () => {
    const [candidate] = compact(fixture()).candidates;
    const stored = {
      version: 1,
      message: decodeSettledCommand(candidate.data),
    };
    expect(stored.message.output).toBe("content");
    stored.message.output = "truncated";
    expect(decodeSettledCommand(JSON.stringify(stored)).output).toBe(
      "truncated",
    );
    expect(candidate.data).not.toContain('"aggregatedOutput"');
  });

  it("rejects malformed summaries and unsupported versions", () => {
    const [candidate] = compact(fixture()).candidates;
    expect(() =>
      decodeSettledCommand(
        candidate.data.replace('"version":1', '"version":2'),
      ),
    ).toThrow();
    const stored = {
      version: 1,
      message: decodeSettledCommand(candidate.data),
    };
    stored.message.sourceSeqEnd = -1;
    expect(() => decodeSettledCommand(JSON.stringify(stored))).toThrow();
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
        settledCommands: result.commands,
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
        settledCommands: result.commands,
      }),
    ).toEqual(buildThreadTimelineFromEvents({ ...args, events: source }));
    expect(() =>
      buildThreadTimelineFromEvents({
        ...args,
        events: [],
        settledCommands: result.commands,
      }),
    ).toThrow("without turn/started");
  });
});
