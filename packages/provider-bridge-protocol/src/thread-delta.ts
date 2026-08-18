/**
 * The narrow-grammar `thread/delta` notification (prototype).
 *
 * A bridge that speaks this dialect emits parsed *semantic deltas* instead of
 * finished `ThreadEvent`s: the runtime's delta assembler owns turn/item id
 * minting, accepted-input correlation, item pairing and settlement, text and
 * usage accumulation, and every canonical event construction. Deltas carry
 * provider-native join keys (tool-call ids, stream keys, parent refs) so the
 * assembler can hold the bidirectional provider↔bb id maps.
 *
 * Additive to the existing protocol: `thread/event` bridges are untouched and
 * the protocol version is deliberately not bumped while the grammar is a
 * prototype (plans/narrow-grammar-protocol.md).
 */
import {
  clientTurnRequestIdSchema,
  providerErrorCategorySchema,
  providerRawEventSchema,
  threadEventItemStatusSchema,
  threadEventPlanStepSchema,
  threadEventTokenUsageBreakdownSchema,
  threadEventTurnStatusSchema,
  threadEventWarningCategorySchema,
} from "@bb/domain";
import { z } from "zod";

export const THREAD_DELTA_NOTIFICATION_METHOD = "thread/delta";

/**
 * Provider-native join key for an item. `providerItemId` is the provider's
 * own id (a tool-call id); `channel` distinguishes provider-anonymous item
 * families (e.g. compaction); `parentRef` is the provider-native id of the
 * parent tool call for nested items. The assembler translates all of these to
 * bb-minted ids.
 */
export const deltaItemKeySchema = z.object({
  providerItemId: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  parentRef: z.string().min(1).optional(),
});
export type DeltaItemKey = z.infer<typeof deltaItemKeySchema>;

/**
 * The parsed item shapes a bridge classifies its provider's tool traffic
 * into. Everything richer (diffs, pending statuses, echoed fields on close)
 * is assembler-owned construction.
 */
export const deltaFileChangeSchema = z.object({
  path: z.string(),
  /** The bridge states the change kind; the assembler never derives it. */
  kind: z.enum(["add", "update", "delete"]),
  oldText: z.string().optional(),
  /** When present the assembler builds the unified diff from old/new text. */
  newText: z.string().optional(),
});
export type DeltaFileChange = z.infer<typeof deltaFileChangeSchema>;

export const deltaItemShapeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    command: z.string(),
    cwd: z.string(),
  }),
  z.object({
    type: z.literal("fileChange"),
    /** Empty only on bare close-without-open fallbacks (path unknown). */
    changes: z.array(deltaFileChangeSchema),
  }),
  z.object({
    type: z.literal("tool"),
    tool: z.string(),
    args: z.unknown().optional(),
  }),
  z.object({ type: z.literal("compaction") }),
]);
export type DeltaItemShape = z.infer<typeof deltaItemShapeSchema>;

export const deltaMessageChannelSchema = z.enum(["assistant", "reasoning"]);
export type DeltaMessageChannel = z.infer<typeof deltaMessageChannelSchema>;

const deltaErrorSchema = z.object({ message: z.string() });

const deltaAttachSchema = z.enum(["open", "currentOrLast"]);

/**
 * Turnless fallback: item/stream deltas never open turns — only `turn.open`,
 * a claiming `turn.boundary`, and accepted-input lifecycle settlement do.
 * When a turn-scoped delta arrives with no turn to attach to, the assembler
 * surfaces this raw payload as a thread-scoped `provider/unhandled` (the
 * bridges' old "no active turn" guard, applied centrally). Absent, the
 * turnless delta is dropped silently.
 */
export const deltaNoTurnFallbackSchema = z.object({
  raw: providerRawEventSchema,
  rawType: z.string(),
});
export type DeltaNoTurnFallback = z.infer<typeof deltaNoTurnFallbackSchema>;

export const threadDeltaSchema = z.discriminatedUnion("kind", [
  /**
   * The provider consumed an input (immediate or steered). The assembler owns
   * the queue-until-turn-opens behavior and the terminal-turn invariant.
   */
  z.object({
    kind: z.literal("input.accepted"),
    clientRequestId: clientTurnRequestIdSchema,
  }),

  /** An explicit provider signal opened work (pi `agent_start`). */
  z.object({ kind: z.literal("turn.open") }),

  /**
   * The bridge's conclusion that the turn settled. `claimIfIdle: true` marks
   * fallback closers that own a turn only if accepted input is pending
   * (`resolveProviderTerminalTurn`'s rule, applied centrally); an open turn is
   * always settled.
   */
  z.object({
    kind: z.literal("turn.boundary"),
    status: threadEventTurnStatusSchema,
    error: deltaErrorSchema.optional(),
    providerCheckpointId: z.string().min(1).optional(),
    claimIfIdle: z.boolean().optional(),
  }),

  /**
   * A parsed item opened. `attach: "currentOrLast"` pins the item to the turn
   * that is open or just closed without opening a new one (pi threshold
   * compaction); the default attaches to the open turn only.
   */
  z.object({
    kind: z.literal("item.open"),
    key: deltaItemKeySchema,
    item: deltaItemShapeSchema,
    attach: deltaAttachSchema.optional(),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),

  /**
   * The item settled. `item` is REQUIRED and always carries the full terminal
   * item shape (Michael's uniform close rule, 2026-08-18): the assembler
   * builds the completed item from it. With a same-shaped item open under the
   * key, the terminal shape wins and the opened item contributes only its
   * minted id; with a different-shaped item open, the assembler closes the
   * opened shape and then emits the terminal shape (ACP's dual-complete);
   * with nothing open it builds the bare completed item.
   */
  z.object({
    kind: z.literal("item.close"),
    key: deltaItemKeySchema,
    status: threadEventItemStatusSchema,
    resultText: z.string().optional(),
    exitCode: z.number().optional(),
    aggregatedOutput: z.string().optional(),
    item: deltaItemShapeSchema,
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),

  /**
   * The provider's plan for the open turn (ACP `plan` updates). Mirrors
   * `turn/plan/updated`; requires an open turn.
   */
  z.object({
    kind: z.literal("turn.plan"),
    steps: z.array(threadEventPlanStepSchema),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),

  /**
   * Free-form progress on an open item (non-command tool updates).
   * Not in the plan's grammar cut; recorded in its Open Questions.
   */
  z.object({
    kind: z.literal("item.progress"),
    key: deltaItemKeySchema,
    message: z.string(),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),

  /**
   * Streamed message text. The assembler synthesizes `item/started` on
   * delta-first opens and accumulates the stream text.
   */
  z.object({
    kind: z.literal("message.delta"),
    channel: deltaMessageChannelSchema,
    streamKey: z.string(),
    text: z.string(),
    parentRef: z.string().min(1).optional(),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),

  /**
   * Close a message stream. `text` present: settle with the provider's final
   * text (preferred over accumulation). `text` absent with `detach: true`:
   * release the stream silently so later text mints a fresh item (pi closes
   * the assistant stream when a tool call starts). `text` absent otherwise:
   * settle with the accumulated stream text (ACP-style).
   */
  z.object({
    kind: z.literal("message.close"),
    channel: deltaMessageChannelSchema,
    streamKey: z.string().optional(),
    text: z.string().optional(),
    detach: z.boolean().optional(),
    parentRef: z.string().min(1).optional(),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),

  /**
   * Cumulative command output snapshot (pi bash). The assembler diffs
   * consecutive snapshots into `outputDelta`/`reset` events.
   */
  z.object({
    kind: z.literal("command.outputSnapshot"),
    key: deltaItemKeySchema,
    text: z.string(),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),

  /** Last-turn usage; the assembler accumulates the running thread totals. */
  z.object({
    kind: z.literal("usage.turn"),
    tokens: threadEventTokenUsageBreakdownSchema,
    modelContextWindow: z.number().nullable().optional(),
  }),

  /**
   * Context-window meter. `attach: "currentOrLast"` legalizes post-turn
   * attachment (pi reports after `agent_end` for the turn that just closed).
   */
  z.object({
    kind: z.literal("contextWindow"),
    used: z.number().nullable(),
    size: z.number().nullable().optional(),
    estimated: z.boolean(),
    attach: deltaAttachSchema,
  }),

  z.object({
    kind: z.literal("context.compacted"),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),
  z.object({ kind: z.literal("context.cleared") }),

  /**
   * Provider-reported error. `settlesTurn: true` also closes the turn that
   * owns the error as failed (an open turn, or one claimed through pending
   * accepted input).
   */
  z.object({
    kind: z.literal("provider.error"),
    message: z.string(),
    detail: z.string().optional(),
    willRetry: z.boolean().optional(),
    category: providerErrorCategorySchema.optional(),
    settlesTurn: z.boolean().optional(),
  }),

  /**
   * `vouchedTurn: true` scopes the warning to the open turn when one exists
   * (ACP warnings are turn-scoped mid-turn); default is thread scope.
   */
  z.object({
    kind: z.literal("provider.warning"),
    summary: z.string().optional(),
    details: z.string().optional(),
    category: threadEventWarningCategorySchema.optional(),
    vouchedTurn: z.boolean().optional(),
  }),

  /**
   * The bridge's visibility classification decided this raw event is unknown.
   * `vouchedTurn: true` scopes it to the open turn if one exists — the
   * only-caller-vouched-turn-ids rule. `onlyIfNoTurn: true` inverts the
   * guard: the event surfaces only when NO turn is open (the old translators'
   * "known event, no active turn" visibility fallback for events that
   * otherwise translate to silence) and is dropped entirely mid-turn.
   */
  z.object({
    kind: z.literal("unhandled"),
    raw: providerRawEventSchema,
    rawType: z.string(),
    vouchedTurn: z.boolean(),
    onlyIfNoTurn: z.boolean().optional(),
    parentRef: z.string().min(1).optional(),
  }),

  /**
   * Lifecycle settlement: the session ended (interrupt, replacement, child
   * exit). The assembler closes the open turn and open items with statuses
   * derived from the reason.
   */
  z.object({
    kind: z.literal("session.ended"),
    reason: z.enum(["interrupted", "replaced", "exited"]),
    error: deltaErrorSchema.optional(),
  }),
]);
export type ThreadDelta = z.infer<typeof threadDeltaSchema>;
export type ThreadDeltaKind = ThreadDelta["kind"];

/** `thread/delta` notification params: batched deltas for one thread. */
export const threadDeltaNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    deltas: z.array(threadDeltaSchema),
  })
  .passthrough();
export type ThreadDeltaNotificationParams = z.infer<
  typeof threadDeltaNotificationParamsSchema
>;
