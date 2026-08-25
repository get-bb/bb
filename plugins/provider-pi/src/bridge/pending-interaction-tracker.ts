import {
  pendingInteractionResolutionSchema,
  type BridgeJsonRpcResponse,
  type PendingInteractionPayload,
  type PendingInteractionResolution,
} from "@get-bb/plugin-sdk/provider-bridge";

export class PiExtensionInteractionCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiExtensionInteractionCancelledError";
  }
}

export interface PiBridgeInteractionCancelNotification {
  jsonrpc: "2.0";
  method: "interaction/cancel";
  params: {
    requestId: string | number;
    providerThreadId: string;
    threadId: string;
    reason: string;
  };
}

export interface PiBridgeInteractionRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: "interaction/request";
  params: {
    threadId: string;
    providerThreadId: string;
    turnId: null;
    experimental_scope: "thread";
    payload: PendingInteractionPayload;
  };
}

export interface PiExtensionInteractionRequest {
  cancel(message: string): void;
  response: Promise<PendingInteractionResolution>;
}

interface PendingInteraction {
  reject(error: Error): void;
  resolve(resolution: PendingInteractionResolution): void;
}

export interface PiPendingInteractionTracker {
  cancel(message: string): void;
  handleResponse(response: BridgeJsonRpcResponse): boolean;
  request(payload: PendingInteractionPayload): PiExtensionInteractionRequest;
}

/**
 * One tracker belongs to one pi session. Request ids are process-global at
 * the caller, while cancellation removes this session's callbacks before a
 * replacement can be installed, so a late answer can never cross into a
 * new session.
 */
export function createPiPendingInteractionTracker(options: {
  nextRequestId(): string;
  providerThreadId: string;
  send(request: PiBridgeInteractionRequest): void;
  sendCancel(notification: PiBridgeInteractionCancelNotification): void;
  threadId: string;
}): PiPendingInteractionTracker {
  const pending = new Map<string | number, PendingInteraction>();
  const cancelRequest = (requestId: string | number, message: string): void => {
    const entry = pending.get(requestId);
    if (!entry) {
      return;
    }
    pending.delete(requestId);
    try {
      options.sendCancel({
        jsonrpc: "2.0",
        method: "interaction/cancel",
        params: {
          requestId,
          providerThreadId: options.providerThreadId,
          threadId: options.threadId,
          reason: message,
        },
      });
    } catch {
      // Local cancellation remains authoritative if the transport closed.
    }
    entry.reject(new PiExtensionInteractionCancelledError(message));
  };

  return {
    request(payload) {
      const requestId = options.nextRequestId();
      const response = new Promise<PendingInteractionResolution>((resolve, reject) => {
        pending.set(requestId, { reject, resolve });
        try {
          options.send({
            jsonrpc: "2.0",
            id: requestId,
            method: "interaction/request",
            params: {
              threadId: options.threadId,
              providerThreadId: options.providerThreadId,
              turnId: null,
              experimental_scope: "thread",
              payload,
            },
          });
        } catch (error) {
          pending.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      return {
        cancel: (message) => cancelRequest(requestId, message),
        response,
      };
    },
    handleResponse(response) {
      const entry = pending.get(response.id);
      if (!entry) {
        return false;
      }
      pending.delete(response.id);
      if ("error" in response) {
        entry.reject(new Error(response.error.message ?? "Interaction failed"));
        return true;
      }
      try {
        entry.resolve(pendingInteractionResolutionSchema.parse(response.result));
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return true;
    },
    cancel(message) {
      for (const requestId of [...pending.keys()]) {
        cancelRequest(requestId, message);
      }
    },
  };
}
