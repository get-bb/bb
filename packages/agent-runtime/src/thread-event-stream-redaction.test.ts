import { expect, it } from "vitest";
import { threadEventSchema, type ThreadEvent } from "@bb/domain";
import { createThreadEventStreamRedactor } from "./thread-event-stream-redaction.js";

function delta(
  text: string,
  itemId = "item",
  channel:
    | "item/agentMessage/delta"
    | "item/commandExecution/outputDelta" = "item/agentMessage/delta",
): Extract<ThreadEvent, { delta: string; itemId: string }> {
  return {
    type: channel,
    threadId: "thread",
    providerThreadId: "provider",
    itemId,
    delta: text,
    scope: { kind: "turn", turnId: "turn" },
  };
}

it("keeps separate text and command streams and flushes prefixes before cancellation", () => {
  const redactor = createThreadEventStreamRedactor(() => [
    "ghp_FAKE_REVIEW_TOKEN",
  ]);
  expect(redactor.push(delta("ghp_FAK"))).toEqual([]);
  expect(redactor.push(delta("safe", "other"))).toEqual([
    delta("safe", "other"),
  ]);
  expect(
    redactor.push(
      delta("ghp_FAK", "command", "item/commandExecution/outputDelta"),
    ),
  ).toEqual([]);
  expect(redactor.push(delta("E_REVIEW_TOKEN"))).toEqual([delta("[redacted]")]);
  expect(
    redactor.push(
      delta("E_REVIEW_TOKEN", "command", "item/commandExecution/outputDelta"),
    ),
  ).toEqual([
    delta("[redacted]", "command", "item/commandExecution/outputDelta"),
  ]);
  expect(redactor.push(delta("ghp_FAK"))).toEqual([]);
  const end: ThreadEvent = {
    type: "turn/completed",
    threadId: "thread",
    providerThreadId: "provider",
    status: "interrupted",
    scope: { kind: "turn", turnId: "turn" },
  };
  expect(redactor.push(end)).toEqual([delta("[redacted]"), end]);
});

it("preserves command reset semantics when flushing an unfinished prefix", () => {
  const redactor = createThreadEventStreamRedactor(() => ["secret"]);
  const event: ThreadEvent = {
    ...delta("safe sec", "command", "item/commandExecution/outputDelta"),
    type: "item/commandExecution/outputDelta",
    reset: true,
    itemId: "command",
    delta: "safe sec",
  };
  expect(redactor.push(event)).toEqual([{ ...event, delta: "safe " }]);
  expect(redactor.flush("thread")).toEqual([
    { ...event, delta: "[redacted]", reset: false },
  ]);
});

it("keeps short-secret matches out of structural fields and nested content keys", () => {
  const redactor = createThreadEventStreamRedactor(() => ["type", "completed"]);
  const event: ThreadEvent = {
    type: "item/completed",
    threadId: "type",
    providerThreadId: "completed",
    scope: { kind: "turn", turnId: "type" },
    item: {
      type: "toolCall",
      id: "type",
      tool: "type",
      status: "completed",
      arguments: { type: "type" },
      result: { type: "completed" },
    },
  };
  const result = redactor.push(event)[0];
  expect(threadEventSchema.safeParse(result).success).toBe(true);
  expect(result).toEqual({
    ...event,
    item: {
      ...event.item,
      arguments: { type: "[redacted]" },
      result: { type: "[redacted]" },
      error: undefined,
    },
  });
});

it("preserves complete event strings ending in a secret prefix", () => {
  const secret = "ghp_private-token";
  const path = `/workspaces/${secret.slice(0, 8)}`;
  const redactor = createThreadEventStreamRedactor(() => [secret]);
  const event: ThreadEvent = {
    type: "item/completed",
    threadId: "thread",
    providerThreadId: "provider",
    scope: { kind: "turn", turnId: "turn" },
    item: {
      type: "toolCall",
      id: "item",
      tool: "fixture",
      status: "completed",
      arguments: { path },
      result: { path, token: secret },
    },
  };
  expect(redactor.push(event)).toMatchObject([
    { item: { arguments: { path }, result: { path, token: "[redacted]" } } },
  ]);
});
