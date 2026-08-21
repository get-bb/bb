import { describe, expect, it } from "vitest";
import {
  LEGACY_CODEX_GOAL_EXTENSION_KIND,
  convertLegacyStoredThreadEvent,
  isLegacyThreadEventType,
} from "../src/legacy-thread-events.js";
import {
  parseStoredThreadEvent,
  parseThreadEventRow,
} from "../src/stored-thread-event.js";
import { threadScope } from "../src/thread-event-scope.js";

describe("legacy thread event conversion", () => {
  it("reads a persisted thread/goal/updated row as the codex goal state", () => {
    const event = parseStoredThreadEvent({
      type: "thread/goal/updated",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: threadScope(),
      data: {
        objective: "Ship the release",
        status: "budgetLimited",
        tokenBudget: 50_000,
        tokensUsed: 49_000,
        timeUsedSeconds: 1_200,
      },
    });
    expect(event).toEqual({
      type: "thread/extensionState/updated",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: threadScope(),
      kind: LEGACY_CODEX_GOAL_EXTENSION_KIND,
      payload: {
        objective: "Ship the release",
        status: "budgetLimited",
        tokenBudget: 50_000,
        tokensUsed: 49_000,
        timeUsedSeconds: 1_200,
      },
    });
  });

  it("reads a persisted thread/goal/cleared row as a null goal state", () => {
    // Rows carry providerThreadId inside data as well as on the column; the
    // converted data keeps it so either source still satisfies the schema.
    const row = parseThreadEventRow({
      id: "evt-2",
      type: "thread/goal/cleared",
      threadId: "thread-1",
      seq: 2,
      scope: threadScope(),
      data: { providerThreadId: "provider-1" },
      createdAt: 2,
    });
    expect(row.type).toBe("thread/extensionState/updated");
    expect(row.data).toEqual({
      providerThreadId: "provider-1",
      kind: LEGACY_CODEX_GOAL_EXTENSION_KIND,
      payload: null,
    });
  });

  it("still rejects a malformed legacy goal row", () => {
    expect(() =>
      parseStoredThreadEvent({
        type: "thread/goal/updated",
        threadId: "thread-1",
        providerThreadId: "provider-1",
        scope: threadScope(),
        data: { objective: 42 },
      }),
    ).toThrow();
  });

  it("passes every other type through untouched", () => {
    const stored = {
      type: "thread/name/updated" as const,
      data: { name: "A thread", providerThreadId: "provider-1" },
    };
    expect(convertLegacyStoredThreadEvent(stored)).toBe(stored);
    expect(isLegacyThreadEventType("thread/goal/updated")).toBe(true);
    expect(isLegacyThreadEventType("thread/extensionState/updated")).toBe(
      false,
    );
  });
});
