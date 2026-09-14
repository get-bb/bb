import type { ThreadEvent } from "@bb/domain";
import { requireThreadEventScopeTurnId } from "@bb/domain";
import type { EventMeta } from "./event-decode.js";
import { getEventTurnId } from "./event-decode.js";

export interface CompactionLifecycleEvent {
  key: string;
  kind: "begin" | "end";
  detail?: string;
  parentToolCallId?: string;
}

export function getCompactionKey(
  decoded: ThreadEvent,
  meta: EventMeta,
): string {
  if (decoded.type === "thread/compacted") {
    return requireThreadEventScopeTurnId({
      type: decoded.type,
      scope: decoded.scope,
    });
  }
  const turnId = getEventTurnId(decoded);
  if (decoded.type === "item/started" || decoded.type === "item/completed") {
    return turnId ?? decoded.item.id;
  }
  return turnId ?? `seq-${meta.seq}`;
}

export function parseCompactionLifecycleEvent(
  decoded: ThreadEvent,
  meta: EventMeta,
  parentToolCallId: string | undefined,
): CompactionLifecycleEvent | null {
  if (
    (decoded.type === "item/started" || decoded.type === "item/completed") &&
    decoded.item.type === "contextCompaction"
  ) {
    return {
      key: getCompactionKey(decoded, meta),
      kind: decoded.type === "item/started" ? "begin" : "end",
      ...(parentToolCallId ? { parentToolCallId } : {}),
    };
  }

  if (decoded.type === "thread/compacted") {
    return {
      key: getCompactionKey(decoded, meta),
      kind: "end",
      ...(parentToolCallId ? { parentToolCallId } : {}),
    };
  }

  return null;
}
