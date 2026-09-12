import { expect } from "vitest";
import { z } from "zod";
import {
  type ThreadDelta,
  THREAD_DELTA_NOTIFICATION_METHOD,
  threadDeltaNotificationParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  experimental_createBridgeDeltaEventCollector as createBridgeDeltaEventCollector,
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

const EXECUTION_OPTIONS: BridgeJsonRpcObject = {
  model: BENCH_STREAM_MODEL_ID,
  reasoningLevel: "medium",
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
};

const identityResultSchema = z.object({ providerThreadId: z.string().min(1) });

const CLIENT_REQUEST_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

let clientRequestCounter = 0;

function nextClientRequestId(): string {
  clientRequestCounter += 1;
  let remaining = clientRequestCounter;
  let suffix = "";
  while (suffix.length < 10) {
    suffix =
      CLIENT_REQUEST_ALPHABET[remaining % CLIENT_REQUEST_ALPHABET.length] +
      suffix;
    remaining = Math.floor(remaining / CLIENT_REQUEST_ALPHABET.length);
  }
  return `creq_${suffix}`;
}

interface DeltaNotification {
  threadId: string;
  deltas: ThreadDelta[];
}

export function createBenchBridgeHarness() {
  const harness = createBridgeJsonRpcTestHarness(handleLine);
  const collector = createBridgeDeltaEventCollector(BENCH_STREAM_PROVIDER_ID);
  let requestCounter = 0;
  let taken = 0;

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
    respond,
    request,
    restore: harness.restore,
    initialize(): void {
      request("initialize", {
        protocolVersion: 2,
        client: { name: "bench-stream-test", version: "0.0.0" },
        grammarVersions: [3, 3],
      });
    },
    startThread(threadId: string, cwd: string): string {
      const response = request("thread/start", {
        threadId,
        cwd,
        instructionMode: "append",
        options: EXECUTION_OPTIONS,
      });
      return identityResultSchema.parse(response.result).providerThreadId;
    },
    resumeThread(args: {
      threadId: string;
      providerThreadId: string;
      cwd: string;
    }): BridgeJsonRpcOutputMessage {
      return request("thread/resume", {
        threadId: args.threadId,
        providerThreadId: args.providerThreadId,
        cwd: args.cwd,
        instructionMode: "append",
        options: EXECUTION_OPTIONS,
      });
    },
    startTurn(args: {
      threadId: string;
      providerThreadId: string;
      text: string;
    }): BridgeJsonRpcOutputMessage {
      return request("turn/start", {
        threadId: args.threadId,
        providerThreadId: args.providerThreadId,
        input: [{ type: "text", text: args.text, mentions: [] }],
        clientRequestId: nextClientRequestId(),
        options: EXECUTION_OPTIONS,
      });
    },
    steerTurn(args: {
      threadId: string;
      providerThreadId: string;
      text: string;
    }): BridgeJsonRpcOutputMessage {
      return respond("turn/steer", {
        threadId: args.threadId,
        providerThreadId: args.providerThreadId,
        expectedTurnId: "turn-active",
        input: [{ type: "text", text: args.text, mentions: [] }],
        clientRequestId: nextClientRequestId(),
        options: EXECUTION_OPTIONS,
      });
    },
    stopThread(args: {
      threadId: string;
      providerThreadId: string;
      intent: "interrupt" | "release";
    }): BridgeJsonRpcOutputMessage {
      return request("thread/stop", {
        threadId: args.threadId,
        providerThreadId: args.providerThreadId,
        intent: args.intent,
        activeTurnId: args.intent === "interrupt" ? "turn-active" : null,
      });
    },
    takeMessages(): BridgeJsonRpcOutputMessage[] {
      const fresh = harness.messages.slice(taken);
      taken = harness.messages.length;
      return fresh;
    },
    allMessages(): readonly BridgeJsonRpcOutputMessage[] {
      return harness.messages;
    },
    assemble(messages: readonly BridgeJsonRpcOutputMessage[]): ThreadEvent[] {
      return messages.flatMap((message) => collector.assembleMessage(message));
    },
  };
}

export type BenchBridgeHarness = ReturnType<typeof createBenchBridgeHarness>;

export function deltaNotifications(
  messages: readonly BridgeJsonRpcOutputMessage[],
  threadId: string,
): DeltaNotification[] {
  return messages
    .filter((message) => message.method === THREAD_DELTA_NOTIFICATION_METHOD)
    .map((message) => threadDeltaNotificationParamsSchema.parse(message.params))
    .filter((notification) => notification.threadId === threadId)
    .map((notification) => ({
      threadId: notification.threadId,
      deltas: notification.deltas,
    }));
}
