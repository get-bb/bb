/**
 * Middle truncation — the recovery path for a context-limit stop.
 *
 * ACP's `max_tokens` means the agent ran out of window, not that the work was
 * impossible. Failing the run there throws away everything already done. Instead the
 * runtime compacts the *middle* of the transcript — keeping the head (the task framing)
 * and the tail (the live working set), replacing the span between them with a summary —
 * and resumes the turn.
 *
 * Three invariants, each load-bearing and each tested:
 *
 *   1. **Head and tail are never dropped.** The head carries `sessionStarted` and the
 *      original instruction; without it the agent forgets the task. The tail is what it
 *      is currently working on.
 *   2. **Tool pairs never split.** Dropping a `toolCall` while keeping its `toolResult`
 *      (or the reverse) produces a transcript that describes an effect with no cause.
 *      Replay, the diff viewer and the trajectory's tool metrics all read those pairs.
 *   3. **Compaction is recorded, never silent.** Every compaction appends a
 *      `contextCompacted` event. A compacted trajectory is a different object from one
 *      that never hit the limit, and the learning plane must be able to tell them apart
 *      — the SkyRL recipe tracks exactly this as `summarization_count` ([S23]).
 *
 * What this is *not*: token-exact. We have no tokenizer for a vendor-hosted model, so
 * budgets are a deliberately conservative character heuristic. Under-compacting costs a
 * second attempt; over-compacting costs context. We accept the former.
 */

import type { AgentEvent, JournalLine } from "../events/events.ts";

/** Chars per token. Conservative: real English is ~4, code is denser. */
const CHARS_PER_TOKEN = 3.5;

export interface CompactionPolicy {
  /** Events at the head that are never dropped (task framing). */
  readonly keepHead: number;
  /** Events at the tail that are never dropped (live working set). */
  readonly keepTail: number;
  /**
   * Stop dropping once the estimated remaining window is at or below this many tokens.
   * Typically ~60% of the model's context so the next turn has room to work.
   */
  readonly targetTokens: number;
}

export const DEFAULT_POLICY: CompactionPolicy = {
  keepHead: 4,
  keepTail: 24,
  targetTokens: 60_000,
};

export interface CompactionResult {
  /** The surviving events, in order, with the summary spliced into the middle. */
  readonly events: readonly AgentEvent[];
  /** The `contextCompacted` event describing what happened. */
  readonly marker: Extract<AgentEvent, { type: "contextCompacted" }>;
  /** False when the policy could not free anything; the caller must not loop. */
  readonly compacted: boolean;
}

export class CompactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompactionError";
  }
}

/** Conservative token estimate for one event. */
export function estimateTokens(event: AgentEvent): number {
  return Math.ceil(JSON.stringify(event).length / CHARS_PER_TOKEN);
}

export function estimateTotalTokens(events: readonly AgentEvent[]): number {
  let total = 0;
  for (const event of events) total += estimateTokens(event);
  return total;
}

/**
 * Group indices that must be dropped or kept together.
 *
 * A `toolCall` and its matching `toolResult` form one unit. So do an `inputRequested`
 * and its `inputResolved`: a pending question with no answer would make replay wait
 * forever for input that already arrived.
 */
function pairPartner(events: readonly AgentEvent[]): Map<number, number> {
  const partner = new Map<number, number>();
  const openTool = new Map<string, number>();
  const openInput = new Map<string, number>();

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event === undefined) continue;
    switch (event.type) {
      case "toolCall":
        openTool.set(event.id, i);
        break;
      case "toolResult": {
        const start = openTool.get(event.id);
        if (start !== undefined) {
          partner.set(start, i);
          partner.set(i, start);
          openTool.delete(event.id);
        }
        break;
      }
      case "inputRequested":
        openInput.set(event.requestId, i);
        break;
      case "inputResolved": {
        const start = openInput.get(event.requestId);
        if (start !== undefined) {
          partner.set(start, i);
          partner.set(i, start);
          openInput.delete(event.requestId);
        }
        break;
      }
      default:
        break;
    }
  }
  return partner;
}

/** One-line description of an event, for the summary body. */
function describe(event: AgentEvent): string | null {
  switch (event.type) {
    case "toolCall": {
      const call = event.call;
      switch (call.kind) {
        case "exec":
          return `ran: ${call.command}`;
        case "readFile":
          return `read ${call.path}`;
        case "writeFile":
          return `wrote ${call.path}`;
        case "editFile":
          return `edited ${call.path}`;
        case "applyPatch":
          return `applied a patch${call.path === undefined ? "" : ` to ${call.path}`}`;
        case "search":
          return `searched for ${call.pattern}`;
        case "glob":
          return `globbed ${call.pattern}`;
        case "webFetch":
          return `fetched ${call.url}`;
        case "webSearch":
          return `web-searched ${call.query}`;
        case "todo":
          return `updated a ${call.items.length}-item todo list`;
        case "mcp":
          return `called ${call.server}/${call.tool}`;
        case "unknown":
          return `called ${call.name}`;
      }
      return null;
    }
    case "error":
      return `error: ${event.message}`;
    case "contextCompacted":
      return `[earlier context was already compacted: generation ${event.generation}]`;
    default:
      return null;
  }
}

/**
 * Build the summary text that replaces the dropped span.
 *
 * Deliberately mechanical rather than model-generated: this runs on the recovery path,
 * where calling a model is exactly the thing that just failed. A factual list of what
 * happened is more useful than a fluent paraphrase, and it cannot hallucinate.
 */
export function summarizeSpan(dropped: readonly AgentEvent[]): string {
  const actions: string[] = [];
  let textChars = 0;
  let errors = 0;

  for (const event of dropped) {
    const line = describe(event);
    if (line !== null) actions.push(line);
    if (event.type === "textDelta" || event.type === "reasoningDelta") {
      textChars += event.text.length;
    }
    if (event.type === "error") errors += 1;
  }

  const parts = [
    `[${dropped.length} earlier events were compacted out of the live context.]`,
  ];
  if (actions.length > 0) {
    const shown = actions.slice(0, 40);
    parts.push("Actions taken in that span:");
    for (const action of shown) parts.push(`  - ${action}`);
    if (actions.length > shown.length) {
      parts.push(`  - …and ${actions.length - shown.length} more`);
    }
  }
  if (textChars > 0) {
    parts.push(`Roughly ${textChars} characters of assistant output were dropped.`);
  }
  if (errors > 0) {
    parts.push(`${errors} error event(s) occurred in that span.`);
  }
  parts.push(
    "Re-read any file you need rather than relying on memory of its earlier contents.",
  );
  return parts.join("\n");
}

/**
 * Compact the middle of a transcript to fit `policy.targetTokens`.
 *
 * Drops from the oldest droppable event forward, extending each drop to cover its
 * paired partner, and stops as soon as the estimate is under budget. Returns
 * `compacted: false` when nothing could be freed — the caller must surface a real
 * failure rather than retrying forever.
 */
export function compactMiddle(
  events: readonly AgentEvent[],
  policy: CompactionPolicy = DEFAULT_POLICY,
  generation = 1,
): CompactionResult {
  if (policy.keepHead < 0 || policy.keepTail < 0) {
    throw new CompactionError("keepHead and keepTail must be non-negative");
  }
  if (policy.targetTokens <= 0) {
    throw new CompactionError("targetTokens must be positive");
  }

  const total = estimateTotalTokens(events);
  const noop = (): CompactionResult => ({
    events: [...events],
    marker: {
      type: "contextCompacted",
      droppedEvents: 0,
      droppedTokensEstimate: 0,
      summary: "",
      generation,
    },
    compacted: false,
  });

  if (total <= policy.targetTokens) return noop();

  const firstDroppable = policy.keepHead;
  const lastDroppable = events.length - policy.keepTail - 1;
  if (lastDroppable < firstDroppable) return noop();

  const partner = pairPartner(events);
  const drop = new Set<number>();
  let freed = 0;
  const needed = total - policy.targetTokens;

  for (let i = firstDroppable; i <= lastDroppable; i += 1) {
    if (freed >= needed) break;
    if (drop.has(i)) continue;

    const mate = partner.get(i);
    // A pair whose partner sits in the protected tail must stay whole, so skip it.
    if (mate !== undefined && (mate < firstDroppable || mate > lastDroppable)) continue;

    const event = events[i];
    if (event === undefined) continue;

    drop.add(i);
    freed += estimateTokens(event);

    if (mate !== undefined && !drop.has(mate)) {
      const mateEvent = events[mate];
      if (mateEvent !== undefined) {
        drop.add(mate);
        freed += estimateTokens(mateEvent);
      }
    }
  }

  if (drop.size === 0) return noop();

  const droppedEvents: AgentEvent[] = [];
  const kept: AgentEvent[] = [];
  let spliced = false;
  const marker: Extract<AgentEvent, { type: "contextCompacted" }> = {
    type: "contextCompacted",
    droppedEvents: drop.size,
    droppedTokensEstimate: freed,
    summary: "",
    generation,
  };

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event === undefined) continue;
    if (drop.has(i)) {
      droppedEvents.push(event);
      if (!spliced) {
        kept.push(marker);
        spliced = true;
      }
      continue;
    }
    kept.push(event);
  }

  const summary = summarizeSpan(droppedEvents);
  const finalMarker = { ...marker, summary };
  const finalEvents = kept.map((event) =>
    event === marker ? finalMarker : event,
  );

  return { events: finalEvents, marker: finalMarker, compacted: true };
}

/** Count the compactions already recorded in a transcript. */
export function compactionGeneration(events: readonly AgentEvent[]): number {
  let generation = 0;
  for (const event of events) {
    if (event.type === "contextCompacted") {
      generation = Math.max(generation, event.generation);
    }
  }
  return generation;
}

/**
 * Compact a journal in place, returning renumbered lines.
 *
 * The journal is append-only on disk; this produces the *live window* handed back to
 * the agent on resume. The on-disk journal keeps every original event, which is what
 * makes the full trajectory recoverable even after several compactions.
 */
export function compactJournalWindow(
  lines: readonly JournalLine[],
  policy: CompactionPolicy = DEFAULT_POLICY,
): { readonly window: readonly JournalLine[]; readonly result: CompactionResult } {
  const events = lines.map((line) => line.event);
  const generation = compactionGeneration(events) + 1;
  const result = compactMiddle(events, policy, generation);
  const window = result.events.map((event, index) => ({ seq: index, event }));
  return { window, result };
}
