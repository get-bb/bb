import { resolveSystemErrorReconnectProgress } from "@bb/domain";
import type { ThreadEvent } from "@bb/domain";
import type { EventMeta } from "./event-decode.js";
import { messageId } from "./format-helpers.js";
import type { EventProjectionErrorMessage } from "./event-projection-types.js";

export function parseErrorMessage(
  decoded: ThreadEvent,
  meta: EventMeta,
): EventProjectionErrorMessage | null {
  if (decoded.type !== "provider/error" && decoded.type !== "system/error")
    return null;

  const { message, detail } = decoded;
  const reconnectState =
    decoded.type === "system/error"
      ? resolveSystemErrorReconnectProgress(decoded)
      : null;
  return {
    kind: "error",
    id: messageId(decoded.threadId, "error", `${meta.seq}`),
    threadId: decoded.threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    scope: decoded.scope,
    rawType: decoded.type,
    message: message || "Error event",
    detail: detail && detail !== message ? detail : null,
    ...(decoded.type === "provider/error" && decoded.errorInfo
      ? { providerErrorInfo: decoded.errorInfo }
      : {}),
    ...(decoded.type === "provider/error" && decoded.willRetry !== undefined
      ? { willRetry: decoded.willRetry }
      : {}),
    ...(reconnectState
      ? {
          reconnectAttempt: reconnectState.attempt,
          reconnectTotal: reconnectState.total,
        }
      : {}),
  };
}
