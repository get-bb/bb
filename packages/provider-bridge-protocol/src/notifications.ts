import { providerRecoveryKindSchema } from "@bb/domain";
import { z } from "zod";

/**
 * Bridge → runtime notifications. Everything timeline-bound (assistant text,
 * tool calls, token usage, context-window usage, …) rides `thread/delta`
 * (see thread-delta.ts) as parsed semantic deltas the runtime's assembler
 * turns into canonical `ThreadEvent`s. The notifications here are runtime
 * signals that are not timeline events.
 */
export const BRIDGE_NOTIFICATION_METHODS = {
  threadIdentity: "thread/identity",
  sessionReplaced: "session/replaced",
  providerRaw: "provider/raw",
  providerRecovery: "provider/recovery",
  error: "error",
} as const;

export const threadIdentityNotificationSchema = z
  .object({
    threadId: z.string().min(1),
    providerThreadId: z.string().min(1),
    /** Refines the handshake's `sessionRestore` for this session. */
    sessionRestorable: z.boolean().optional(),
  })
  .passthrough();

/**
 * A provider session was torn down and rebuilt. Mandatory whenever the bridge
 * replaces a live session for any reason (execution-option change it cannot
 * apply in place, resume fallback, internal recovery). A silent rebuild is a
 * conformance failure: invisible session replacement is how hours of
 * background work died in #1268. The runtime surfaces this in the thread
 * timeline; any deltas settling in-flight work must be emitted (as
 * `thread/delta`) before this notification.
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

/**
 * A typed recovery hint: the bridge tells the runtime WHAT went wrong in the
 * runtime's own vocabulary, so the runtime never matches provider error text
 * (the codex regex set, the account-restart list, the archive idempotency
 * string match all go away in WS4). A runtime signal, not a timeline item —
 * the user-visible consequence, when there is one, is the `provider/error`
 * delta the bridge emits alongside, and the timeline stays free of
 * "restarting the bridge" noise. Lives here with `session/replaced` rather
 * than in `thread/delta` for the same reason `provider/raw` does: it is
 * consumed by the runtime's recovery logic, never persisted.
 *
 * `threadId` is absent for provider-wide conditions (`authRequired`,
 * `rateLimited` at the account level) and present when the hint is about one
 * session (`sessionArchived`, `staleTurn`). `retryable` says whether the
 * runtime may retry the failed command after acting on the hint.
 *
 * Additive: no consumer yet. WS4 (runtime cleanup) acts on each kind; until
 * then the runtime ignores the method like any unknown notification.
 */
export const providerRecoveryNotificationSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    kind: providerRecoveryKindSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .passthrough();

export type ProviderRecoveryNotification = z.infer<
  typeof providerRecoveryNotificationSchema
>;

export const errorNotificationSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    message: z.string().min(1),
  })
  .passthrough();
