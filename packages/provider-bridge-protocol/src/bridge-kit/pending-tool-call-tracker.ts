import {
  decodeToolCallResponsePayload,
  type BridgeJsonRpcResponse,
  type BridgeToolCallRequest,
} from "./bridge-tool-calls.js";

export interface BridgeToolCallResult {
  content: string;
  isError?: boolean;
}

interface PendingToolCall {
  resolve: (value: BridgeToolCallResult) => void;
  scope: object;
}

export interface ForwardBridgeToolCallArgs {
  arguments: Record<string, unknown>;
  providerThreadId: string;
  /**
   * The session the pending call belongs to. `resolvePendingToolCalls`
   * error-resolves by scope identity, so a bridge passes its own session
   * object and settles that session's calls on close/replace without touching
   * calls minted by a successor session under the same thread id.
   */
  scope: object;
  threadId: string;
  toolName: string;
}

export interface PendingToolCallTracker {
  /**
   * Mints an `item/tool/call` JSON-RPC request toward the runtime and returns
   * a promise settled by the matching response (or by
   * `resolvePendingToolCalls`). Never rejects: failures resolve as
   * `isError: true` results.
   */
  forwardToolCall: (
    args: ForwardBridgeToolCallArgs,
  ) => Promise<BridgeToolCallResult>;
  /** Returns true when the response settled a pending tool call. */
  handleToolCallResponse: (response: BridgeJsonRpcResponse) => boolean;
  /** Error-resolves every pending call minted under `scope`. */
  resolvePendingToolCalls: (scope: object, message: string) => void;
}

/**
 * Tracks the bridge's outgoing tool-call requests: mints request ids, sends
 * the `item/tool/call` envelope, and matches responses back to their waiting
 * promise via `decodeToolCallResponsePayload`.
 */
export function createPendingToolCallTracker(options: {
  sendToolCall: (request: BridgeToolCallRequest) => void;
}): PendingToolCallTracker {
  const pendingToolCalls = new Map<string | number, PendingToolCall>();
  let requestIdCounter = 0;

  return {
    forwardToolCall: (args) => {
      return new Promise<BridgeToolCallResult>((resolve) => {
        requestIdCounter += 1;
        const requestId = requestIdCounter;
        pendingToolCalls.set(requestId, { resolve, scope: args.scope });
        try {
          options.sendToolCall({
            jsonrpc: "2.0",
            id: requestId,
            method: "item/tool/call",
            params: {
              threadId: args.threadId,
              providerThreadId: args.providerThreadId,
              turnId: null,
              callId: `call-${requestId}`,
              tool: args.toolName,
              arguments: args.arguments,
            },
          });
        } catch (error) {
          // A throwing sender would otherwise reject the promise (breaking
          // the never-rejects contract) and strand the pending entry.
          pendingToolCalls.delete(requestId);
          resolve({
            content: error instanceof Error ? error.message : String(error),
            isError: true,
          });
        }
      });
    },
    handleToolCallResponse: (response) => {
      const pending = pendingToolCalls.get(response.id);
      if (!pending) {
        return false;
      }
      pendingToolCalls.delete(response.id);
      if ("error" in response) {
        pending.resolve({
          content: response.error.message ?? "Tool call failed",
          isError: true,
        });
      } else {
        pending.resolve(decodeToolCallResponsePayload(response.result));
      }
      return true;
    },
    resolvePendingToolCalls: (scope, message) => {
      for (const [requestId, pending] of pendingToolCalls) {
        if (pending.scope !== scope) {
          continue;
        }
        pendingToolCalls.delete(requestId);
        pending.resolve({ content: message, isError: true });
      }
    },
  };
}
