/**
 * Shared fallback helpers for provider events that do not yet have a
 * first-class translation path.
 */

import {
  providerRawEventSchema,
  threadScope,
  turnScope,
  type ProviderRawEvent,
  type ThreadEvent,
} from "@bb/domain";
import type { ProviderUnhandledEvent } from "@bb/domain";
import type { ProviderVisibilityMetadata } from "../provider-visibility.js";
import type { JsonRpcMessage } from "../runtime-json-rpc.js";
import { getStringProperty, isRecord } from "./provider-visibility-helpers.js";
import { UNSTAMPED_THREAD_ID } from "./unstamped-thread-id.js";

export interface CreateUnhandledProviderEventArgs {
  providerId: string;
  rawEvent: JsonRpcMessage;
  rawType: string;
  threadId?: string;
  providerThreadId?: string;
  turnId?: string;
  parentToolCallId?: string;
}

export interface BuildUnhandledProviderEventsArgs {
  includeKnown?: boolean;
  providerId: string;
  rawEvent: JsonRpcMessage;
  visibilityMetadata: Pick<
    ProviderVisibilityMetadata,
    "describeParsedRawEvent" | "parseRawEvent"
  >;
  turnId?: string;
  parentToolCallId?: string;
}

function toProviderRawEvent(rawEvent: JsonRpcMessage): ProviderRawEvent {
  const parsed = providerRawEventSchema.safeParse(rawEvent);
  if (parsed.success) {
    return parsed.data;
  }

  return {
    jsonrpc: "2.0",
    ...(rawEvent.id !== undefined ? { id: rawEvent.id } : {}),
    method: rawEvent.method,
    params: {
      serializationError:
        "Provider raw event params were not JSON-serializable.",
    },
  };
}

function getThreadIdFromRawEvent(rawEvent: JsonRpcMessage): string {
  if (!isRecord(rawEvent.params)) {
    return UNSTAMPED_THREAD_ID;
  }
  return getStringProperty(rawEvent.params, "threadId") ?? UNSTAMPED_THREAD_ID;
}

export function createUnhandledProviderEvent(
  args: CreateUnhandledProviderEventArgs,
): ProviderUnhandledEvent {
  const threadId = args.threadId ?? getThreadIdFromRawEvent(args.rawEvent);
  const providerThreadId = args.providerThreadId ?? threadId;
  // Only a turn id the caller vouched for — one bb itself opened and can
  // therefore be trusted to have a stored turn/started — may scope this event.
  // A provider labels its own internal traffic with turn ids of its own making
  // (Codex tags automatic-compaction events "auto-compact-N"), and callers omit
  // `turnId` precisely when bb has no active turn, so reading one out of the
  // raw event would scope the event to a turn that never existed.
  const turnId = args.turnId;

  return {
    type: "provider/unhandled",
    threadId,
    providerThreadId,
    providerId: args.providerId,
    rawType: args.rawType,
    rawEvent: toProviderRawEvent(args.rawEvent),
    scope: turnId ? turnScope(turnId) : threadScope(),
    ...(args.parentToolCallId
      ? { parentToolCallId: args.parentToolCallId }
      : {}),
  };
}

export function buildUnhandledProviderEvents(
  args: BuildUnhandledProviderEventsArgs,
): ThreadEvent[] {
  const parsedRawEvent = args.visibilityMetadata.parseRawEvent(args.rawEvent);
  const description =
    args.visibilityMetadata.describeParsedRawEvent(parsedRawEvent);
  if (!args.includeKnown && description.coverage !== "unknown") {
    return [];
  }

  return [
    createUnhandledProviderEvent({
      providerId: args.providerId,
      rawEvent: args.rawEvent,
      rawType: description.kind,
      ...(args.turnId ? { turnId: args.turnId } : {}),
      ...(args.parentToolCallId
        ? { parentToolCallId: args.parentToolCallId }
        : {}),
    }),
  ];
}
