import {
  decodeToolCallResponsePayload,
  type BridgeJsonRpcResponse,
  type BridgeToolCallRequest,
} from "./bridge-tool-calls.js";

type ToolCallResult = { content: string; isError?: boolean };

export interface PendingBridgeToolCall {
  resolve: (value: ToolCallResult) => void;
}

export interface RegisteredBridgeSession {
  closing: boolean;
  pendingToolCalls: Map<string | number, PendingBridgeToolCall>;
}

interface CloseThreadSessionArgs {
  graceful?: boolean;
  message: string;
  threadId: string;
}

interface BridgeSessionRegistryOptions<
  TSession extends RegisteredBridgeSession,
  TCloseResult,
> {
  closeSessionGracefully: (session: TSession) => Promise<TCloseResult>;
  getProviderThreadId: (session: TSession, threadId: string) => string;
  nextToolCallRequestId?: () => number;
  resolveAdditionalPendingWork?: (session: TSession, message: string) => void;
  sendToolCall: (request: BridgeToolCallRequest) => void;
  stopSession?: (session: TSession) => Promise<TCloseResult> | TCloseResult;
}

export type BridgeToolCallForwarder = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<ToolCallResult>;

export function createBridgeSessionRegistry<
  TSession extends RegisteredBridgeSession,
  TCloseResult = void,
>(
  options: BridgeSessionRegistryOptions<TSession, TCloseResult>,
): {
  closeThreadSession: (
    args: CloseThreadSessionArgs,
  ) => Promise<TCloseResult | undefined>;
  closeThreadSessionsGracefully: (message: string) => Promise<void>;
  createForwardToolCall: (getThreadId: () => string) => BridgeToolCallForwarder;
  handleToolCallResponse: (response: BridgeJsonRpcResponse) => boolean;
  resolvePendingSessionWork: (session: TSession, message: string) => void;
  resolvePendingToolCalls: (session: TSession, message: string) => void;
  sessions: Map<string, TSession>;
} {
  const sessions = new Map<string, TSession>();
  const closingSessions = new Map<string, Promise<TCloseResult>>();
  let toolCallRequestIdCounter = 0;
  const nextToolCallRequestId =
    options.nextToolCallRequestId ??
    (() => {
      toolCallRequestIdCounter += 1;
      return toolCallRequestIdCounter;
    });

  const findSessionByPendingToolCall = (
    id: string | number,
  ): TSession | undefined => {
    for (const session of sessions.values()) {
      if (session.pendingToolCalls.has(id)) {
        return session;
      }
    }
    return undefined;
  };

  const resolvePendingToolCalls = (
    session: TSession,
    message: string,
  ): void => {
    for (const [requestId, pending] of session.pendingToolCalls) {
      session.pendingToolCalls.delete(requestId);
      pending.resolve({ content: message, isError: true });
    }
  };

  const resolvePendingSessionWork = (
    session: TSession,
    message: string,
  ): void => {
    resolvePendingToolCalls(session, message);
    options.resolveAdditionalPendingWork?.(session, message);
  };

  const closeThreadSession = async (
    args: CloseThreadSessionArgs,
  ): Promise<TCloseResult | undefined> => {
    const existingClose = closingSessions.get(args.threadId);
    if (existingClose) {
      return existingClose;
    }

    const session = sessions.get(args.threadId);
    if (!session) {
      return;
    }

    session.closing = true;
    resolvePendingSessionWork(session, args.message);
    const closePromise = Promise.resolve()
      .then(() =>
        args.graceful === false && options.stopSession
          ? options.stopSession(session)
          : options.closeSessionGracefully(session),
      )
      .finally(() => {
        if (sessions.get(args.threadId) === session) {
          sessions.delete(args.threadId);
        }
        closingSessions.delete(args.threadId);
      });
    closingSessions.set(args.threadId, closePromise);
    return closePromise;
  };

  return {
    sessions,
    closeThreadSession,
    closeThreadSessionsGracefully: async (message): Promise<void> => {
      await Promise.all(
        Array.from(sessions.keys()).map((threadId) =>
          closeThreadSession({ graceful: true, message, threadId }),
        ),
      );
    },
    createForwardToolCall: (getThreadId) => {
      return (toolName, args) => {
        return new Promise<ToolCallResult>((resolve) => {
          const threadId = getThreadId();
          const session = sessions.get(threadId);
          if (!session || session.closing) {
            resolve({ content: "Thread session not found", isError: true });
            return;
          }
          const requestId = nextToolCallRequestId();
          session.pendingToolCalls.set(requestId, { resolve });
          options.sendToolCall({
            jsonrpc: "2.0",
            id: requestId,
            method: "item/tool/call",
            params: {
              threadId,
              providerThreadId: options.getProviderThreadId(session, threadId),
              turnId: null,
              callId: `call-${requestId}`,
              tool: toolName,
              arguments: args,
            },
          });
        });
      };
    },
    handleToolCallResponse: (response) => {
      const session = findSessionByPendingToolCall(response.id);
      if (!session) {
        return false;
      }
      const pending = session.pendingToolCalls.get(response.id);
      if (!pending) {
        return false;
      }
      session.pendingToolCalls.delete(response.id);
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
    resolvePendingSessionWork,
    resolvePendingToolCalls,
  };
}
