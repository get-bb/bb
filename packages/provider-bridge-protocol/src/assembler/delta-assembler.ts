/**
 * The delta assembler.
 *
 * One per bridge-protocol adapter in the runtime (and one per conformance or
 * calibration run in the testing kit): it consumes `thread/delta` notifications
 * (parsed semantic deltas from a bridge) and constructs every canonical
 * `ThreadEvent`. The bridge knows the dialect; this module knows the
 * timeline — it mints turn/item ids (entropy+serial, #1224 discipline held
 * centrally), correlates accepted input with the queue-until-turn-opens and
 * claim-if-idle terminal rules, synthesizes `item/started` for delta-first
 * streams, pairs item opens with closes (echoing started fields), diffs
 * cumulative command-output snapshots, settles turns and items on session
 * end, and coalesces streamed-text events per
 * flush window (`textDeltaFlushMs`, the same trailing-edge no-timer
 * discipline as the progress throttle) so chatty providers stop producing
 * one timeline event per token.
 *
 * Turn-opening rule: only `turn.open`, a claiming `turn.boundary`, and
 * accepted-input lifecycle settlement (`provider.error`/`session.ended` with
 * pending accepted input) ever open a turn. Item and stream deltas never do —
 * a turn-scoped delta with no turn to attach to surfaces its `noTurnFallback`
 * raw payload as a thread-scoped `provider/unhandled` (the old bridges'
 * "no active turn" guard, applied centrally) or is dropped when the bridge
 * attached none.
 *
 * Events leave with UNSTAMPED_THREAD_ID; the runtime stamps thread identity
 * downstream before any event leaves agent-runtime.
 */
import { randomUUID } from "node:crypto";
import type {
  ClientTurnRequestId,
  ThreadEvent,
  ThreadEventItem,
  ThreadEventItemPresentation,
  ThreadEventItemStatus,
} from "@bb/domain";
import { threadScope, turnScope } from "@bb/domain";
import type { BridgeGrammarVersions } from "../handshake.js";
import type {
  DeltaFileChange,
  DeltaItemKey,
  DeltaItemShape,
  DeltaNoTurnFallback,
  DeltaTextChannel,
  ThreadDelta,
} from "../thread-delta.js";
import { THREAD_DELTA_KEY_SEPARATOR } from "../thread-delta.js";
import { THREAD_DELTA_GRAMMAR_V3 } from "../version.js";

/**
 * The `thread/delta` grammar range this assembler speaks, reported to every
 * bridge in the `initialize` params so the two sides negotiate a version
 * (see `negotiateGrammarVersion` in the protocol). `[3, 3]`: the v2 dialects
 * (`message.*`, `usage.turn`/`usage.exact`) are deleted, so a bridge whose
 * range lacks 3 — including one that predates `grammarVersions` and reads as
 * `[2, 2]` — is refused at the handshake with a legible error instead of
 * connecting to an assembler that would drop its every stream.
 */
export const ASSEMBLER_GRAMMAR_VERSIONS: BridgeGrammarVersions = [
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_GRAMMAR_V3,
];
import {
  buildEditDiff,
  toOptionalRecord,
  withParentToolCallId,
} from "../bridge-kit/adapter-utils.js";

declare const unstampedThreadIdBrand: unique symbol;

type UnstampedThreadId = string & {
  readonly [unstampedThreadIdBrand]: "runtime-stamped-thread-id";
};

/**
 * Assembled events are emitted before the runtime resolves the bb thread.
 * Runtime stamping must replace this before events leave agent-runtime.
 */
const UNSTAMPED_THREAD_ID = "" as UnstampedThreadId;

// ---------------------------------------------------------------------------
// Cumulative-text diffing (absorbed from the pi bridge's diff-cumulative-text)
// ---------------------------------------------------------------------------

export interface DiffCumulativeTextArgs {
  nextText: string;
  previousText?: string;
}

export interface DiffCumulativeTextResult {
  delta: string;
  nextText: string;
  reset: boolean;
}

/**
 * Diffs a cumulative text snapshot against the previous one: emits only the
 * appended suffix when the provider keeps appending, or the full text with
 * `reset: true` when the snapshot restarted.
 */
export function diffCumulativeText(
  args: DiffCumulativeTextArgs,
): DiffCumulativeTextResult | null {
  const previousText = args.previousText ?? "";
  if (args.nextText.length === 0 || args.nextText === previousText) {
    return null;
  }
  if (previousText.length === 0) {
    return { delta: args.nextText, nextText: args.nextText, reset: false };
  }
  if (args.nextText.startsWith(previousText)) {
    const delta = args.nextText.slice(previousText.length);
    return delta.length > 0
      ? { delta, nextText: args.nextText, reset: false }
      : null;
  }
  return { delta: args.nextText, nextText: args.nextText, reset: true };
}

// ---------------------------------------------------------------------------
// Assembler state
// ---------------------------------------------------------------------------

const MAX_THREAD_STATES = 256;
const MAX_ID_MAP_ENTRIES = 1024;
/** Mirrors the codex bridge's per-session settled-id bound. */
const MAX_SETTLED_ITEM_KEYS = 512;

interface OpenItemState {
  bbItemId: string;
  key: DeltaItemKey;
  item: ThreadEventItem;
  /**
   * Thread-attached items (backgroundTask, background delegation) outlive
   * turns by design: turn settlement never clears or completes them, and
   * while one is open its thread is pinned against LRU eviction.
   */
  threadAttached: boolean;
  /**
   * Accumulated stream text for text items (`item.textDelta`): the item's
   * primary text (agentMessage/plan text, reasoning content) and, for
   * reasoning, its summary. An `item.textClose` without a provider-final
   * text settles from these.
   */
  text: string;
  summaryText: string;
}

/** A throttled progress emission awaiting its trailing-edge flush. */
interface PendingProgressState {
  event: ThreadEvent;
  /** Turn-scoped pending progress dies with its turn. */
  turnScoped: boolean;
}

/**
 * The streamed-text event family the assembler coalesces: consecutive events
 * for one stream (event type + item id) concatenate into a single event per
 * flush window. Everything else is an ordering barrier.
 */
type TextDeltaThreadEvent = Extract<
  ThreadEvent,
  {
    type:
      | "item/agentMessage/delta"
      | "item/reasoning/textDelta"
      | "item/reasoning/summaryTextDelta"
      | "item/plan/delta"
      | "item/commandExecution/outputDelta"
      | "item/fileChange/outputDelta";
  }
>;

function asTextDeltaEvent(
  event: ThreadEvent,
): TextDeltaThreadEvent | undefined {
  switch (event.type) {
    case "item/agentMessage/delta":
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
      return event;
    default:
      return undefined;
  }
}

/** A coalesced run of streamed-text deltas awaiting its trailing-edge flush. */
interface PendingTextState {
  /** The first suppressed event; the flush re-emits it with the joined text. */
  event: TextDeltaThreadEvent;
  text: string;
}

/**
 * What delta handlers emit into. `assemble()` wraps the returned event array
 * in a sink that applies the text-delta coalescing policy: streamed-text
 * events may be buffered per stream, and every other event flushes the
 * thread's buffers first (the ordering barrier).
 */
interface EventSink {
  push(...newEvents: ThreadEvent[]): void;
}

interface ThreadAssemblyState {
  currentTurnId: string | undefined;
  lastTurnId: string | undefined;
  pendingAccepted: ClientTurnRequestId[];
  /** Open (started, unsettled) items keyed by their provider join key. */
  openItemsByKey: Map<string, OpenItemState>;
  /** Last cumulative command-output snapshot per item key. */
  commandSnapshotsByKey: Map<string, string>;
  /** Both-way provider↔bb item id maps for command-plane reverse lookup. */
  bbItemIdByProviderItemId: Map<string, string>;
  providerItemIdByBbItemId: Map<string, string>;
  /** Both-way provider↔bb turn id maps (vouched provider-turn keys). */
  bbTurnIdByProviderTurnId: Map<string, string>;
  providerTurnIdByBbTurnId: Map<string, string>;
  /**
   * Provider-identified item keys already settled: a repeated `item.close`
   * for one of these is a provider retry and is dropped; an explicit
   * `item.open` reopens the key (codex's settle/reopen rule, held generically
   * for every provider-id space; channel-keyed items are exempt — bridge-local
   * families like acp fs-writes legitimately close the same key repeatedly).
   */
  settledItemKeys: Set<string>;
  /**
   * Central progress throttling (one emission per item key per policy
   * interval): last emission time per key — seeded by `item.open`, so a
   * provider's first progress inside the open's window is already throttled —
   * and the newest suppressed emission awaiting its trailing-edge flush.
   */
  progressLastEmitByKey: Map<string, number>;
  pendingProgressByKey: Map<string, PendingProgressState>;
  /**
   * Text-delta coalescing (one emitted event per stream per flush window):
   * last emission time per stream — absent means a fresh stream, whose first
   * delta emits immediately so time-to-first-token is unchanged — and the
   * coalesced text awaiting its trailing-edge flush.
   */
  textLastEmitByStream: Map<string, number>;
  pendingTextByStream: Map<string, PendingTextState>;
}

export interface CreateDeltaAssemblerOptions {
  /** Provider id stamped onto provider/unhandled events. */
  providerId: string;
  /**
   * Entropy prefix for minted turn/item ids. Defaults to fresh per-assembler
   * entropy so ids never collide across assembler (process) restarts; tests
   * inject a fixed prefix for determinism.
   */
  entropyPrefix?: string;
  /**
   * Minimum gap between emitted `item.progress` events per item key
   * (`flush: true` bypasses it; `item.close` always emits). 500ms default —
   * the cadence the claude bridge hand-rolled for background-task snapshots,
   * now the central policy for every provider's progress stream.
   */
  progressThrottleMs?: number;
  /**
   * Coalescing window for streamed-text events (assistant/reasoning/plan
   * deltas and command/fileChange output deltas) per stream. Within the
   * window consecutive deltas concatenate into one emitted event of the same
   * type; the buffer flushes trailing-edge with no timers — on the thread's
   * next traffic once the window elapsed, on stream close, and before ANY
   * non-batchable event for the thread (the ordering barrier: coalescing
   * never reorders text relative to item opens/closes, turn events, errors,
   * or other streams' flushes). The first delta of a fresh stream always
   * emits immediately, keeping time-to-first-token unchanged. 100ms default;
   * 0 disables batching (one event per delta).
   */
  textDeltaFlushMs?: number;
  /** Clock override for tests. */
  now?: () => number;
}

export interface AssembleDeltasArgs {
  threadId: string;
  deltas: readonly ThreadDelta[];
}

export interface DeltaAssembler {
  assemble(args: AssembleDeltasArgs): ThreadEvent[];
  /** bb item id minted for a provider item id (command-plane lookup). */
  getBbItemId(threadId: string, providerItemId: string): string | undefined;
  /** Provider item id behind a bb item id (reverse command-plane lookup). */
  getProviderItemId(threadId: string, bbItemId: string): string | undefined;
  /** bb turn id minted for a vouched provider turn id. */
  getBbTurnId(threadId: string, providerTurnId: string): string | undefined;
  /** Provider turn id behind a bb turn id (steer/interrupt reverse lookup). */
  getProviderTurnId(threadId: string, bbTurnId: string): string | undefined;
  getOpenTurnId(threadId: string): string | undefined;
}

/**
 * Composite-key separator. Provider key parts can never contain it — the
 * protocol schema rejects them (thread-delta.ts) — so distinct key tuples
 * never join to the same string. A visible escape sequence rather than a raw
 * control byte keeps this file text for git and greps.
 */
const SEP = THREAD_DELTA_KEY_SEPARATOR;

function itemKeyString(key: DeltaItemKey): string {
  return [
    key.providerItemId ?? "",
    key.channel ?? "",
    key.parentRef ?? "",
  ].join(SEP);
}

/**
 * Grammar v3 presentation rides the lifecycle delta, not the shape, and is
 * persisted on the canonical item so the row renders after the plugin is
 * gone. `userMessage` is bb-authored and carries none.
 */
function withPresentation<TItem extends ThreadEventItem>(
  item: TItem,
  presentation: ThreadEventItemPresentation | undefined,
): TItem {
  if (presentation === undefined || item.type === "userMessage") {
    return item;
  }
  return { ...item, presentation };
}

function presentationOf(
  item: ThreadEventItem | undefined,
): ThreadEventItemPresentation | undefined {
  return item !== undefined && "presentation" in item
    ? item.presentation
    : undefined;
}

function trimOldestEntries<T>(map: Map<string, T>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done === true) {
      return;
    }
    map.delete(oldest.value);
  }
}

export function createDeltaAssembler(
  options: CreateDeltaAssemblerOptions,
): DeltaAssembler {
  const entropyPrefix =
    options.entropyPrefix ?? `da${randomUUID().slice(0, 8)}`;
  const progressThrottleMs = options.progressThrottleMs ?? 500;
  const textDeltaFlushMs = options.textDeltaFlushMs ?? 100;
  const now = options.now ?? Date.now;
  // Monotonic per-assembler counters: ids stay unique across every thread,
  // turn, and session this assembler ever sees.
  let turnCounter = 0;
  let itemCounter = 0;
  const states = new Map<string, ThreadAssemblyState>();

  function mintTurnId(): string {
    turnCounter += 1;
    return `${entropyPrefix}-t${turnCounter}`;
  }

  function mintItemId(): string {
    itemCounter += 1;
    return `${entropyPrefix}-i${itemCounter}`;
  }

  function stateFor(threadId: string): ThreadAssemblyState {
    const existing = states.get(threadId);
    if (existing) {
      // Refresh LRU position.
      states.delete(threadId);
      states.set(threadId, existing);
      return existing;
    }
    const created: ThreadAssemblyState = {
      currentTurnId: undefined,
      lastTurnId: undefined,
      pendingAccepted: [],
      openItemsByKey: new Map(),
      commandSnapshotsByKey: new Map(),
      bbItemIdByProviderItemId: new Map(),
      providerItemIdByBbItemId: new Map(),
      bbTurnIdByProviderTurnId: new Map(),
      providerTurnIdByBbTurnId: new Map(),
      settledItemKeys: new Set(),
      progressLastEmitByKey: new Map(),
      pendingProgressByKey: new Map(),
      textLastEmitByStream: new Map(),
      pendingTextByStream: new Map(),
    };
    states.set(threadId, created);
    pruneIdleStates();
    return created;
  }

  function pruneIdleStates(): void {
    while (states.size > MAX_THREAD_STATES) {
      let removed = false;
      for (const [threadId, state] of states) {
        // Eviction guard: a thread with an open turn, open items (notably
        // thread-attached background tasks awaiting their terminal event), or
        // queued accepted input must keep its state — evicting it would
        // orphan the open work's ids, and a dropped input.accepted would
        // strand the terminal-turn invariant (the acceptance could never
        // drain into its turn).
        if (
          state.currentTurnId !== undefined ||
          state.openItemsByKey.size > 0 ||
          state.pendingAccepted.length > 0 ||
          state.pendingTextByStream.size > 0
        ) {
          continue;
        }
        states.delete(threadId);
        removed = true;
        break;
      }
      if (!removed) {
        return;
      }
    }
  }

  function registerItemId(
    state: ThreadAssemblyState,
    providerItemId: string,
    bbItemId: string,
  ): void {
    state.bbItemIdByProviderItemId.set(providerItemId, bbItemId);
    state.providerItemIdByBbItemId.set(bbItemId, providerItemId);
    trimOldestEntries(state.bbItemIdByProviderItemId, MAX_ID_MAP_ENTRIES);
    trimOldestEntries(state.providerItemIdByBbItemId, MAX_ID_MAP_ENTRIES);
  }

  /**
   * The bb turn id for a provider-vouched turn key, minted on first sight.
   * Never emits `turn/started` — the provider named the turn, and the old
   * bridges' deterministic id stamping likewise scoped events to turns they
   * had not necessarily seen open.
   */
  function resolveVouchedTurnId(
    state: ThreadAssemblyState,
    providerTurnId: string,
  ): string {
    const existing = state.bbTurnIdByProviderTurnId.get(providerTurnId);
    if (existing !== undefined) {
      return existing;
    }
    const bbTurnId = mintTurnId();
    state.bbTurnIdByProviderTurnId.set(providerTurnId, bbTurnId);
    state.providerTurnIdByBbTurnId.set(bbTurnId, providerTurnId);
    trimOldestEntries(state.bbTurnIdByProviderTurnId, MAX_ID_MAP_ENTRIES);
    trimOldestEntries(state.providerTurnIdByBbTurnId, MAX_ID_MAP_ENTRIES);
    return bbTurnId;
  }

  function rememberProgressEmit(state: ThreadAssemblyState, key: string): void {
    state.progressLastEmitByKey.set(key, now());
    trimOldestEntries(state.progressLastEmitByKey, MAX_ID_MAP_ENTRIES);
  }

  /**
   * Trailing-edge flush: the newest suppressed progress per key lands on the
   * thread's next traffic once its throttle window has elapsed (an
   * `item.close` for the key supersedes it, and a settled turn drops its
   * turn-scoped pending progress).
   */
  function flushElapsedPendingProgress(
    state: ThreadAssemblyState,
    events: EventSink,
    skipKeys: ReadonlySet<string>,
  ): void {
    if (state.pendingProgressByKey.size === 0) {
      return;
    }
    const nowMs = now();
    for (const [key, pending] of [...state.pendingProgressByKey]) {
      // A progress delta for the key rides in this very batch: the newer
      // snapshot supersedes the pending one, so let the handler emit it.
      if (skipKeys.has(key)) {
        continue;
      }
      const last = state.progressLastEmitByKey.get(key);
      if (last !== undefined && nowMs - last < progressThrottleMs) {
        continue;
      }
      state.pendingProgressByKey.delete(key);
      state.progressLastEmitByKey.set(key, nowMs);
      events.push(pending.event);
    }
  }

  /**
   * Flushes EVERY coalesced text buffer for the thread, in arrival order.
   * All-or-nothing on purpose: any flush — like any non-batchable emission —
   * is an ordering barrier, so buffered text can never be overtaken by (or
   * overtake) later traffic.
   */
  function flushPendingText(
    state: ThreadAssemblyState,
    out: ThreadEvent[],
  ): void {
    if (state.pendingTextByStream.size === 0) {
      return;
    }
    const nowMs = now();
    for (const [streamKey, pending] of state.pendingTextByStream) {
      out.push({ ...pending.event, delta: pending.text });
      state.textLastEmitByStream.set(streamKey, nowMs);
    }
    state.pendingTextByStream.clear();
    trimOldestEntries(state.textLastEmitByStream, MAX_ID_MAP_ENTRIES);
  }

  /**
   * Trailing-edge text flush on the thread's next traffic: one buffer whose
   * window elapsed flushes ALL buffers (a flush is itself a barrier).
   */
  function flushElapsedPendingText(
    state: ThreadAssemblyState,
    out: ThreadEvent[],
  ): void {
    const nowMs = now();
    for (const streamKey of state.pendingTextByStream.keys()) {
      const last = state.textLastEmitByStream.get(streamKey);
      if (last === undefined || nowMs - last >= textDeltaFlushMs) {
        flushPendingText(state, out);
        return;
      }
    }
  }

  /** The text-delta coalescing policy for one batchable event. */
  function bufferTextDelta(
    state: ThreadAssemblyState,
    event: TextDeltaThreadEvent,
    out: ThreadEvent[],
  ): void {
    const streamKey = `${event.type}${SEP}${event.itemId}`;
    // A reset can never be absorbed into a concatenation: flush what came
    // before it, then emit the reset itself immediately.
    if (
      event.type === "item/commandExecution/outputDelta" &&
      event.reset === true
    ) {
      flushPendingText(state, out);
      out.push(event);
      state.textLastEmitByStream.set(streamKey, now());
      trimOldestEntries(state.textLastEmitByStream, MAX_ID_MAP_ENTRIES);
      return;
    }
    const last = state.textLastEmitByStream.get(streamKey);
    if (last === undefined) {
      // First delta of a fresh stream: emit immediately (behind any pending
      // older text — the barrier) so streaming starts with no added latency.
      flushPendingText(state, out);
      out.push(event);
      state.textLastEmitByStream.set(streamKey, now());
      trimOldestEntries(state.textLastEmitByStream, MAX_ID_MAP_ENTRIES);
      return;
    }
    const pending = state.pendingTextByStream.get(streamKey);
    if (now() - last >= textDeltaFlushMs) {
      // Window elapsed: this delta rides out now, joined with the buffer.
      if (pending === undefined) {
        state.pendingTextByStream.set(streamKey, { event, text: event.delta });
      } else {
        pending.text += event.delta;
      }
      flushPendingText(state, out);
      return;
    }
    if (pending === undefined) {
      state.pendingTextByStream.set(streamKey, { event, text: event.delta });
      return;
    }
    pending.text += event.delta;
  }

  function rememberSettledKey(state: ThreadAssemblyState, key: string): void {
    state.settledItemKeys.add(key);
    while (state.settledItemKeys.size > MAX_SETTLED_ITEM_KEYS) {
      const oldest = state.settledItemKeys.values().next();
      if (oldest.done === true) {
        return;
      }
      state.settledItemKeys.delete(oldest.value);
    }
  }

  /**
   * Provider-native parent ref → the bb id minted for that parent item. A
   * child-first arrival (the parent's own open has not been seen yet) mints
   * the parent's bb id NOW and registers the mapping, so the emitted event
   * never carries the raw provider id and the parent's later open/close
   * lands under this same minted id. This matches the old translators:
   * their parent ids were deterministic functions of the provider id (raw
   * for pi/acp, prefix-stamped for codex), so parent references resolved to
   * the id the parent item itself would carry regardless of arrival order.
   */
  function mapParentRef(
    state: ThreadAssemblyState,
    parentRef: string | undefined,
  ): string | undefined {
    if (parentRef === undefined) {
      return undefined;
    }
    const existing = state.bbItemIdByProviderItemId.get(parentRef);
    if (existing !== undefined) {
      return existing;
    }
    const bbItemId = mintItemId();
    registerItemId(state, parentRef, bbItemId);
    return bbItemId;
  }

  function ensureTurnOpen(
    state: ThreadAssemblyState,
    events: EventSink,
  ): string {
    if (state.currentTurnId !== undefined) {
      return state.currentTurnId;
    }
    const turnId = mintTurnId();
    state.currentTurnId = turnId;
    events.push({
      type: "turn/started",
      threadId: UNSTAMPED_THREAD_ID,
      providerThreadId: "",
      scope: turnScope(turnId),
    });
    while (state.pendingAccepted.length > 0) {
      const clientRequestId = state.pendingAccepted.shift();
      if (clientRequestId === undefined) {
        break;
      }
      events.push({
        type: "turn/input/accepted",
        threadId: UNSTAMPED_THREAD_ID,
        providerThreadId: "",
        scope: turnScope(turnId),
        clientRequestId,
      });
    }
    return turnId;
  }

  function finishTurn(state: ThreadAssemblyState): void {
    state.lastTurnId = state.currentTurnId ?? state.lastTurnId;
    state.currentTurnId = undefined;
    // Thread-attached items (background tasks) outlive the turn that spawned
    // them; everything turn-scoped is abandoned with the turn.
    for (const [key, open] of [...state.openItemsByKey]) {
      if (!open.threadAttached) {
        state.openItemsByKey.delete(key);
      }
    }
    for (const [key, pending] of [...state.pendingProgressByKey]) {
      if (pending.turnScoped) {
        state.pendingProgressByKey.delete(key);
      }
    }
    state.commandSnapshotsByKey.clear();
  }

  function currentOrLastTurnId(state: ThreadAssemblyState): string | undefined {
    return state.currentTurnId ?? state.lastTurnId;
  }

  // -------------------------------------------------------------------------
  // Item construction
  // -------------------------------------------------------------------------

  function buildFileChanges(
    shape: Extract<DeltaItemShape, { type: "fileChange" }>,
  ): Extract<ThreadEventItem, { type: "fileChange" }>["changes"] {
    return shape.changes.map((change: DeltaFileChange) => {
      // A provider-supplied diff wins; old/new text is the fallback source.
      const diff =
        change.diff ??
        (change.newText === undefined
          ? undefined
          : buildEditDiff(change.path, change.oldText, change.newText));
      return {
        path: change.path,
        kind: change.kind,
        ...(change.movePath === undefined ? {} : { movePath: change.movePath }),
        ...(diff ? { diff } : {}),
      };
    });
  }

  /** Does the opened canonical item carry the same classification as a shape? */
  function shapeMatchesItem(
    shape: DeltaItemShape,
    item: ThreadEventItem,
  ): boolean {
    switch (shape.type) {
      case "command":
        return item.type === "commandExecution";
      case "fileChange":
        return item.type === "fileChange";
      case "tool":
        return item.type === "toolCall";
      case "compaction":
        return item.type === "contextCompaction";
      case "agentMessage":
      case "reasoning":
      case "plan":
      case "webSearch":
      case "webFetch":
      case "imageView":
      case "backgroundTask":
      case "fileRead":
      case "search":
      case "delegation":
      case "planSteps":
        return item.type === shape.type;
      case "extension":
        // Two extension kinds are two classifications: a close that names a
        // different kind than the open settles both (dual-settle).
        return item.type === "extension" && item.kind === shape.kind;
    }
  }

  /**
   * The full snapshot the bridge re-embeds per background-task event, as the
   * canonical item. `status` travels inside the shape — the bridge derives it
   * from the provider's task status.
   */
  function buildBackgroundTaskItem(
    bbItemId: string,
    shape: Extract<DeltaItemShape, { type: "backgroundTask" }>,
    parentToolCallId: string | undefined,
  ): Extract<ThreadEventItem, { type: "backgroundTask" }> {
    return withParentToolCallId(
      {
        type: "backgroundTask",
        id: bbItemId,
        familyId: shape.familyId,
        taskType: shape.taskType,
        description: shape.description,
        status: shape.status,
        taskStatus: shape.taskStatus,
        skipTranscript: shape.skipTranscript,
        ...(shape.workflowName === undefined
          ? {}
          : { workflowName: shape.workflowName }),
        ...(shape.workflow === undefined ? {} : { workflow: shape.workflow }),
        ...(shape.usage === undefined ? {} : { usage: shape.usage }),
        ...(shape.summary === undefined ? {} : { summary: shape.summary }),
        ...(shape.error === undefined ? {} : { error: shape.error }),
        ...(shape.outputFile === undefined
          ? {}
          : { outputFile: shape.outputFile }),
      },
      parentToolCallId,
    );
  }

  /**
   * Grammar v3 status-bearing core kinds. One builder per kind serves open
   * (`status: "pending"`), close (the terminal status) and close-echo: the
   * shape carries every field but the status, exactly like `command`.
   */
  function buildFileReadItem(
    bbItemId: string,
    shape: Extract<DeltaItemShape, { type: "fileRead" }>,
    status: ThreadEventItemStatus,
    parentToolCallId: string | undefined,
  ): Extract<ThreadEventItem, { type: "fileRead" }> {
    return withParentToolCallId(
      {
        type: "fileRead",
        id: bbItemId,
        path: shape.path,
        ...(shape.cmd === undefined ? {} : { cmd: shape.cmd }),
        status,
      },
      parentToolCallId,
    );
  }

  function buildSearchItem(
    bbItemId: string,
    shape: Extract<DeltaItemShape, { type: "search" }>,
    status: ThreadEventItemStatus,
    parentToolCallId: string | undefined,
  ): Extract<ThreadEventItem, { type: "search" }> {
    return withParentToolCallId(
      {
        type: "search",
        id: bbItemId,
        mode: shape.mode,
        query: shape.query,
        ...(shape.path === undefined ? {} : { path: shape.path }),
        ...(shape.cmd === undefined ? {} : { cmd: shape.cmd }),
        status,
      },
      parentToolCallId,
    );
  }

  /**
   * A delegation's `summary` is the child's terminal summary: the close's
   * shape carries it, and a close without one keeps what the open (or the
   * last progress snapshot) said, so a bare terminal snapshot never erases
   * the summary a provider reported earlier.
   */
  function buildDelegationItem(
    bbItemId: string,
    shape: Extract<DeltaItemShape, { type: "delegation" }>,
    status: ThreadEventItemStatus,
    parentToolCallId: string | undefined,
    fallbackSummary?: string,
  ): Extract<ThreadEventItem, { type: "delegation" }> {
    const summary = shape.summary ?? fallbackSummary;
    return withParentToolCallId(
      {
        type: "delegation",
        id: bbItemId,
        childRef: shape.childRef,
        label: shape.label,
        status,
        background: shape.background,
        ...(summary === undefined ? {} : { summary }),
      },
      parentToolCallId,
    );
  }

  /**
   * A plugin-defined item: opaque payload plus the mandatory presentation the
   * lifecycle delta carries (an extension item has no core renderer, so the
   * declarative base is the whole row). The server validates the payload
   * against the plugin's declared schema at ingest.
   */
  function buildExtensionItem(
    bbItemId: string,
    shape: Extract<DeltaItemShape, { type: "extension" }>,
    status: ThreadEventItemStatus,
    parentToolCallId: string | undefined,
    presentation: ThreadEventItemPresentation | undefined,
  ): Extract<ThreadEventItem, { type: "extension" }> {
    if (presentation === undefined) {
      // Unreachable for a parsed delta: the protocol schema refuses an
      // `item.open`/`item.close` whose shape is `extension` and that carries
      // no presentation (requireExtensionPresentation). Stated here because
      // the TypeScript delta type does not encode that refinement.
      throw new Error(
        `extension item "${shape.kind}" reached the assembler without a presentation`,
      );
    }
    return withParentToolCallId(
      {
        type: "extension",
        id: bbItemId,
        kind: shape.kind,
        payload: shape.payload,
        status,
        presentation,
      },
      parentToolCallId,
    );
  }

  function buildPlanStepsItem(
    bbItemId: string,
    shape: Extract<DeltaItemShape, { type: "planSteps" }>,
    status: ThreadEventItemStatus,
    parentToolCallId: string | undefined,
  ): Extract<ThreadEventItem, { type: "planSteps" }> {
    return withParentToolCallId(
      {
        type: "planSteps",
        id: bbItemId,
        steps: shape.steps,
        ...(shape.explanation === undefined
          ? {}
          : { explanation: shape.explanation }),
        status,
      },
      parentToolCallId,
    );
  }

  /**
   * Work that outlives its turn: background tasks, and delegations the bridge
   * marked `background`. Their progress and terminal state ride the
   * thread-scoped `item/<kind>/progress|completed` events, and turn
   * settlement never clears or completes them.
   */
  function isThreadAttachedShape(shape: DeltaItemShape): boolean {
    switch (shape.type) {
      case "backgroundTask":
        return true;
      case "delegation":
        return shape.background;
      case "command":
      case "fileChange":
      case "tool":
      case "compaction":
      case "agentMessage":
      case "reasoning":
      case "plan":
      case "webSearch":
      case "webFetch":
      case "imageView":
      case "fileRead":
      case "search":
      case "planSteps":
      case "extension":
        return false;
    }
  }

  /**
   * The opened (pending) canonical item for a shape. `presentation` is the
   * lifecycle delta's (grammar v3): persisted on every kind that carries one,
   * required for `extension`, absent on v2 traffic.
   */
  function buildOpenedItem(
    bbItemId: string,
    shape: DeltaItemShape,
    parentToolCallId: string | undefined,
    presentation: ThreadEventItemPresentation | undefined,
  ): ThreadEventItem {
    return withPresentation(
      buildOpenedItemShape(bbItemId, shape, parentToolCallId, presentation),
      presentation,
    );
  }

  function buildOpenedItemShape(
    bbItemId: string,
    shape: DeltaItemShape,
    parentToolCallId: string | undefined,
    presentation: ThreadEventItemPresentation | undefined,
  ): ThreadEventItem {
    switch (shape.type) {
      case "command":
        return withParentToolCallId(
          {
            type: "commandExecution",
            id: bbItemId,
            command: shape.command,
            cwd: shape.cwd,
            ...(shape.aggregatedOutput === undefined
              ? {}
              : { aggregatedOutput: shape.aggregatedOutput }),
            ...(shape.exitCode === undefined
              ? {}
              : { exitCode: shape.exitCode }),
            ...(shape.durationMs === undefined
              ? {}
              : { durationMs: shape.durationMs }),
            status: "pending",
            approvalStatus: null,
          },
          parentToolCallId,
        );
      case "fileChange":
        return withParentToolCallId(
          {
            type: "fileChange",
            id: bbItemId,
            changes: buildFileChanges(shape),
            status: "pending",
            approvalStatus: null,
          },
          parentToolCallId,
        );
      case "tool": {
        const toolArguments = toOptionalRecord(shape.args);
        return withParentToolCallId(
          {
            type: "toolCall",
            id: bbItemId,
            ...(shape.server === undefined ? {} : { server: shape.server }),
            tool: shape.tool,
            ...(toolArguments ? { arguments: toolArguments } : {}),
            status: "pending",
            ...(shape.result === undefined ? {} : { result: shape.result }),
            ...(shape.error === undefined ? {} : { error: shape.error }),
            ...(shape.durationMs === undefined
              ? {}
              : { durationMs: shape.durationMs }),
          },
          parentToolCallId,
        );
      }
      case "compaction":
        return withParentToolCallId(
          { type: "contextCompaction", id: bbItemId },
          parentToolCallId,
        );
      case "agentMessage":
        return withParentToolCallId(
          { type: "agentMessage", id: bbItemId, text: shape.text },
          parentToolCallId,
        );
      case "reasoning":
        return withParentToolCallId(
          {
            type: "reasoning",
            id: bbItemId,
            summary: shape.summary,
            content: shape.content,
          },
          parentToolCallId,
        );
      case "plan":
        return withParentToolCallId(
          { type: "plan", id: bbItemId, text: shape.text },
          parentToolCallId,
        );
      case "webSearch":
        return withParentToolCallId(
          {
            type: "webSearch",
            id: bbItemId,
            queries: shape.queries,
            resultText: null,
          },
          parentToolCallId,
        );
      case "webFetch":
        return withParentToolCallId(
          {
            type: "webFetch",
            id: bbItemId,
            url: shape.url,
            prompt: shape.prompt ?? null,
            pattern: shape.pattern,
            resultText: null,
          },
          parentToolCallId,
        );
      case "imageView":
        return withParentToolCallId(
          { type: "imageView", id: bbItemId, path: shape.path },
          parentToolCallId,
        );
      case "backgroundTask":
        return buildBackgroundTaskItem(bbItemId, shape, parentToolCallId);
      case "fileRead":
        return buildFileReadItem(bbItemId, shape, "pending", parentToolCallId);
      case "search":
        return buildSearchItem(bbItemId, shape, "pending", parentToolCallId);
      case "delegation":
        return buildDelegationItem(
          bbItemId,
          shape,
          "pending",
          parentToolCallId,
        );
      case "planSteps":
        return buildPlanStepsItem(bbItemId, shape, "pending", parentToolCallId);
      case "extension":
        return buildExtensionItem(
          bbItemId,
          shape,
          "pending",
          parentToolCallId,
          presentation,
        );
    }
  }

  interface CloseFields {
    aggregatedOutput?: string;
    exitCode?: number;
    resultText?: string;
    approvalStatus?: "denied";
    status: ThreadEventItemStatus;
    /** The opened delegation's last known summary (close-echo fallback). */
    delegationSummary?: string;
  }

  /** Close-echo: started-item fields survive onto the completed item. */
  function completeStartedItem(
    started: ThreadEventItem,
    close: CloseFields,
    parentToolCallId: string | undefined,
  ): ThreadEventItem {
    const parent = parentToolCallId ?? started.parentToolCallId;
    switch (started.type) {
      case "commandExecution":
        return withParentToolCallId(
          {
            type: "commandExecution",
            id: started.id,
            command: started.command,
            cwd: started.cwd,
            ...(close.aggregatedOutput === undefined
              ? {}
              : { aggregatedOutput: close.aggregatedOutput }),
            ...(close.exitCode === undefined
              ? {}
              : { exitCode: close.exitCode }),
            status: close.status,
            approvalStatus: started.approvalStatus,
          },
          parent,
        );
      case "fileChange":
        return withParentToolCallId(
          {
            type: "fileChange",
            id: started.id,
            changes: started.changes,
            status: close.status,
            approvalStatus: started.approvalStatus,
          },
          parent,
        );
      case "toolCall":
        return withParentToolCallId(
          {
            type: "toolCall",
            id: started.id,
            tool: started.tool,
            ...(started.arguments === undefined
              ? {}
              : { arguments: started.arguments }),
            status: close.status,
            ...(close.resultText === undefined
              ? {}
              : { result: close.resultText }),
          },
          parent,
        );
      case "contextCompaction":
        return withParentToolCallId(
          { type: "contextCompaction", id: started.id },
          parent,
        );
      case "fileRead":
        return buildFileReadItem(started.id, started, close.status, parent);
      case "search":
        return buildSearchItem(started.id, started, close.status, parent);
      case "delegation":
        return buildDelegationItem(started.id, started, close.status, parent);
      case "planSteps":
        return buildPlanStepsItem(started.id, started, close.status, parent);
      case "extension":
        return buildExtensionItem(
          started.id,
          started,
          close.status,
          parent,
          started.presentation,
        );
      default:
        // Message-ish started items never travel item.close; settle generically.
        return started;
    }
  }

  /**
   * Build the completed item from the close delta's terminal shape.
   * `presentation` is the close-echo result (the close's own, else the opened
   * item's); required for `extension`.
   */
  function buildClosedItemFromShape(
    bbItemId: string,
    shape: DeltaItemShape,
    close: CloseFields,
    parentToolCallId: string | undefined,
    presentation: ThreadEventItemPresentation | undefined,
  ): ThreadEventItem {
    return withPresentation(
      buildClosedItemShape(
        bbItemId,
        shape,
        close,
        parentToolCallId,
        presentation,
      ),
      presentation,
    );
  }

  function buildClosedItemShape(
    bbItemId: string,
    shape: DeltaItemShape,
    close: CloseFields,
    parentToolCallId: string | undefined,
    presentation: ThreadEventItemPresentation | undefined,
  ): ThreadEventItem {
    switch (shape.type) {
      case "command": {
        // Generic close fields win over the shape's own output fields.
        const aggregatedOutput =
          close.aggregatedOutput ?? shape.aggregatedOutput;
        const exitCode = close.exitCode ?? shape.exitCode;
        return withParentToolCallId(
          {
            type: "commandExecution",
            id: bbItemId,
            command: shape.command,
            cwd: shape.cwd,
            ...(aggregatedOutput === undefined ? {} : { aggregatedOutput }),
            ...(exitCode === undefined ? {} : { exitCode }),
            ...(shape.durationMs === undefined
              ? {}
              : { durationMs: shape.durationMs }),
            status: close.status,
            approvalStatus: close.approvalStatus ?? null,
          },
          parentToolCallId,
        );
      }
      case "fileChange":
        return withParentToolCallId(
          {
            type: "fileChange",
            id: bbItemId,
            changes: buildFileChanges(shape),
            status: close.status,
            approvalStatus: close.approvalStatus ?? null,
          },
          parentToolCallId,
        );
      case "tool": {
        const toolArguments = toOptionalRecord(shape.args);
        const result = shape.result ?? close.resultText;
        return withParentToolCallId(
          {
            type: "toolCall",
            id: bbItemId,
            ...(shape.server === undefined ? {} : { server: shape.server }),
            tool: shape.tool,
            ...(toolArguments ? { arguments: toolArguments } : {}),
            status: close.status,
            ...(result === undefined ? {} : { result }),
            ...(shape.error === undefined ? {} : { error: shape.error }),
            ...(shape.durationMs === undefined
              ? {}
              : { durationMs: shape.durationMs }),
          },
          parentToolCallId,
        );
      }
      case "compaction":
        return withParentToolCallId(
          { type: "contextCompaction", id: bbItemId },
          parentToolCallId,
        );
      case "webSearch":
        return withParentToolCallId(
          {
            type: "webSearch",
            id: bbItemId,
            queries: shape.queries,
            resultText: close.resultText ?? null,
          },
          parentToolCallId,
        );
      case "webFetch":
        return withParentToolCallId(
          {
            type: "webFetch",
            id: bbItemId,
            url: shape.url,
            prompt: shape.prompt ?? null,
            pattern: shape.pattern,
            resultText: close.resultText ?? null,
          },
          parentToolCallId,
        );
      case "backgroundTask":
        return buildBackgroundTaskItem(bbItemId, shape, parentToolCallId);
      case "fileRead":
        return buildFileReadItem(
          bbItemId,
          shape,
          close.status,
          parentToolCallId,
        );
      case "search":
        return buildSearchItem(bbItemId, shape, close.status, parentToolCallId);
      case "delegation":
        return buildDelegationItem(
          bbItemId,
          shape,
          close.status,
          parentToolCallId,
          close.delegationSummary,
        );
      case "planSteps":
        return buildPlanStepsItem(
          bbItemId,
          shape,
          close.status,
          parentToolCallId,
        );
      case "extension":
        return buildExtensionItem(
          bbItemId,
          shape,
          close.status,
          parentToolCallId,
          presentation,
        );
      case "agentMessage":
      case "reasoning":
      case "plan":
      case "imageView":
        // Status-less canonical items: the terminal shape is the whole item.
        return buildOpenedItemShape(
          bbItemId,
          shape,
          parentToolCallId,
          presentation,
        );
    }
  }

  // -------------------------------------------------------------------------
  // Delta handlers
  // -------------------------------------------------------------------------

  /**
   * A turn-scoped delta arrived with no turn to attach to: surface the
   * bridge's raw payload exactly as the old translators' "no active turn"
   * guards did — a thread-scoped provider/unhandled — or drop it silently
   * when the bridge attached no fallback.
   */
  function pushNoTurnFallback(
    state: ThreadAssemblyState,
    fallback: DeltaNoTurnFallback | undefined,
    parentRef: string | undefined,
    events: EventSink,
  ): void {
    if (fallback === undefined) {
      return;
    }
    const parentToolCallId = mapParentRef(state, parentRef);
    events.push({
      type: "provider/unhandled",
      threadId: UNSTAMPED_THREAD_ID,
      providerThreadId: "",
      providerId: options.providerId,
      rawType: fallback.rawType,
      rawEvent: fallback.raw,
      scope: threadScope(),
      ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
    });
  }

  /**
   * A tool call ends the assistant text in its scope: anonymous (channel-
   * keyed) agentMessage items under the same parentRef are released so later
   * text mints a fresh item instead of appending to pre-tool content. Items
   * the provider named by id (codex) keep their own lifecycle — the provider
   * closes them itself.
   */
  function detachAssistantStreams(
    state: ThreadAssemblyState,
    parentRef: string | undefined,
  ): void {
    for (const [keyStr, open] of [...state.openItemsByKey]) {
      if (
        open.key.providerItemId === undefined &&
        open.item.type === "agentMessage" &&
        open.key.parentRef === parentRef
      ) {
        state.openItemsByKey.delete(keyStr);
      }
    }
  }

  /**
   * The settled form of a streamed text item from what the stream carried:
   * the accumulated text (or a provider-final one) on the item's text field,
   * a reasoning item's summary and content each from their own channel.
   */
  function settleTextItem(
    open: OpenItemState,
    finalText: string | undefined,
    channel: DeltaTextChannel | undefined,
  ): ThreadEventItem | undefined {
    const text =
      channel === "reasoningSummary" ? open.text : (finalText ?? open.text);
    const summaryText =
      channel === "reasoningSummary"
        ? (finalText ?? open.summaryText)
        : open.summaryText;
    switch (open.item.type) {
      case "agentMessage":
        return withPresentation(
          withParentToolCallId(
            { type: "agentMessage", id: open.bbItemId, text },
            open.item.parentToolCallId,
          ),
          open.item.presentation,
        );
      case "plan":
        return withPresentation(
          withParentToolCallId(
            { type: "plan", id: open.bbItemId, text },
            open.item.parentToolCallId,
          ),
          open.item.presentation,
        );
      case "reasoning":
        return withPresentation(
          withParentToolCallId(
            {
              type: "reasoning",
              id: open.bbItemId,
              summary: summaryText.length === 0 ? [] : [summaryText],
              content: text.length === 0 ? [] : [text],
            },
            open.item.parentToolCallId,
          ),
          open.item.presentation,
        );
      default:
        return undefined;
    }
  }

  /** The empty text item a bare `item.textClose` mints for its channel. */
  function buildTextItemForChannel(
    bbItemId: string,
    channel: DeltaTextChannel,
    text: string,
    parentToolCallId: string | undefined,
  ): ThreadEventItem {
    switch (channel) {
      case "agentMessage":
        return withParentToolCallId(
          { type: "agentMessage", id: bbItemId, text },
          parentToolCallId,
        );
      case "plan":
        return withParentToolCallId(
          { type: "plan", id: bbItemId, text },
          parentToolCallId,
        );
      case "reasoningText":
        return withParentToolCallId(
          { type: "reasoning", id: bbItemId, summary: [], content: [text] },
          parentToolCallId,
        );
      case "reasoningSummary":
        return withParentToolCallId(
          { type: "reasoning", id: bbItemId, summary: [text], content: [] },
          parentToolCallId,
        );
    }
  }

  function handleDelta(
    state: ThreadAssemblyState,
    delta: ThreadDelta,
    events: EventSink,
  ): void {
    switch (delta.kind) {
      case "input.accepted": {
        if (delta.providerTurnId !== undefined) {
          // Vouched acceptance: the provider named the turn that consumed the
          // input (codex FIFO drain, steer against the active native turn).
          events.push({
            type: "turn/input/accepted",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(resolveVouchedTurnId(state, delta.providerTurnId)),
            clientRequestId: delta.clientRequestId,
          });
          return;
        }
        if (state.currentTurnId !== undefined) {
          events.push({
            type: "turn/input/accepted",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(state.currentTurnId),
            clientRequestId: delta.clientRequestId,
          });
          return;
        }
        state.pendingAccepted.push(delta.clientRequestId);
        return;
      }

      case "turn.open": {
        if (delta.providerTurnId !== undefined) {
          // Keyed turn space: several provider turns may be open at once
          // (codex multiplexes child turns); the current-turn machinery and
          // the accepted-input queue are never touched.
          const parentToolCallId = mapParentRef(state, delta.parentRef);
          events.push({
            type: "turn/started",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(resolveVouchedTurnId(state, delta.providerTurnId)),
            ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
          });
          return;
        }
        ensureTurnOpen(state, events);
        return;
      }

      case "turn.boundary": {
        if (delta.providerTurnId !== undefined) {
          // A keyed boundary always emits — the provider named the turn —
          // and settles only that turn; open items and streams belong to
          // their own provider ids, not to the closing turn.
          events.push({
            type: "turn/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(resolveVouchedTurnId(state, delta.providerTurnId)),
            status: delta.status,
            ...(delta.error === undefined ? {} : { error: delta.error }),
            ...(delta.providerCheckpointId === undefined
              ? {}
              : { providerCheckpointId: delta.providerCheckpointId }),
          });
          return;
        }
        const turnId =
          state.currentTurnId ??
          (delta.claimIfIdle === true && state.pendingAccepted.length > 0
            ? ensureTurnOpen(state, events)
            : undefined);
        if (turnId === undefined) {
          return;
        }
        events.push({
          type: "turn/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          status: delta.status,
          ...(delta.error === undefined ? {} : { error: delta.error }),
          ...(delta.providerCheckpointId === undefined
            ? {}
            : { providerCheckpointId: delta.providerCheckpointId }),
        });
        finishTurn(state);
        return;
      }

      case "item.open": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : delta.attach === "currentOrLast"
              ? currentOrLastTurnId(state)
              : state.currentTurnId;
        if (turnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        const keyStr = itemKeyString(delta.key);
        // An explicit open reopens a settled provider id (codex's
        // settle/reopen rule) …
        state.settledItemKeys.delete(keyStr);
        if (delta.item.type !== "compaction") {
          // A tool call ends the current assistant stream: later text must
          // mint a fresh item instead of appending to pre-tool content.
          detachAssistantStreams(state, delta.key.parentRef);
        }
        // … and a known provider id keeps its minted bb id, so the reopened
        // incarnation updates the same timeline item.
        const bbItemId =
          (delta.key.providerItemId !== undefined
            ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
            : undefined) ?? mintItemId();
        if (delta.key.providerItemId !== undefined) {
          registerItemId(state, delta.key.providerItemId, bbItemId);
        }
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        const item = buildOpenedItem(
          bbItemId,
          delta.item,
          parentToolCallId,
          delta.presentation,
        );
        state.openItemsByKey.set(keyStr, {
          bbItemId,
          key: delta.key,
          item,
          threadAttached: isThreadAttachedShape(delta.item),
          text: "",
          summaryText: "",
        });
        // The open seeds the progress throttle window: a provider's first
        // progress right after the open is already inside the interval.
        rememberProgressEmit(state, keyStr);
        events.push({
          type: "item/started",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          item,
        });
        return;
      }

      case "item.close": {
        // A background-task or background-delegation close is structurally
        // thread-scoped (item/backgroundTask/completed,
        // item/delegation/completed) and needs no open turn — terminal state
        // can arrive turns after the spawning turn settled.
        const threadScoped = isThreadAttachedShape(delta.item);
        const turnId = threadScoped
          ? undefined
          : delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : state.currentTurnId;
        if (!threadScoped && turnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        const keyStr = itemKeyString(delta.key);
        // Settle/reopen dedup for provider-identified items: a repeated close
        // for a settled id is a provider retry of the same lifecycle edge.
        // Channel-keyed families (acp fs-writes, compactions) are exempt —
        // they legitimately close the same key repeatedly.
        if (
          delta.key.providerItemId !== undefined &&
          state.settledItemKeys.has(keyStr)
        ) {
          return;
        }
        const open = state.openItemsByKey.get(keyStr);
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        const openDelegationSummary =
          open?.item.type === "delegation" ? open.item.summary : undefined;
        const closeFields: CloseFields = {
          status: delta.status,
          ...(delta.resultText === undefined
            ? {}
            : { resultText: delta.resultText }),
          ...(delta.exitCode === undefined ? {} : { exitCode: delta.exitCode }),
          ...(delta.aggregatedOutput === undefined
            ? {}
            : { aggregatedOutput: delta.aggregatedOutput }),
          ...(delta.approvalStatus === undefined
            ? {}
            : { approvalStatus: delta.approvalStatus }),
          ...(openDelegationSummary === undefined
            ? {}
            : { delegationSummary: openDelegationSummary }),
        };
        // Uniform close rule: the delta's `item` is ALWAYS the full terminal
        // shape and the completed item is built from it. An open item under
        // the key contributes its minted id (and its parent as fallback);
        // when the open item is differently shaped it is settled first and
        // the terminal shape follows (ACP's dual-complete, both under one id).
        if (
          open !== undefined &&
          turnId !== undefined &&
          !shapeMatchesItem(delta.item, open.item)
        ) {
          events.push({
            type: "item/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            item: withPresentation(
              completeStartedItem(open.item, closeFields, parentToolCallId),
              presentationOf(open.item),
            ),
          });
        }
        const bbItemId =
          open?.bbItemId ??
          (delta.key.providerItemId !== undefined
            ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
            : undefined) ??
          mintItemId();
        if (delta.key.providerItemId !== undefined) {
          registerItemId(state, delta.key.providerItemId, bbItemId);
        }
        // Close-echo for presentation: the close's value wins; when the close
        // carries none the opened item's survives onto the completed item.
        const presentation = delta.presentation ?? presentationOf(open?.item);
        const item = buildClosedItemFromShape(
          bbItemId,
          delta.item,
          closeFields,
          parentToolCallId ?? open?.item.parentToolCallId,
          presentation,
        );
        state.openItemsByKey.delete(keyStr);
        state.commandSnapshotsByKey.delete(keyStr);
        // The close supersedes any suppressed progress: the terminal event
        // always carries the final state.
        state.pendingProgressByKey.delete(keyStr);
        state.progressLastEmitByKey.delete(keyStr);
        if (delta.key.providerItemId !== undefined) {
          rememberSettledKey(state, keyStr);
        }
        // Thread-attached work settles on its own thread-scoped terminal
        // event; `item` is already the full terminal item for it.
        if (item.type === "backgroundTask") {
          events.push({
            type: "item/backgroundTask/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: threadScope(),
            item,
          });
          return;
        }
        if (item.type === "delegation" && item.background) {
          events.push({
            type: "item/delegation/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: threadScope(),
            item,
          });
          return;
        }
        if (turnId !== undefined) {
          events.push({
            type: "item/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            item,
          });
        }
        return;
      }

      case "item.progress": {
        const keyStr = itemKeyString(delta.key);
        const open = state.openItemsByKey.get(keyStr);
        const bbItemId =
          open?.bbItemId ??
          (delta.key.providerItemId !== undefined
            ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
            : undefined) ??
          delta.key.providerItemId ??
          mintItemId();
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        let event: ThreadEvent;
        if (delta.snapshot?.type === "delegation") {
          // A background-delegation snapshot is structurally thread-scoped
          // (item/delegation/progress) like a background task's; the child
          // is still running, so the item stays pending and keeps the last
          // summary the provider reported.
          event = {
            type: "item/delegation/progress",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: threadScope(),
            item: withPresentation(
              buildDelegationItem(
                bbItemId,
                delta.snapshot,
                "pending",
                parentToolCallId ?? open?.item.parentToolCallId,
                open?.item.type === "delegation"
                  ? open.item.summary
                  : undefined,
              ),
              presentationOf(open?.item),
            ),
          };
        } else if (delta.snapshot !== undefined) {
          // Background-task snapshot progress is structurally thread-scoped by
          // the domain grammar; it needs no open turn.
          event = {
            type: "item/backgroundTask/progress",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: threadScope(),
            item: buildBackgroundTaskItem(
              bbItemId,
              delta.snapshot,
              parentToolCallId,
            ),
          };
        } else {
          const turnId =
            delta.providerTurnId !== undefined
              ? resolveVouchedTurnId(state, delta.providerTurnId)
              : state.currentTurnId;
          if (turnId === undefined) {
            pushNoTurnFallback(
              state,
              delta.noTurnFallback,
              delta.key.parentRef,
              events,
            );
            return;
          }
          event = {
            type: "item/toolCall/progress",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            itemId: bbItemId,
            ...(delta.message === undefined ? {} : { message: delta.message }),
            ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
          };
        }
        // Central throttle: one emission per key per interval; flush bypasses;
        // a suppressed emission becomes the key's pending trailing-edge event
        // (the newest snapshot wins, so replacing pending loses nothing).
        const lastEmit = state.progressLastEmitByKey.get(keyStr);
        if (
          delta.flush !== true &&
          lastEmit !== undefined &&
          now() - lastEmit < progressThrottleMs
        ) {
          state.pendingProgressByKey.set(keyStr, {
            event,
            turnScoped: delta.snapshot === undefined,
          });
          return;
        }
        state.pendingProgressByKey.delete(keyStr);
        rememberProgressEmit(state, keyStr);
        events.push(event);
        return;
      }

      case "item.textDelta": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : state.currentTurnId;
        if (turnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        const keyStr = itemKeyString(delta.key);
        const open = state.openItemsByKey.get(keyStr);
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        let bbItemId =
          open?.bbItemId ??
          (delta.key.providerItemId !== undefined
            ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
            : undefined);
        if (bbItemId === undefined) {
          // Delta-first open: synthesize the channel's empty item/started —
          // every item's first event must be item/started.
          bbItemId = mintItemId();
          if (delta.key.providerItemId !== undefined) {
            registerItemId(state, delta.key.providerItemId, bbItemId);
          }
          const shape: DeltaItemShape =
            delta.channel === "agentMessage"
              ? { type: "agentMessage", text: "" }
              : delta.channel === "plan"
                ? { type: "plan", text: "" }
                : { type: "reasoning", summary: [], content: [] };
          const item = buildOpenedItem(
            bbItemId,
            shape,
            parentToolCallId,
            undefined,
          );
          state.openItemsByKey.set(keyStr, {
            bbItemId,
            key: delta.key,
            item,
            threadAttached: false,
            text: "",
            summaryText: "",
          });
          events.push({
            type: "item/started",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            item,
          });
        }
        const openText = state.openItemsByKey.get(keyStr);
        if (openText !== undefined) {
          if (delta.channel === "reasoningSummary") {
            openText.summaryText += delta.text;
          } else {
            openText.text += delta.text;
          }
        }
        const type =
          delta.channel === "agentMessage"
            ? ("item/agentMessage/delta" as const)
            : delta.channel === "reasoningSummary"
              ? ("item/reasoning/summaryTextDelta" as const)
              : delta.channel === "reasoningText"
                ? ("item/reasoning/textDelta" as const)
                : ("item/plan/delta" as const);
        events.push({
          type,
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          itemId: bbItemId,
          delta: delta.text,
          ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
        });
        return;
      }

      case "item.textClose": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : state.currentTurnId;
        if (turnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        const keyStr = itemKeyString(delta.key);
        if (
          delta.key.providerItemId !== undefined &&
          state.settledItemKeys.has(keyStr)
        ) {
          // A repeated close for a settled provider id is a retry (the
          // item.close dedup rule, held for text closes too).
          return;
        }
        const open = state.openItemsByKey.get(keyStr);
        // Settling always releases the key: later text mints a fresh item
        // even when the settle emits nothing (whitespace-only accumulation).
        state.openItemsByKey.delete(keyStr);
        const accumulated =
          open === undefined
            ? undefined
            : delta.channel === "reasoningSummary"
              ? open.summaryText
              : open.text;
        const finalText = delta.text ?? accumulated;
        if (finalText === undefined || finalText.length === 0) {
          return;
        }
        // Empty-after-trim suppression for accumulated settles (the ACP
        // translators' rule, held centrally): a stream that only ever
        // received whitespace completes no item. Provider-final text is
        // emitted as given.
        if (delta.text === undefined && finalText.trim().length === 0) {
          return;
        }
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        let item: ThreadEventItem | undefined =
          open === undefined
            ? undefined
            : settleTextItem(open, delta.text, delta.channel);
        let bbItemId = open?.bbItemId;
        if (item === undefined) {
          bbItemId =
            bbItemId ??
            (delta.key.providerItemId !== undefined
              ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
              : undefined) ??
            mintItemId();
          item = buildTextItemForChannel(
            bbItemId,
            delta.channel,
            finalText,
            parentToolCallId ?? open?.item.parentToolCallId,
          );
        }
        if (delta.key.providerItemId !== undefined && bbItemId !== undefined) {
          registerItemId(state, delta.key.providerItemId, bbItemId);
          rememberSettledKey(state, keyStr);
        }
        events.push({
          type: "item/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          item,
        });
        return;
      }

      case "item.outputDelta": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : state.currentTurnId;
        if (turnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        // NEVER synthesize an open here: fabricating a commandExecution
        // without its command would be worse than the anomaly. The id is
        // still minted and mapped so a later open/close correlates.
        const open = state.openItemsByKey.get(itemKeyString(delta.key));
        let bbItemId =
          open?.bbItemId ??
          (delta.key.providerItemId !== undefined
            ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
            : undefined);
        if (bbItemId === undefined) {
          bbItemId = mintItemId();
          if (delta.key.providerItemId !== undefined) {
            registerItemId(state, delta.key.providerItemId, bbItemId);
          }
        }
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        events.push({
          type:
            delta.channel === "command"
              ? "item/commandExecution/outputDelta"
              : "item/fileChange/outputDelta",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          itemId: bbItemId,
          delta: delta.text,
          ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
        });
        return;
      }

      case "command.outputSnapshot": {
        if (state.currentTurnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        const keyStr = itemKeyString(delta.key);
        const open = state.openItemsByKey.get(keyStr);
        if (open === undefined) {
          return;
        }
        const diffed = diffCumulativeText({
          previousText: state.commandSnapshotsByKey.get(keyStr),
          nextText: delta.text,
        });
        if (diffed === null) {
          return;
        }
        state.commandSnapshotsByKey.set(keyStr, diffed.nextText);
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        events.push({
          type: "item/commandExecution/outputDelta",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(state.currentTurnId),
          itemId: open.bbItemId,
          delta: diffed.delta,
          ...(diffed.reset ? { reset: true } : {}),
          ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
        });
        return;
      }

      case "usage": {
        // The provider (or its bridge) owns the totals: forward verbatim to
        // the vouched turn, else the turn that is open or just closed.
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : currentOrLastTurnId(state);
        if (turnId === undefined) {
          return;
        }
        events.push({
          type: "thread/tokenUsage/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          tokenUsage: {
            total: { ...delta.total },
            last: { ...delta.last },
            modelContextWindow: delta.modelContextWindow,
          },
        });
        return;
      }

      case "contextWindow": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : delta.attach === "open"
              ? state.currentTurnId
              : currentOrLastTurnId(state);
        events.push({
          type: "thread/contextWindowUsage/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnId === undefined ? threadScope() : turnScope(turnId),
          contextWindowUsage: {
            usedTokens: delta.used,
            modelContextWindow: delta.size ?? null,
            estimated: delta.estimated,
          },
        });
        return;
      }

      case "context.compacted": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : currentOrLastTurnId(state);
        if (turnId === undefined) {
          pushNoTurnFallback(state, delta.noTurnFallback, undefined, events);
          return;
        }
        events.push({
          type: "thread/compacted",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
        });
        return;
      }

      case "context.cleared": {
        const turnId = currentOrLastTurnId(state);
        if (turnId === undefined) {
          return;
        }
        events.push({
          type: "thread/context/cleared",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
        });
        return;
      }

      case "provider.error": {
        // An error owns a turn when the provider vouched one, or when one is
        // open / accepted input proves pending work (the terminal-turn rule);
        // otherwise it stays a thread-scoped diagnostic and settles nothing.
        // `threadScoped` pins thread scope: a provider that names its turns
        // must not have a turnless error adopted by whatever turn is open.
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : delta.threadScoped === true
              ? undefined
              : (state.currentTurnId ??
                (state.pendingAccepted.length > 0
                  ? ensureTurnOpen(state, events)
                  : undefined));
        events.push({
          type: "provider/error",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnId === undefined ? threadScope() : turnScope(turnId),
          message: delta.message,
          ...(delta.detail === undefined ? {} : { detail: delta.detail }),
          ...(delta.willRetry === undefined
            ? {}
            : { willRetry: delta.willRetry }),
          ...(delta.errorInfo === undefined
            ? {}
            : { errorInfo: delta.errorInfo }),
        });
        if (delta.settlesTurn === true && turnId !== undefined) {
          events.push({
            type: "turn/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            status: "failed",
          });
          finishTurn(state);
        }
        return;
      }

      case "provider.modelFallback": {
        // The claude translator's currentOrLast rule: the fallback belongs to
        // the turn that is open or just closed; thread scope otherwise.
        const turnId = currentOrLastTurnId(state);
        events.push({
          type: "provider/modelFallback",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnId === undefined ? threadScope() : turnScope(turnId),
          originalModel: delta.originalModel,
          fallbackModel: delta.fallbackModel,
          reason: delta.reason,
          message: delta.message,
        });
        return;
      }

      case "provider.warning": {
        const turnId =
          delta.vouchedTurn === true ? state.currentTurnId : undefined;
        events.push({
          type: "provider/warning",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnId === undefined ? threadScope() : turnScope(turnId),
          category: delta.category ?? "general",
          ...(delta.summary === undefined ? {} : { summary: delta.summary }),
          ...(delta.details === undefined ? {} : { details: delta.details }),
        });
        return;
      }

      case "unhandled": {
        if (delta.onlyIfNoTurn === true && state.currentTurnId !== undefined) {
          return;
        }
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : delta.vouchedTurn === true
              ? state.currentTurnId
              : undefined;
        const parentToolCallId = mapParentRef(state, delta.parentRef);
        events.push({
          type: "provider/unhandled",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          providerId: options.providerId,
          rawType: delta.rawType,
          rawEvent: delta.raw,
          scope: turnId === undefined ? threadScope() : turnScope(turnId),
          ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
        });
        return;
      }

      case "turn.diff": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : state.currentTurnId;
        if (turnId === undefined) {
          return;
        }
        events.push({
          type: "turn/diff/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          diff: delta.diff,
        });
        return;
      }

      case "thread.started": {
        events.push({
          type: "thread/started",
          threadId: UNSTAMPED_THREAD_ID,
          scope: threadScope(),
        });
        return;
      }

      case "thread.identity": {
        events.push({
          type: "thread/identity",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: delta.providerThreadId,
          scope: threadScope(),
        });
        return;
      }

      case "thread.name": {
        events.push({
          type: "thread/name/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: threadScope(),
          threadName: delta.name,
        });
        return;
      }

      case "provider.rateLimits": {
        events.push({
          type: "provider/rateLimits/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: threadScope(),
          rateLimits: delta.rateLimits,
        });
        return;
      }

      case "extension.state": {
        // Plugin-declared thread state: thread-scoped like goals and rate
        // limits, latest snapshot per kind wins downstream. The payload is
        // opaque here; the server validates it against the plugin's declared
        // `state` schema at ingest.
        events.push({
          type: "thread/extensionState/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: threadScope(),
          kind: delta.extensionKind,
          payload: delta.payload,
        });
        return;
      }

      case "session.reset": {
        // Handled in assemble() — the reset drops the whole thread state.
        return;
      }

      case "session.ended": {
        const turnId =
          state.currentTurnId ??
          (state.pendingAccepted.length > 0
            ? ensureTurnOpen(state, events)
            : undefined);
        if (turnId === undefined) {
          return;
        }
        for (const open of state.openItemsByKey.values()) {
          // Thread-attached items (background tasks, background delegations)
          // have a provider-owned lifecycle that outlives sessions; bridges
          // drain them with explicit item.close deltas when the backing
          // session dies.
          if (open.threadAttached) {
            continue;
          }
          // A text item that streamed settles with what it received so far;
          // one that never streamed keeps its opened shape, and status-bearing
          // items settle as interrupted.
          const streamed = open.text.length > 0 || open.summaryText.length > 0;
          const item =
            (streamed
              ? settleTextItem(open, undefined, undefined)
              : undefined) ??
            completeStartedItem(
              open.item,
              { status: "interrupted" },
              undefined,
            );
          events.push({
            type: "item/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            item,
          });
        }
        events.push({
          type: "turn/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          status: "interrupted",
        });
        finishTurn(state);
        return;
      }
    }
  }

  return {
    assemble(args: AssembleDeltasArgs): ThreadEvent[] {
      const events: ThreadEvent[] = [];
      // The coalescing sink every handler emits through: a streamed-text
      // event may buffer per stream; anything else flushes the thread's text
      // buffers first — the ordering barrier that keeps coalescing from ever
      // reordering text relative to item opens/closes, turn events, errors,
      // or other streams' flushes. Flushing never creates thread state.
      const sink: EventSink = {
        push: (...newEvents: ThreadEvent[]): void => {
          for (const event of newEvents) {
            const textDelta =
              textDeltaFlushMs > 0 ? asTextDeltaEvent(event) : undefined;
            const state = states.get(args.threadId);
            if (textDelta !== undefined && state !== undefined) {
              bufferTextDelta(state, textDelta, events);
              continue;
            }
            if (state !== undefined) {
              flushPendingText(state, events);
            }
            events.push(event);
          }
        },
      };
      // Trailing-edge flushes: coalesced text and suppressed progress
      // snapshots whose windows have elapsed land ahead of this batch
      // (existing state only — flushing must not create thread state). A
      // batch that OPENS with session.reset skips the progress flush:
      // everything suppressed belongs to the session being replaced, and the
      // reset is about to drop it (its text buffers still flush below —
      // their events were fully assembled against the old session's ids).
      const existing =
        args.deltas[0]?.kind === "session.reset"
          ? undefined
          : states.get(args.threadId);
      if (existing !== undefined) {
        flushElapsedPendingText(existing, events);
        const progressKeysInBatch = new Set<string>();
        for (const delta of args.deltas) {
          if (delta.kind === "item.progress") {
            progressKeysInBatch.add(itemKeyString(delta.key));
          }
        }
        flushElapsedPendingProgress(existing, sink, progressKeysInBatch);
      }
      for (const delta of args.deltas) {
        if (delta.kind === "session.reset") {
          // Provider-native id-space boundary: a fresh provider session may
          // reuse native turn/item ids, so the whole thread state (maps,
          // settled sets, open items and streams) starts over. Coalesced
          // text FLUSHES first (unlike suppressed progress, which the
          // terminal event supersedes, dropped text would be lost for good;
          // the buffered events carry the old session's still-valid ids).
          const state = states.get(args.threadId);
          if (state !== undefined) {
            flushPendingText(state, events);
          }
          states.delete(args.threadId);
          continue;
        }
        if (
          delta.kind === "item.textClose" ||
          delta.kind === "item.close" ||
          delta.kind === "session.ended"
        ) {
          // A settling stream (or session) flushes its coalesced text even
          // when the delta itself emits nothing (deduped provider retry,
          // session end on an idle thread).
          const state = states.get(args.threadId);
          if (state !== undefined) {
            flushPendingText(state, events);
          }
        }
        handleDelta(stateFor(args.threadId), delta, sink);
      }
      return events;
    },

    getBbItemId(threadId, providerItemId) {
      return states.get(threadId)?.bbItemIdByProviderItemId.get(providerItemId);
    },

    getProviderItemId(threadId, bbItemId) {
      return states.get(threadId)?.providerItemIdByBbItemId.get(bbItemId);
    },

    getBbTurnId(threadId, providerTurnId) {
      return states.get(threadId)?.bbTurnIdByProviderTurnId.get(providerTurnId);
    },

    getProviderTurnId(threadId, bbTurnId) {
      return states.get(threadId)?.providerTurnIdByBbTurnId.get(bbTurnId);
    },

    getOpenTurnId(threadId) {
      return states.get(threadId)?.currentTurnId;
    },
  };
}
