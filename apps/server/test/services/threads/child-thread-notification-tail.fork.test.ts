// bb-fork(parent-notify-tail): fork-owned coverage for the head+tail excerpt
import { describe, expect, it } from "vitest";
import {
  buildChildThreadTurnStatusBatchInput,
  type ChildThreadNotificationSource,
  type ChildThreadTurnNotificationBatchItem,
} from "../../../src/services/threads/child-thread-notifications.js";

const CHILD_THREAD_ID = "thr_child";
const TRUNCATION_MARKER = "[... output truncated ...]";
const BATCH_GUIDANCE =
  "Read each child thread's full final message with `bb thread output <thread-id>`.";
const ASK = "Жду сигнала, что ИБ приняла объекты.";

function childThread(
  id: string = CHILD_THREAD_ID,
): ChildThreadNotificationSource {
  return { id, projectId: "proj_alpha", title: "Write the runbook" };
}

function completedItem(
  terminalOutput: string | null,
  id: string = CHILD_THREAD_ID,
): ChildThreadTurnNotificationBatchItem {
  return {
    activeWorkflowCount: 0,
    childThread: childThread(id),
    terminalOutput,
    turnStatus: "completed",
  };
}

function renderMessage(items: ChildThreadTurnNotificationBatchItem[]): string {
  const [input] = buildChildThreadTurnStatusBatchInput({ items });
  if (!input || input.type !== "text") {
    throw new Error("Expected one text input");
  }
  return input.text;
}

describe("child thread notification excerpt tail", () => {
  it("keeps the head and the tail of a long final message", () => {
    const message = renderMessage([
      completedItem(`HEAD_SENTINEL${"a".repeat(10_000)}${ASK}`),
    ]);

    expect(message).toContain("HEAD_SENTINEL");
    expect(message).toContain(TRUNCATION_MARKER);
    expect(message).toContain(ASK);
    expect(message.indexOf(ASK)).toBeGreaterThan(
      message.indexOf(TRUNCATION_MARKER),
    );
    expect(message).toContain(`bb thread output ${CHILD_THREAD_ID}`);
  });

  it("keeps the notification within the excerpt budget", () => {
    const message = renderMessage([completedItem("b".repeat(20_000))]);

    expect(message.length).toBeLessThan(4_200);
  });

  it("leaves a short final message untouched", () => {
    const message = renderMessage([
      completedItem("Implemented the requested change."),
    ]);

    expect(message).toContain("Implemented the requested change.");
    expect(message).not.toContain(TRUNCATION_MARKER);
  });

  it("names the full output for every child in a batch", () => {
    const message = renderMessage([
      completedItem("first child output", "thr_child_one"),
      completedItem("second child output", "thr_child_two"),
    ]);

    expect(message).toContain("Child thread updates:");
    expect(message).toContain(BATCH_GUIDANCE);
    expect(message).not.toContain("first child output");
  });
});
