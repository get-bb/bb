import { expect, it } from "vitest";
import { createCodexEventTranslator } from "./translator.js";

function createResponseOpenedTurn(status: "inProgress" | "completed") {
  const translator = createCodexEventTranslator({
    additionalWorkspaceWriteRoots: [],
  });
  translator.prepareTurnStart({
    providerThreadId: "parent",
    clientRequestId: "creq_parent1234",
  });
  const deltas = translator.openTurnFromStartResponse({
    providerThreadId: "parent",
    clientRequestId: "creq_parent1234",
    turn: { id: "turn-1", status },
    turnAlreadyOpen: false,
  });
  expect(deltas.filter((delta) => delta.kind === "turn.open")).toHaveLength(1);
  expect(
    deltas.filter((delta) => delta.kind === "input.accepted"),
  ).toHaveLength(1);
  return translator;
}

it("deduplicates response lifecycles only within their provider thread", () => {
  const translator = createResponseOpenedTurn("inProgress");
  const child = translator.translateEvent({
    jsonrpc: "2.0",
    method: "turn/started",
    params: { threadId: "child", turn: { id: "turn-1", status: "inProgress" } },
  });
  expect(child.some((delta) => delta.kind === "turn.open")).toBe(true);
  expect(
    translator.translateEvent({
      jsonrpc: "2.0",
      method: "turn/started",
      params: {
        threadId: "parent",
        turn: { id: "turn-1", status: "inProgress" },
      },
    }),
  ).toEqual([]);
});

it("clears response lifecycle dedupe when the provider thread exits", () => {
  const translator = createResponseOpenedTurn("completed");
  translator.clearExitedChildThreadState({ providerThreadId: "parent" });
  translator.prepareTurnStart({
    providerThreadId: "parent",
    clientRequestId: "creq_resumed123",
  });
  const deltas = translator.translateEvent({
    jsonrpc: "2.0",
    method: "turn/started",
    params: {
      threadId: "parent",
      turn: { id: "turn-1", status: "inProgress" },
    },
  });
  expect(deltas).toContainEqual({
    kind: "input.accepted",
    providerTurnId: "turn-1",
    clientRequestId: "creq_resumed123",
  });
});

it("deduplicates both delayed boundaries of a response-completed turn", () => {
  const translator = createResponseOpenedTurn("completed");
  for (const method of ["turn/started", "turn/completed"]) {
    expect(
      translator.translateEvent({
        jsonrpc: "2.0",
        method,
        params: {
          threadId: "parent",
          turn: {
            id: "turn-1",
            status: method === "turn/started" ? "inProgress" : "completed",
          },
        },
      }),
    ).toEqual([]);
  }
  translator.prepareTurnStart({
    providerThreadId: "parent",
    clientRequestId: "creq_follow1234",
  });
  expect(
    translator.translateEvent({
      jsonrpc: "2.0",
      method: "turn/started",
      params: {
        threadId: "parent",
        turn: { id: "turn-2", status: "inProgress" },
      },
    }),
  ).toContainEqual({
    kind: "input.accepted",
    providerTurnId: "turn-2",
    clientRequestId: "creq_follow1234",
  });
});
