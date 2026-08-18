/**
 * The narrow-grammar `thread/delta` notification (prototype).
 *
 * A bridge that speaks this dialect emits parsed *semantic deltas* instead of
 * finished `ThreadEvent`s: the runtime's delta assembler owns turn/item id
 * minting, accepted-input correlation, item pairing and settlement, text and
 * usage accumulation, and every canonical event construction. Deltas carry
 * provider-native join keys (tool-call ids, stream keys, parent refs, provider
 * turn ids) so the assembler can hold the bidirectional provider↔bb id maps.
 *
 * Additive to the existing protocol: `thread/event` bridges are untouched and
 * the protocol version is deliberately not bumped while the grammar is a
 * prototype (plans/narrow-grammar-protocol.md).
 */
import {
  clientTurnRequestIdSchema,
  providerErrorCategorySchema,
  providerErrorInfoSchema,
  providerRateLimitStateSchema,
  providerRawEventSchema,
  threadEventItemStatusSchema,
  threadEventPlanStepSchema,
  threadEventTokenUsageBreakdownSchema,
  threadEventTurnStatusSchema,
  threadEventWarningCategorySchema,
  threadTimelineGoalStatusSchema,
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
 * Provider-vouched turn key. When present on a delta, the assembler scopes
 * the produced events to the bb turn id mapped for this provider turn id —
 * minting the mapping on first sight, exactly as the codex bridge's
 * deterministic id stamping did — and the delta bypasses the current-turn
 * guard entirely (the only-caller-vouched-turn-ids rule: the provider named
 * the turn, so the bridge vouches for it). Providers whose dialect has no
 * native turn ids (pi, acp) simply omit it and keep the current-turn
 * semantics.
 */
const providerTurnIdSchema = z.string().min(1);

/**
 * The parsed item shapes a bridge classifies its provider's tool traffic
 * into. Everything richer (diffs, pending statuses, echoed fields on close)
 * is assembler-owned construction. Output-ish optional fields (aggregated
 * output, exit code, results) exist for providers whose native item payloads
 * carry them wholesale (codex); the generic close fields win when both are
 * present.
 */
export const deltaFileChangeSchema = z.object({
  path: z.string(),
  /** The bridge states the change kind; the assembler never derives it. */
  kind: z.enum(["add", "update", "delete"]),
  movePath: z.string().optional(),
  /** Provider-supplied unified diff; preferred over old/new text building. */
  diff: z.string().optional(),
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
    aggregatedOutput: z.string().optional(),
    exitCode: z.number().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal("fileChange"),
    /** Empty only on bare close-without-open fallbacks (path unknown). */
    changes: z.array(deltaFileChangeSchema),
  }),
  z.object({
    type: z.literal("tool"),
    tool: z.string(),
    server: z.string().optional(),
    args: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({ type: z.literal("compaction") }),
  z.object({ type: z.literal("agentMessage"), text: z.string() }),
  z.object({
    type: z.literal("reasoning"),
    summary: z.array(z.string()),
    content: z.array(z.string()),
  }),
  z.object({ type: z.literal("plan"), text: z.string() }),
  z.object({
    type: z.literal("webSearch"),
    queries: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal("webFetch"),
    url: z.string(),
    pattern: z.string().nullable(),
  }),
  z.object({ type: z.literal("imageView"), path: z.string() }),
]);
export type DeltaItemShape = z.infer<typeof deltaItemShapeSchema>;

export const deltaMessageChannelSchema = z.enum(["assistant", "reasoning"]);
export type DeltaMessageChannel = z.infer<typeof deltaMessageChannelSchema>;

/**
 * Item-keyed text channels (codex): channels that synthesize a delta-first
 * `item/started` for an unknown item id.
 */
export const deltaTextChannelSchema = z.enum([
  "agentMessage",
  "reasoningSummary",
  "reasoningText",
  "plan",
]);
export type DeltaTextChannel = z.infer<typeof deltaTextChannelSchema>;

/**
 * Item-keyed output channels (codex): channels that NEVER synthesize an open
 * — fabricating a commandExecution without its command would be worse than
 * the anomaly. The structural split between `item.textDelta` and
 * `item.outputDelta` is what encodes that rule.
 */
export const deltaOutputChannelSchema = z.enum(["command", "fileChange"]);
export type DeltaOutputChannel = z.infer<typeof deltaOutputChannelSchema>;

const deltaErrorSchema = z.object({ message: z.string() });

const deltaAttachSchema = z.enum(["open", "currentOrLast"]);

/**
 * Turnless fallback: item/stream deltas never open turns — only `turn.open`,
 * a claiming `turn.boundary`, and accepted-input lifecycle settlement do.
 * When a turn-scoped delta arrives with no turn to attach to, the assembler
 * surfaces this raw payload as a thread-scoped `provider/unhandled` (the
 * bridges' old "no active turn" guard, applied centrally). Absent, the
 * turnless delta is dropped silently. Irrelevant for deltas carrying a
 * `providerTurnId` (a vouched turn always resolves).
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
   * With `providerTurnId` the acceptance is emitted against that vouched turn
   * directly (codex correlates acceptance to a named native turn).
   */
  z.object({
    kind: z.literal("input.accepted"),
    clientRequestId: clientTurnRequestIdSchema,
    providerTurnId: providerTurnIdSchema.optional(),
  }),

  /**
   * An explicit provider signal opened work (pi `agent_start`, codex
   * `turn/started`). With `providerTurnId` the turn lives in the keyed
   * provider-turn space: several may be open at once (codex multiplexes
   * subagent child turns onto one thread) and none of the current-turn
   * machinery is touched.
   */
  z.object({
    kind: z.literal("turn.open"),
    providerTurnId: providerTurnIdSchema.optional(),
    /** Provider-native parent tool-call id for delegated child turns. */
    parentRef: z.string().min(1).optional(),
  }),

  /**
   * The bridge's conclusion that the turn settled. `claimIfIdle: true` marks
   * fallback closers that own a turn only if accepted input is pending
   * (`resolveProviderTerminalTurn`'s rule, applied centrally); an open turn is
   * always settled. A keyed boundary (`providerTurnId`) always emits — the
   * provider named the turn — and settles only that turn.
   */
  z.object({
    kind: z.literal("turn.boundary"),
    status: threadEventTurnStatusSchema,
    error: deltaErrorSchema.optional(),
    providerCheckpointId: z.string().min(1).optional(),
    claimIfIdle: z.boolean().optional(),
    providerTurnId: providerTurnIdSchema.optional(),
  }),

  /**
   * A parsed item opened. `attach: "currentOrLast"` pins the item to the turn
   * that is open or just closed without opening a new one (pi threshold
   * compaction); the default attaches to the open turn only. A known
   * `providerItemId` reuses its minted bb id (an explicit open reopens the
   * same item, codex's settle/reopen rule).
   */
  z.object({
    kind: z.literal("item.open"),
    key: deltaItemKeySchema,
    item: deltaItemShapeSchema,
    attach: deltaAttachSchema.optional(),
    providerTurnId: providerTurnIdSchema.optional(),
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
   *
   * Provider-identified closes (`key.providerItemId`) dedup: a repeated close
   * for a settled id is dropped and an explicit `item.open` reopens the id
   * (codex retries the terminal notification after approvals).
   */
  z.object({
    kind: z.literal("item.close"),
    key: deltaItemKeySchema,
    status: threadEventItemStatusSchema,
    resultText: z.string().optional(),
    exitCode: z.number().optional(),
    aggregatedOutput: z.string().optional(),
    /** Terminal approval verdict (codex declined → denied). Default null. */
    approvalStatus: z.literal("denied").optional(),
    item: deltaItemShapeSchema,
    providerTurnId: providerTurnIdSchema.optional(),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),

  /**
   * The provider's plan for the open turn (ACP `plan` updates, codex
   * `turn/plan/updated`). Mirrors `turn/plan/updated`.
   */
  z.object({
    kind: z.literal("turn.plan"),
    steps: z.array(threadEventPlanStepSchema),
    explanation: z.string().optional(),
    providerTurnId: providerTurnIdSchema.optional(),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),

  /**
   * Free-form progress on an open item (non-command tool updates).
   * Not in the plan's grammar cut; recorded in its Open Questions.
   */
  z.object({
    kind: z.literal("item.progress"),
    key: deltaItemKeySchema,
    message: z.string().optional(),
    providerTurnId: providerTurnIdSchema.optional(),
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
   * Item-keyed streamed text (codex message/reasoning/plan deltas). The first
   * delta for an unknown item id synthesizes the channel's `item/started`;
   * later deltas (and deltas for an id the provider already opened or
   * settled) reuse the mapped id.
   */
  z.object({
    kind: z.literal("item.textDelta"),
    key: deltaItemKeySchema,
    channel: deltaTextChannelSchema,
    text: z.string(),
    providerTurnId: providerTurnIdSchema.optional(),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),

  /**
   * Item-keyed exact output append (codex command/fileChange output deltas).
   * Never synthesizes an open and never diffs — the text is already a delta.
   */
  z.object({
    kind: z.literal("item.outputDelta"),
    key: deltaItemKeySchema,
    channel: deltaOutputChannelSchema,
    text: z.string(),
    providerTurnId: providerTurnIdSchema.optional(),
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
   * Exact provider-reported usage (codex): the provider already accumulates,
   * so the assembler fans the snapshot out verbatim to both usage events
   * (`thread/tokenUsage/updated` + `thread/contextWindowUsage/updated`, the
   * context meter reading `last.totalTokens`).
   */
  z.object({
    kind: z.literal("usage.exact"),
    total: threadEventTokenUsageBreakdownSchema,
    last: threadEventTokenUsageBreakdownSchema,
    modelContextWindow: z.number().nullable(),
    providerTurnId: providerTurnIdSchema.optional(),
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
    providerTurnId: providerTurnIdSchema.optional(),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),
  z.object({ kind: z.literal("context.cleared") }),

  /** The aggregate working-tree diff for a turn (codex turn/diff/updated). */
  z.object({
    kind: z.literal("turn.diff"),
    diff: z.string(),
    providerTurnId: providerTurnIdSchema.optional(),
  }),

  // Thread metadata (codex thread lifecycle notifications).
  z.object({ kind: z.literal("thread.started") }),
  z.object({
    kind: z.literal("thread.identity"),
    providerThreadId: z.string().min(1),
  }),
  z.object({ kind: z.literal("thread.name"), name: z.string().min(1) }),
  z.object({
    kind: z.literal("thread.goal"),
    objective: z.string(),
    status: threadTimelineGoalStatusSchema,
    tokenBudget: z.number().nullable(),
    tokensUsed: z.number(),
    timeUsedSeconds: z.number(),
  }),
  z.object({ kind: z.literal("thread.goalCleared") }),

  /**
   * Normalized rate-limit snapshot. The provider-dialect merge (codex's
   * sticky rateLimitReachedType over sparse rolling updates) stays
   * bridge-side — it is seeded from a per-child post-initialize read the
   * assembler never sees.
   */
  z.object({
    kind: z.literal("provider.rateLimits"),
    rateLimits: providerRateLimitStateSchema,
  }),

  /**
   * Provider-reported error. `settlesTurn: true` also closes the turn that
   * owns the error as failed (an open turn, or one claimed through pending
   * accepted input). A `providerTurnId` scopes the error to that vouched
   * turn; `threadScoped: true` pins thread scope (codex errors without a
   * native turn id never attach to whatever turn happens to be open).
   */
  z.object({
    kind: z.literal("provider.error"),
    message: z.string(),
    detail: z.string().optional(),
    willRetry: z.boolean().optional(),
    category: providerErrorCategorySchema.optional(),
    errorInfo: providerErrorInfoSchema.optional(),
    settlesTurn: z.boolean().optional(),
    providerTurnId: providerTurnIdSchema.optional(),
    threadScoped: z.boolean().optional(),
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
   * only-caller-vouched-turn-ids rule — and `providerTurnId` scopes it to
   * that vouched provider turn. `onlyIfNoTurn: true` inverts the guard: the
   * event surfaces only when NO turn is open (the old translators'
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
    providerTurnId: providerTurnIdSchema.optional(),
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

  /**
   * Provider-native id-space boundary: a new provider session was constructed
   * for this thread (start/resume/fork/rebuild), so its native turn/item ids
   * may repeat. Drops ALL assembly state for the thread — id maps, settled
   * sets, open items and streams; the bridge settles any open work first
   * (nothing is in flight at any construction site).
   */
  z.object({ kind: z.literal("session.reset") }),
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
