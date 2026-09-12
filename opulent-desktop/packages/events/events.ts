/**
 * Normalized agent event grammar for Opulent Desktop.
 *
 * Adopted verbatim from Comet's `AgentEvent` tagged enum
 * (research/src/Git-Godssoldier_comet/crates/proto/src/agent.rs, EVIDENCE.md [S11]),
 * which is already the union of Claude Code and Codex semantics, with two additive
 * Opulent extensions:
 *
 *   1. `HarnessId` is an open string rather than a closed four-member enum, because we
 *      must name `opencode`, `devin-cli`, `claude-managed` and user-registered agents.
 *   2. `sessionStarted` carries `execution` (where the tool calls ran) and `fidelity`
 *      (how much of the agent's internals we actually observed). Both are optional so
 *      journals written before the extension still parse.
 *
 * The doctrine is bb's ([S3]): the bridge knows the dialect, the runtime knows the
 * timeline. Providers emit these events; the runtime owns ids and ordering.
 */

/** Where a run's tool calls executed. */
export type ExecutionTarget = "local" | "modal" | "daytona";

export interface ExecutionRef {
  readonly target: ExecutionTarget;
  /** Backend-specific handle: sandbox id, workspace id, or an absolute local path. */
  readonly ref: string;
}

/**
 * How much of the agent's internal state the journal actually observed.
 *
 * - `token`     we own the sampler; token ids and logprobs are available (TITO, [S23]).
 * - `event`     we see the full semantic stream (deltas, tool calls) but no token ids.
 * - `lifecycle` we only see start/finish and coarse worker state — the Outpost case [S17].
 *
 * The trajectory exporter refuses to emit SkyRL token fields below `token`; see
 * packages/trajectory.
 */
export type RunFidelity = "token" | "event" | "lifecycle";

export type DoneStatus = "completed" | "interrupted" | "errored";

export interface TodoItem {
  readonly text: string;
  readonly done: boolean;
}

/** A decoded tool invocation, reduced to the fields a UI renders. Mirrors [S11]. */
export type ToolCall =
  | { readonly kind: "exec"; readonly command: string }
  | { readonly kind: "readFile"; readonly path: string }
  | { readonly kind: "writeFile"; readonly path: string; readonly content?: string }
  | {
      readonly kind: "editFile";
      readonly path: string;
      readonly oldString?: string;
      readonly newString?: string;
    }
  | { readonly kind: "applyPatch"; readonly path?: string }
  | { readonly kind: "search"; readonly pattern: string; readonly path?: string }
  | { readonly kind: "glob"; readonly pattern: string }
  | { readonly kind: "webFetch"; readonly url: string; readonly prompt?: string }
  | { readonly kind: "webSearch"; readonly query: string }
  | { readonly kind: "todo"; readonly items: readonly TodoItem[] }
  | {
      readonly kind: "mcp";
      readonly server: string;
      readonly tool: string;
      readonly input?: unknown;
    }
  | { readonly kind: "unknown"; readonly name: string; readonly input?: unknown };

export interface UserInputQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly multiSelect?: boolean;
}

export interface UserInputAnswer {
  readonly questionId: string;
  readonly labels: readonly string[];
}

export type AgentEvent =
  | {
      readonly type: "sessionStarted";
      /** Open string, not a closed enum: "claude-code" | "opencode" | "devin-cli" | … */
      readonly harness: string;
      readonly model: string;
      readonly tools?: readonly string[];
      readonly cwd: string;
      /** Harness-native session id, used for resume. */
      readonly sessionId: string;
      readonly assistantMessageId: string;
      /** Opulent extension: where the tool calls run. */
      readonly execution?: ExecutionRef;
      /** Opulent extension: observability tier of this run. */
      readonly fidelity?: RunFidelity;
    }
  | { readonly type: "textDelta"; readonly text: string }
  | { readonly type: "reasoningDelta"; readonly text: string }
  | { readonly type: "assistantMessageCompleted"; readonly assistantMessageId: string }
  | { readonly type: "toolCall"; readonly id: string; readonly call: ToolCall }
  | { readonly type: "toolResult"; readonly id: string; readonly isError: boolean }
  | { readonly type: "usage"; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly type: "error"; readonly message: string }
  | {
      readonly type: "inputRequested";
      readonly requestId: string;
      readonly questions: readonly UserInputQuestion[];
    }
  | { readonly type: "inputResolved"; readonly requestId: string }
  | {
      /**
       * The runtime compacted this session's context in place: a middle span of the
       * transcript was replaced by a summary so the turn could continue.
       *
       * This is the recovery event for an ACP `max_tokens` stop. It is recorded in the
       * journal rather than applied silently, because a compacted trajectory is a
       * different object from one that never hit the limit and the learning plane has
       * to be able to tell them apart.
       */
      readonly type: "contextCompacted";
      /** How many prior events the compaction removed from the live window. */
      readonly droppedEvents: number;
      /** Heuristic token estimate of what was dropped; not an exact count. */
      readonly droppedTokensEstimate: number;
      /** The replacement text handed back to the agent in place of the dropped span. */
      readonly summary: string;
      /** 1 for the first compaction of a session, 2 for the second, and so on. */
      readonly generation: number;
    }
  | {
      readonly type: "steered";
      readonly assistantMessageId?: string;
      readonly nextAssistantMessageId?: string;
    }
  | {
      readonly type: "done";
      readonly status: DoneStatus;
      readonly result?: string;
      readonly error?: string;
      readonly sessionId?: string;
    };

/**
 * One line of a run journal.
 *
 * Storage is append-only JSONL, one file per chat, exactly as Comet's run_journal.rs
 * does it ([S12]): `{data_dir}/journals/{chatId}.jsonl`, monotonically increasing `seq`.
 * A journal whose last event is not `done` belongs to a run that died mid-stream.
 */
export interface JournalLine {
  readonly seq: number;
  readonly event: AgentEvent;
}

export class JournalParseError extends Error {
  readonly lineNumber: number;

  constructor(message: string, lineNumber: number) {
    super(`journal line ${lineNumber}: ${message}`);
    this.name = "JournalParseError";
    this.lineNumber = lineNumber;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const EVENT_TYPES = new Set([
  "sessionStarted",
  "textDelta",
  "reasoningDelta",
  "assistantMessageCompleted",
  "toolCall",
  "toolResult",
  "usage",
  "error",
  "inputRequested",
  "inputResolved",
  "contextCompacted",
  "steered",
  "done",
]);

/**
 * Parse a JSONL journal.
 *
 * Tolerates a torn trailing line from a crash mid-write, which the Rust implementation
 * also tolerates everywhere ([S12]). Any other malformed line is an error: silently
 * dropping events would corrupt a trajectory without anyone noticing.
 */
export function parseJournal(text: string): JournalLine[] {
  const rawLines = text.split("\n");
  const lines: JournalLine[] = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i] ?? "";
    if (raw.trim() === "") continue;

    const isLast = i === rawLines.length - 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A torn final line is expected after a crash; anything earlier is corruption.
      if (isLast) continue;
      throw new JournalParseError("malformed JSON", i + 1);
    }

    if (!isRecord(parsed)) throw new JournalParseError("expected an object", i + 1);
    const { seq, event } = parsed;
    if (typeof seq !== "number" || !Number.isInteger(seq)) {
      throw new JournalParseError("missing integer `seq`", i + 1);
    }
    if (!isRecord(event) || typeof event["type"] !== "string") {
      throw new JournalParseError("missing `event.type`", i + 1);
    }
    if (!EVENT_TYPES.has(event["type"])) {
      throw new JournalParseError(`unknown event type "${event["type"]}"`, i + 1);
    }
    lines.push({ seq, event: event as unknown as AgentEvent });
  }

  return lines;
}

export function serializeJournal(lines: readonly JournalLine[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

/**
 * True when the journal's last event is not `done` — the crash-recovery gauge from [S12].
 * Boot recovery stamps such a run `aborted` and closes it with a synthetic `done`.
 */
export function isAborted(lines: readonly JournalLine[]): boolean {
  const last = lines.at(-1);
  return last === undefined || last.event.type !== "done";
}

/** Close a crashed journal with the synthetic terminal event described in [S12]. */
export function closeAborted(lines: readonly JournalLine[]): JournalLine[] {
  if (!isAborted(lines)) return [...lines];
  const nextSeq = (lines.at(-1)?.seq ?? -1) + 1;
  return [
    ...lines,
    {
      seq: nextSeq,
      event: {
        type: "done",
        status: "errored",
        error: "run ended without a terminal event (recovered at boot)",
      },
    },
  ];
}
