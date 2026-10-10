import type { ThreadQueuedMessage } from "@bb/domain";
import { makeThreadQueuedMessage } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  isQueueExpanded,
  nextCollapsedQueues,
  setQueueExpanded,
} from "./queued-messages-expanded";

const firstMessage = makeThreadQueuedMessage({ id: "q_first" });
const secondMessage = makeThreadQueuedMessage({ id: "q_second" });

function createQueues() {
  let collapsed: ReadonlyMap<string, ReadonlySet<string>> = new Map();
  return {
    show(
      threadId: string,
      queuedMessages: readonly ThreadQueuedMessage[] | null,
    ) {
      if (queuedMessages !== null) {
        collapsed = nextCollapsedQueues(collapsed, threadId, queuedMessages);
      }
      return isQueueExpanded(collapsed, threadId, queuedMessages);
    },
    close(threadId: string, queuedMessages: readonly ThreadQueuedMessage[]) {
      collapsed = setQueueExpanded(collapsed, threadId, false, queuedMessages);
    },
  };
}

describe("queued messages expanded state", () => {
  it("opens each thread's queue until that thread's queue is closed", () => {
    const queues = createQueues();
    expect(queues.show("thr_a", [firstMessage])).toBe(true);

    queues.close("thr_a", [firstMessage]);
    expect(queues.show("thr_a", [firstMessage])).toBe(false);
    expect(queues.show("thr_b", [secondMessage])).toBe(true);
    expect(queues.show("thr_a", [firstMessage])).toBe(false);
  });

  it("keeps a closed queue closed while any message it has held remains", () => {
    const queues = createQueues();
    queues.close("thr_a", [firstMessage]);

    queues.show("thr_a", [firstMessage, secondMessage]);
    expect(queues.show("thr_a", [secondMessage])).toBe(false);
    expect(queues.show("thr_a", null)).toBe(false);
  });

  it("reopens a closed queue once it empties", () => {
    const queues = createQueues();
    queues.close("thr_a", [firstMessage]);

    queues.show("thr_a", []);
    expect(queues.show("thr_a", [secondMessage])).toBe(true);
  });

  it("reopens a queue that emptied and refilled while its thread was away", () => {
    const collapsed = setQueueExpanded(new Map(), "thr_a", false, [
      firstMessage,
    ]);

    expect(isQueueExpanded(collapsed, "thr_a", [secondMessage])).toBe(true);
  });
});
