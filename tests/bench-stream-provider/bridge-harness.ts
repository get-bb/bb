import { expect } from "vitest";
import { z } from "zod";
import {
  type ThreadDelta,
  THREAD_DELTA_NOTIFICATION_METHOD,
  threadDeltaNotificationParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  experimental_assembleCapturedThreadEvents as assembleCapturedThreadEvents,
  experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import type {
  BridgeJsonRpcObject,
  BridgeJsonRpcOutputMessage,
  ThreadEvent,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./src/provider-bridge.js";
import {
  BENCH_STREAM_MODEL_ID,
  BENCH_STREAM_PROVIDER_ID,
} from "./src/vocabulary.js";

export const CWD = "/workspace/bench";

const EXECUTION_OPTIONS: BridgeJsonRpcObject = {
  model: BENCH_STREAM_MODEL_ID,
  reasoningLevel: "medium",
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
};

const CLIENT_REQUEST_ID = "creq_2345678923";

const identityResultSchema = z.object({ providerThreadId: z.string().min(1) });

let threadCounter = 0;

export interface BenchThread {
  threadId: string;
  providerThreadId: string;
}

function textInput(text: string): BridgeJsonRpcObject[] {
  return [{ type: "text", text, mentions: [] }];
}

export function createBenchBridgeHarness() {
  const harness = createBridgeJsonRpcTestHarness(handleLine);
  let requestCounter = 0;

  function respond(
    method: string,
    params: BridgeJsonRpcObject,
  ): BridgeJsonRpcOutputMessage {
    requestCounter += 1;
    const id = `bench-test-${requestCounter}`;
    harness.sendRequest(id, method, params);
    const response = harness.messages.find(
      (message) => message.id === id && message.method === undefined,
    );
    if (response === undefined) {
      throw new Error(`${method} was not answered synchronously`);
    }
    return response;
  }

  function request(
    method: string,
    params: BridgeJsonRpcObject,
  ): BridgeJsonRpcOutputMessage {
    const response = respond(method, params);
    expect(response.error, `${method} answered an error`).toBeUndefined();
    return response;
  }

  return {
    restore: harness.restore,
    takeMessages: harness.takeMessages,
    events(
      messages: readonly BridgeJsonRpcOutputMessage[] = harness.messages,
    ): ThreadEvent[] {
      return assembleCapturedThreadEvents(messages, BENCH_STREAM_PROVIDER_ID);
    },
    startThread(): BenchThread {
      threadCounter += 1;
      const threadId = `thr_bench_${threadCounter}`;
      const response = request("thread/start", {
        threadId,
        cwd: CWD,
        instructionMode: "append",
        options: EXECUTION_OPTIONS,
      });
      const { providerThreadId } = identityResultSchema.parse(response.result);
      harness.takeMessages();
      return { threadId, providerThreadId };
    },
    resumeThread(thread: BenchThread): BridgeJsonRpcOutputMessage {
      return request("thread/resume", {
        ...thread,
        cwd: CWD,
        instructionMode: "append",
        options: EXECUTION_OPTIONS,
      });
    },
    startTurn(thread: BenchThread, text: string): BridgeJsonRpcOutputMessage {
      return request("turn/start", {
        ...thread,
        input: textInput(text),
        clientRequestId: CLIENT_REQUEST_ID,
        options: EXECUTION_OPTIONS,
      });
    },
    steerTurn(thread: BenchThread, text: string): BridgeJsonRpcOutputMessage {
      return respond("turn/steer", {
        ...thread,
        expectedTurnId: "turn-active",
        input: textInput(text),
        clientRequestId: CLIENT_REQUEST_ID,
        options: EXECUTION_OPTIONS,
      });
    },
    stopThread(
      thread: BenchThread,
      intent: "interrupt" | "release",
    ): BridgeJsonRpcOutputMessage {
      return request("thread/stop", {
        ...thread,
        intent,
        activeTurnId: intent === "interrupt" ? "turn-active" : null,
      });
    },
  };
}

export type BenchBridgeHarness = ReturnType<typeof createBenchBridgeHarness>;

export function deltaNotifications(
  messages: readonly BridgeJsonRpcOutputMessage[],
  threadId: string,
): ThreadDelta[][] {
  return messages
    .filter((message) => message.method === THREAD_DELTA_NOTIFICATION_METHOD)
    .map((message) => threadDeltaNotificationParamsSchema.parse(message.params))
    .filter((notification) => notification.threadId === threadId)
    .map((notification) => notification.deltas);
}

export function completedItems(events: readonly ThreadEvent[]) {
  return events.flatMap((event) =>
    event.type === "item/completed" ? [event.item] : [],
  );
}

export function turnStatuses(events: readonly ThreadEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === "turn/completed" ? [event.status] : [],
  );
}
