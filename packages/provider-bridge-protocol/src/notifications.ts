import { threadEventSchema } from "@bb/domain";
import { z } from "zod";

/**
 * Bridge → runtime notifications. Everything that is a bb `ThreadEvent`
 * (assistant text, tool calls, token usage, context-window usage, …) rides
 * `thread/event` already translated and already stamped with bridge-minted
 * turn/item ids. The remaining notifications are runtime signals that are not
 * timeline events.
 */
export const BRIDGE_NOTIFICATION_METHODS = {
  threadEvent: "thread/event",
  threadIdentity: "thread/identity",
  sessionReplaced: "session/replaced",
  providerRaw: "provider/raw",
  error: "error",
} as const;

export type BridgeNotificationMethod =
  (typeof BRIDGE_NOTIFICATION_METHODS)[keyof typeof BRIDGE_NOTIFICATION_METHODS];

export const threadEventNotificationSchema = z
  .object({
    threadId: z.string().min(1),
    event: threadEventSchema,
  })
  .passthrough();

export type ThreadEventNotification = z.infer<
  typeof threadEventNotificationSchema
>;

export const threadIdentityNotificationSchema = z
  .object({
    threadId: z.string().min(1),
    providerThreadId: z.string().min(1),
    /** Refines the handshake's `sessionRestore` for this session. */
    sessionRestorable: z.boolean().optional(),
  })
  .passthrough();

export type ThreadIdentityNotification = z.infer<
  typeof threadIdentityNotificationSchema
>;

/**
 * A provider session was torn down and rebuilt. Mandatory whenever the bridge
 * replaces a live session for any reason (execution-option change it cannot
 * apply in place, resume fallback, internal recovery). A silent rebuild is a
 * conformance failure: invisible session replacement is how hours of
 * background work died in #1268. The runtime surfaces this in the thread
 * timeline; any events settling in-flight work must be emitted (as
 * `thread/event`) before this notification.
 */
export const sessionReplacedNotificationSchema = z
  .object({
    threadId: z.string().min(1),
    /** Identity of the replacement session (may equal the old identity). */
    providerThreadId: z.string().min(1).nullable(),
    /** Human-readable cause, shown in the timeline. */
    reason: z.string().min(1),
    /** True when provider-side context did not survive the replacement. */
    contextLost: z.boolean().default(false),
  })
  .passthrough();

export type SessionReplacedNotification = z.infer<
  typeof sessionReplacedNotificationSchema
>;

/**
 * Droppable diagnostics. The bridge classifies its provider's raw traffic
 * itself: "noise" is understood-and-intentionally-unrendered, "unknown" is
 * unrecognized (a translation gap worth surfacing in debug UI). Neither may
 * carry ids the runtime treats as bb identifiers, and the runtime may drop
 * these at any pressure point — they must never block real events (#1320).
 */
export const providerRawNotificationSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    coverage: z.enum(["noise", "unknown"]),
    payload: z.unknown(),
  })
  .passthrough();

export type ProviderRawNotification = z.infer<
  typeof providerRawNotificationSchema
>;

export const errorNotificationSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    message: z.string().min(1),
  })
  .passthrough();

export type ErrorNotification = z.infer<typeof errorNotificationSchema>;
