import { describe, expect, it } from "vitest";
import { threadScope } from "@bb/domain";
import { normalizeEventProjection } from "../src/normalize-event-projection.js";
import { getProjectionEntryMessages } from "../src/event-projection-flatten.js";
import type {
  EventProjection,
  EventProjectionDelegationMessage,
  EventProjectionMessage,
} from "../src/event-projection-types.js";

function projection(messages: EventProjectionMessage[]): EventProjection {
  return {
    state: {
      activeThinking: null,
      activeWorkflows: [],
      activeBackgroundCommands: [],
    },
    entries: messages.map((message) => ({
      kind: "projected-message",
      message,
    })),
  };
}

function delegation(
  id: string,
  parentToolCallId?: string,
): EventProjectionDelegationMessage {
  return {
    id,
    kind: "delegation",
    threadId: "thread-1",
    scope: threadScope(),
    sourceSeqStart: 1,
    sourceSeqEnd: 2,
    sourceEvent: { seq: 2, part: 0 },
    createdAt: 2,
    ...(parentToolCallId ? { parentToolCallId } : {}),
    callId: id,
    toolName: "spawn_agent",
    childRef: null,
    background: false,
    output: "Done",
    completedAt: 2,
    status: "completed",
    childProjection: projection([]),
  };
}

function messagesIn(projection: EventProjection): EventProjectionMessage[] {
  return projection.entries.flatMap((entry) =>
    getProjectionEntryMessages(entry).flatMap((message) => [
      message,
      ...(message.kind === "delegation"
        ? messagesIn(message.childProjection)
        : []),
    ]),
  );
}

describe("normalizeEventProjection", () => {
  it("keeps repeated nested delegation identities linear in the rendered history", () => {
    const messages: EventProjectionMessage[] = [delegation("root")];
    for (let depth = 1; depth <= 5; depth++) {
      const parent = depth === 1 ? "root" : `child-${depth - 1}`;
      const child = delegation(`child-${depth}`, parent);
      messages.push(child, { ...child }, { ...child });
    }

    const result = messagesIn(normalizeEventProjection(projection(messages)));
    expect(result.map((message) => message.id)).toEqual([
      "root",
      "child-1",
      "child-2",
      "child-3",
      "child-4",
      "child-5",
    ]);
  });

  it("uses the latest state of a repeated child without repeating its descendants", () => {
    const child = delegation("child", "root");
    const result = messagesIn(
      normalizeEventProjection(
        projection([
          delegation("root"),
          { ...child, status: "pending", completedAt: null, output: "" },
          delegation("grandchild", "child"),
          {
            ...child,
            sourceSeqEnd: 20,
            sourceEvent: { seq: 20, part: 0 },
            createdAt: 20,
            output: "Latest result",
          },
        ]),
      ),
    );
    expect(result.map((message) => message.id)).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
    expect(result[1]).toMatchObject({
      status: "completed",
      output: "Latest result",
      sourceSeqEnd: 20,
    });
  });

  it("preserves different messages with identical content and their ordering", () => {
    const result = messagesIn(
      normalizeEventProjection(
        projection([
          delegation("root"),
          delegation("first", "root"),
          delegation("second", "root"),
        ]),
      ),
    );
    expect(result.map((message) => message.id)).toEqual([
      "root",
      "first",
      "second",
    ]);
  });
});
