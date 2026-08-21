/**
 * The narrow-grammar `thread/delta` notification: the protocol's one and only
 * timeline lane (protocol version 2, grammar v3).
 *
 * A bridge emits parsed *semantic deltas* instead of finished `ThreadEvent`s:
 * the runtime's delta assembler owns turn/item id minting, accepted-input
 * correlation, item pairing and settlement, text and usage accumulation, and
 * every canonical event construction. Deltas carry provider-native join keys
 * (tool-call ids, stream keys, parent refs, provider turn ids) so the
 * assembler can hold the bidirectional provider↔bb id maps.
 *
 * Grammar v3 (docs/provider-plugin-api.md §3): the core vocabulary has
 * `fileRead`, `search`, `delegation`, `planSteps` and the open `extension`
 * shape, every `item.open`/`item.close` may carry a declarative
 * `presentation`, `extension.state` carries plugin-declared thread state,
 * and there is one streaming dialect (`item.textDelta`/`item.textClose`)
 * and one usage dialect (`usage` + `contextWindow`). The v2 dialects
 * (`message.delta`/`message.close`, `usage.turn`/`usage.exact`) are gone:
 * every bridge in this repo emits v3 and a bridge that reports a grammar
 * range without 3 is refused at the handshake. `presentation` stays optional
 * until every first-party bridge attaches it; the stabilization pass makes
 * it required.
 */
import {
  backgroundTaskStatusSchema,
  backgroundTaskUsageSchema,
  clientTurnRequestIdSchema,
  extensionKindSchema,
  jsonValueSchema,
  providerErrorCategorySchema,
  providerErrorInfoSchema,
  providerRateLimitStateSchema,
  providerRawEventSchema,
  threadEventItemPresentationSchema,
  threadEventItemStatusSchema,
  threadEventPlanStepSchema,
  threadEventSearchModeSchema,
  threadEventTokenUsageBreakdownSchema,
  threadEventTurnStatusSchema,
  threadEventWarningCategorySchema,
  workflowProgressSnapshotSchema,
} from "@bb/domain";
import { z } from "zod";

export const THREAD_DELTA_NOTIFICATION_METHOD = "thread/delta";

/**
 * Declarative presentation a bridge attaches to an item at `item.open` (and
 * re-states on `item.close`, whose item is the full terminal shape). The
 * assembler persists it on the canonical item so the row renders after the
 * plugin is uninstalled or upgraded, and so mobile renders every kind without
 * plugin code. The same schema as the persisted field
 * (`threadEventItemPresentationSchema` in @bb/domain) — one vocabulary, no
 * translation.
 *
 * Optional in grammar v3 so v2 bridges still validate; a later workstream
 * makes it required once every first-party bridge attaches it.
 */
export const deltaPresentationSchema = threadEventItemPresentationSchema;
export type DeltaPresentation = z.infer<typeof deltaPresentationSchema>;

/**
 * Internal separator the runtime's assembler joins provider key parts with
 * (item keys, stream keys). A unit separator rather than a NUL byte so the
 * assembler source stays a text file for git and greps; collision safety
 * comes from the schema below, which rejects any provider key containing it,
 * so two distinct key tuples can never join to the same string.
 */
export const THREAD_DELTA_KEY_SEPARATOR = "\u001f";

/**
 * One provider-supplied key part (item ids, channels, parent refs, stream
 * keys, provider turn ids). Non-empty — an empty part would let unrelated
 * keys collide on their joined form — and never containing the internal
 * separator. Validated here at the protocol boundary so a misbehaving bridge
 * fails loudly at parse time instead of silently cross-wiring streams.
 */
const deltaKeyPartSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes(THREAD_DELTA_KEY_SEPARATOR), {
    message:
      "provider keys must not contain the internal key separator (\\u001f)",
  });

/**
 * Provider-native join key for an item. `providerItemId` is the provider's
 * own id (a tool-call id); `channel` distinguishes provider-anonymous item
 * families (e.g. compaction); `parentRef` is the provider-native id of the
 * parent tool call for nested items. The assembler translates all of these to
 * bb-minted ids.
 */
export const deltaItemKeySchema = z.object({
  providerItemId: deltaKeyPartSchema.optional(),
  channel: deltaKeyPartSchema.optional(),
  parentRef: deltaKeyPartSchema.optional(),
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
const providerTurnIdSchema = deltaKeyPartSchema;

/**
 * The parsed item shapes a bridge classifies its provider's tool traffic
 * into. Everything richer (diffs, pending statuses, echoed fields on close)
 * is assembler-owned construction. Output-ish optional fields (aggregated
 * output, exit code, results) exist for providers whose native item payloads
 * carry them wholesale (codex). When both a shape field and its generic close
 * counterpart are present, precedence is per-shape: for `command` the generic
 * close fields (`aggregatedOutput`, `exitCode`) win over the shape's, but for
 * `tool` the shape's `result` wins over the close's `resultText`. The
 * asymmetry is deliberate — it preserves byte-equivalence with the original
 * codex-vs-pi translator conversions.
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

/**
 * A provider background task (claude workflows, backgrounded shells and
 * subagents). The full snapshot is re-embedded per event — the bridge owns the
 * dialect fold (per-index workflow records, generation counting) and the
 * assembler only re-emits it. The family's canonical events are structurally
 * thread-scoped by the domain grammar (`item/backgroundTask/progress` and
 * `item/backgroundTask/completed`), so its progress/close deltas need no open
 * turn; only the spawning `item.open` (→ `item/started`) is turn-scoped.
 */
export const deltaBackgroundTaskShapeSchema = z.object({
  type: z.literal("backgroundTask"),
  /**
   * The provider's stable task id, shared by every generation (restart) of
   * the same task. Rides through to the canonical item so consumers can
   * correlate a restarted task with its earlier generations — the assembler
   * mints fresh item ids per generation, so identity must travel as data,
   * never as id text.
   */
  familyId: z.string().min(1),
  taskType: z.string(),
  description: z.string(),
  status: threadEventItemStatusSchema,
  taskStatus: backgroundTaskStatusSchema,
  skipTranscript: z.boolean(),
  workflowName: z.string().optional(),
  workflow: workflowProgressSnapshotSchema.optional(),
  usage: backgroundTaskUsageSchema.optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
  outputFile: z.string().optional(),
});
export type DeltaBackgroundTaskShape = z.infer<
  typeof deltaBackgroundTaskShapeSchema
>;

/**
 * A file the agent read (grammar v3). Claude `Read` is the top generic tool in
 * the production corpus — 7,568 calls rendered as opaque `tool` rows — and
 * codex reads files through `cat`/`sed -n` commands the bridge already
 * classifies as read intents. `cmd` carries that native shell form when the
 * read ran through a command rather than a structured tool.
 */
export const deltaFileReadShapeSchema = z.object({
  type: z.literal("fileRead"),
  path: z.string(),
  cmd: z.string().optional(),
});
export type DeltaFileReadShape = z.infer<typeof deltaFileReadShapeSchema>;

/**
 * Grep, glob and directory listing as one shape (grammar v3), discriminated
 * by `mode`: `content` searches inside files (Claude `Grep`, `rg`), `path`
 * matches file names (Claude `Glob`, `fd`), `list` enumerates a directory
 * (`ls`, codex `list_dir`). `query` is the pattern — text or a regex for
 * `content`, a glob for `path`, an optional filter for `list` (empty when the
 * whole directory is listed); `path` is the root the search ran under when
 * the provider named one; `cmd` is the native shell form when it ran through
 * a command.
 */
export const deltaSearchShapeSchema = z.object({
  type: z.literal("search"),
  mode: threadEventSearchModeSchema,
  query: z.string(),
  path: z.string().optional(),
  cmd: z.string().optional(),
});
export type DeltaSearchShape = z.infer<typeof deltaSearchShapeSchema>;

/**
 * Delegated work (grammar v3): one shape for the three encodings in the
 * production data — codex `spawnAgent`/`wait` tool calls, the Claude `Agent`
 * tool with nested child turns, and backgrounded `local_agent` background
 * tasks — and for what the `thread/openWork` notification used to report,
 * since an open delegation IS open work. `childRef` is the provider-native child id; the
 * child's own deltas link back through `parentRef`. `background: true` marks
 * a delegation that outlives its turn: the assembler routes its progress and
 * close to the thread-scoped `item/delegation/*` events exactly as it does
 * for `backgroundTask`. The terminal `status` rides `item.close`, as
 * for `command` and `tool`; `summary` is the child's terminal summary.
 */
export const deltaDelegationShapeSchema = z.object({
  type: z.literal("delegation"),
  childRef: deltaKeyPartSchema,
  label: z.string(),
  background: z.boolean(),
  summary: z.string().optional(),
});
export type DeltaDelegationShape = z.infer<typeof deltaDelegationShapeSchema>;

/**
 * A structured plan snapshot as an item (grammar v3): codex `update_plan`
 * (295 production threads, discarded by the UI while it only rode the
 * turn-level `turn.plan`), ACP `plan` updates, and Claude
 * `TaskCreate`/`TaskUpdate`/`TodoWrite`. Each snapshot carries the full step
 * list and supersedes the previous one. The turn-level `turn.plan` delta is
 * gone: every in-repo bridge speaks this form, and the persisted
 * `turn/plan/updated` event type stays as read-only history.
 */
export const deltaPlanStepsShapeSchema = z.object({
  type: z.literal("planSteps"),
  steps: z.array(threadEventPlanStepSchema),
  explanation: z.string().optional(),
});
export type DeltaPlanStepsShape = z.infer<typeof deltaPlanStepsShapeSchema>;

/**
 * A plugin-defined item kind outside the core vocabulary (grammar v3).
 * `kind` is the namespaced `"<pluginId>/<name>"` the plugin declared in its
 * provider registration (`extensionKinds`); only the namespace shape is
 * validated here. The payload is opaque JSON at this layer: the assembler
 * copies it onto the canonical item, and the server validates it against the
 * plugin's declared item schema for `kind` at ingest, persisting a
 * `provider/unhandled` in its place on a miss.
 *
 * The shape carries no presentation of its own: presentation lives in ONE
 * place, the `item.open`/`item.close` delta's `presentation` field, and for
 * an extension shape that field is REQUIRED (enforced by the delta schema
 * below) — an extension item has no core renderer, so the declarative base
 * is the only thing every client can show.
 */
export const deltaExtensionShapeSchema = z.object({
  type: z.literal("extension"),
  kind: extensionKindSchema,
  payload: jsonValueSchema,
});
export type DeltaExtensionShape = z.infer<typeof deltaExtensionShapeSchema>;

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
  /**
   * The generic tool call: the escape hatch for tools with no core kind. In
   * grammar v3 the bridge says how the row reads through the delta's
   * `presentation` (label, icon, suppression) instead of core keeping a
   * tool-name table; a `tool` item without presentation renders with the
   * generic tool row.
   */
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
    prompt: z.string().nullable().optional(),
    pattern: z.string().nullable(),
  }),
  z.object({ type: z.literal("imageView"), path: z.string() }),
  deltaBackgroundTaskShapeSchema,
  // Grammar v3 shapes. Every existing shape above is kept unchanged.
  deltaFileReadShapeSchema,
  deltaSearchShapeSchema,
  deltaDelegationShapeSchema,
  deltaPlanStepsShapeSchema,
  deltaExtensionShapeSchema,
]);
export type DeltaItemShape = z.infer<typeof deltaItemShapeSchema>;
export type DeltaItemShapeType = DeltaItemShape["type"];

/**
 * The re-embedded snapshot an `item.progress` may carry for work that
 * outlives its turn. `backgroundTask` is the v2 form; `delegation` joins it in
 * v3 for background delegations (the assembler routes it to
 * `item/delegation/progress`).
 */
export const deltaProgressSnapshotSchema = z.discriminatedUnion("type", [
  deltaBackgroundTaskShapeSchema,
  deltaDelegationShapeSchema,
]);
export type DeltaProgressSnapshot = z.infer<typeof deltaProgressSnapshotSchema>;

/**
 * The streamed-text channels: which text item a stream feeds and which of its
 * fields the text lands in. `agentMessage` and `plan` items have one text;
 * a `reasoning` item has `summary` (`reasoningSummary`) and `content`
 * (`reasoningText`). A delta for an unknown item key synthesizes the
 * channel's `item/started`.
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

/**
 * Presentation lives in one place — the lifecycle delta — and an `extension`
 * shape cannot render without it, so the delta schema makes it mandatory
 * there rather than duplicating the field inside the shape.
 */
function requireExtensionPresentation(
  delta: { item: DeltaItemShape; presentation?: DeltaPresentation },
  ctx: z.RefinementCtx,
): void {
  if (delta.item.type === "extension" && delta.presentation === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "extension items require a presentation on item.open/item.close",
      path: ["presentation"],
    });
  }
}

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
    parentRef: deltaKeyPartSchema.optional(),
  }),

  /**
   * The bridge's conclusion that the turn settled. `claimIfIdle: true` marks
   * fallback closers that own a turn only if accepted input is pending
   * (the old bridge-kit terminal-turn rule, applied centrally); an open turn is
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
  z
    .object({
      kind: z.literal("item.open"),
      key: deltaItemKeySchema,
      item: deltaItemShapeSchema,
      /**
       * Grammar v3: how the row reads, persisted with the opened item. The
       * one place presentation travels. Optional for core shapes while v2
       * deltas are accepted; REQUIRED for `extension` shapes.
       */
      presentation: deltaPresentationSchema.optional(),
      attach: deltaAttachSchema.optional(),
      providerTurnId: providerTurnIdSchema.optional(),
      noTurnFallback: deltaNoTurnFallbackSchema.optional(),
    })
    .superRefine(requireExtensionPresentation),

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
  z
    .object({
      kind: z.literal("item.close"),
      key: deltaItemKeySchema,
      status: threadEventItemStatusSchema,
      resultText: z.string().optional(),
      exitCode: z.number().optional(),
      aggregatedOutput: z.string().optional(),
      /** Terminal approval verdict (codex declined → denied). Default null. */
      approvalStatus: z.literal("denied").optional(),
      item: deltaItemShapeSchema,
      /**
       * Grammar v3: the terminal presentation. Like `item`, the close carries
       * the full terminal form; when absent the opened item's presentation
       * survives onto the completed item (close-echo). REQUIRED for an
       * `extension` shape, which has nothing to echo without it.
       */
      presentation: deltaPresentationSchema.optional(),
      providerTurnId: providerTurnIdSchema.optional(),
      noTurnFallback: deltaNoTurnFallbackSchema.optional(),
    })
    .superRefine(requireExtensionPresentation),

  /**
   * Free-form progress on an open item (non-command tool updates), or — with
   * `snapshot` — a re-embedded snapshot of work that outlives its turn: a
   * background task (`item/backgroundTask/progress`) or, in grammar v3, a
   * background delegation (`item/delegation/progress`); both thread-scoped,
   * no turn required.
   *
   * Progress is throttled centrally by the assembler (one emission per item
   * key per policy interval, 500ms default; the newest suppressed snapshot is
   * flushed trailing-edge on the thread's next traffic once the window
   * elapses, and an `item.close` supersedes it). `flush: true` bypasses the
   * throttle and resets the window — status transitions must land immediately.
   */
  z.object({
    kind: z.literal("item.progress"),
    key: deltaItemKeySchema,
    message: z.string().optional(),
    snapshot: deltaProgressSnapshotSchema.optional(),
    flush: z.boolean().optional(),
    providerTurnId: providerTurnIdSchema.optional(),
    noTurnFallback: deltaNoTurnFallbackSchema.optional(),
  }),

  /**
   * Streamed text — the one streaming dialect. Every text stream is keyed
   * like every other item: by the provider's own item id when the provider
   * names its message items (codex), or by a bridge-chosen `key.channel`
   * (`"assistant"`, `"thinking-2"`) plus `key.parentRef` for providers whose
   * streams are anonymous (claude, pi, acp). The first delta for an unknown
   * key synthesizes the channel's `item/started`; later deltas (and deltas
   * for a provider id already opened or settled) reuse the mapped id. The
   * assembler accumulates the stream text per open item so `item.textClose`
   * can settle without a provider-final text.
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
   * Settle a text stream. `text` present: the provider's final text, preferred
   * over the accumulated stream (and enough on its own — a close for a key
   * nothing streamed under completes a fresh item). `text` absent: settle
   * with the accumulated stream text, completing nothing when the stream only
   * ever received whitespace. Either way the key is released, so later text
   * mints a fresh item. `channel` says which item to mint for a bare close
   * and where a provider-final `text` lands on a reasoning item. Providers
   * that name their message items may instead settle through `item.close`
   * with the full terminal shape (the uniform close rule) — that is the same
   * item lifecycle, not a second streaming dialect.
   */
  z.object({
    kind: z.literal("item.textClose"),
    key: deltaItemKeySchema,
    channel: deltaTextChannelSchema,
    text: z.string().optional(),
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

  /**
   * Provider-reported usage — the one usage dialect. `total` is the running
   * session total and `last` the most recent turn's usage; a provider that
   * reports exact cumulative totals (codex) forwards both verbatim, and a
   * provider that reports per-turn usage (claude, pi) sums `last` into
   * `total` itself (`addTokenUsage` in the bridge kit), resetting at every
   * session construction alongside `session.reset`. Emits
   * `thread/tokenUsage/updated` only: a provider whose usage also measures
   * the context window sends the `contextWindow` delta beside it.
   */
  z.object({
    kind: z.literal("usage"),
    total: threadEventTokenUsageBreakdownSchema,
    last: threadEventTokenUsageBreakdownSchema,
    modelContextWindow: z.number().nullable(),
    providerTurnId: providerTurnIdSchema.optional(),
  }),

  /**
   * Context-window meter. `attach: "currentOrLast"` legalizes post-turn
   * attachment (pi reports after `agent_end` for the turn that just closed);
   * a `providerTurnId` scopes the reading to that vouched turn instead
   * (codex measures the window per native turn) and `attach` is then
   * irrelevant.
   */
  z.object({
    kind: z.literal("contextWindow"),
    used: z.number().nullable(),
    size: z.number().nullable().optional(),
    estimated: z.boolean(),
    attach: deltaAttachSchema,
    providerTurnId: providerTurnIdSchema.optional(),
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

  /**
   * Plugin-declared thread state (grammar v3): `"<pluginId>/<name>"` kinds
   * beside the core thread-state family (usage, context window, rate limits,
   * model fallback, context cleared). Latest snapshot wins per kind — the
   * assembler and the timeline keep one value per `kind`, so a bridge re-sends
   * the whole state, never a diff. Codex goals ride this way (the codex
   * plugin's `provider-codex/goal`, a null payload once cleared). The payload
   * is opaque here; the server validates it against the plugin's declared
   * `state` schema at ingest (the same site as extension items).
   * The namespaced kind travels as `extensionKind` only because `kind` is
   * this union's discriminator; the item shape and the persisted item call
   * the same value `kind`.
   */
  z.object({
    kind: z.literal("extension.state"),
    extensionKind: extensionKindSchema,
    payload: jsonValueSchema,
  }),

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
   * The provider switched models mid-flight (claude model fallback). Scoped to
   * the open-or-just-closed turn when one exists, thread scope otherwise (the
   * claude translator's currentOrLast rule). Cross-message dedup of the early
   * assistant fallback block against the later system duplicate stays
   * bridge-side — it is keyed by the bridge's own segment tracking.
   */
  z.object({
    kind: z.literal("provider.modelFallback"),
    originalModel: z.string().min(1),
    fallbackModel: z.string().min(1),
    reason: z.enum(["refusal", "provider"]),
    message: z.string(),
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
    parentRef: deltaKeyPartSchema.optional(),
    providerTurnId: providerTurnIdSchema.optional(),
  }),

  /**
   * Lifecycle settlement: the session was interrupted. The assembler closes
   * the open turn and open items as interrupted.
   */
  z.object({ kind: z.literal("session.ended") }),

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
