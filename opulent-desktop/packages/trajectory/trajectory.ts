/**
 * Run journal -> SkyRL trajectory.
 *
 * The hard constraint this module exists to enforce: SkyRL trains on token ids, and most
 * Opulent runs will not produce them. `GeneratorOutput` requires `prompt_token_ids`,
 * `response_ids` and `loss_masks` ([S23]); the SkyRL recipe's agent supplies them from its
 * own inference path (`tito_tokens` / `tito_loss_mask` / `tito_logprobs`) precisely to
 * avoid re-tokenization drift. A Claude Code or Devin run through a vendor API gives us
 * none of that.
 *
 * So there are two tiers:
 *
 *   Tier 1 (always)   a TrajectoryRecord: normalized events + reward + metadata. Usable
 *                     for eval, regression corpora and distillation.
 *   Tier 2 (opt-in)   a SkyRL GeneratorOutput, only from records whose fidelity is
 *                     "token" and which actually carry token ids.
 *
 * `toGeneratorOutput` throws rather than emitting zeros for missing token fields. Silently
 * padding would produce training data that looks valid and teaches the wrong thing.
 */

import type { AgentEvent, JournalLine, RunFidelity } from "../events/events.ts";
import type { ExecutionRef } from "../events/events.ts";

/** Token-level rollout data. Present only when Opulent owned the sampler. */
export interface TokenTrace {
  readonly promptTokenIds: readonly number[];
  readonly responseIds: readonly number[];
  /** 1 for model-generated tokens, 0 for prompt/observation tokens ([S23]). */
  readonly lossMask: readonly number[];
  readonly rolloutLogprobs?: readonly number[];
}

/** Reward, in Harbor's vocabulary ([S21]). */
export interface RewardRecord {
  readonly value: number;
  readonly kind: "test_execution" | "diff_similarity" | "rubric" | "none";
  /** Harbor's verifier writes /logs/verifier/reward.txt; record where this came from. */
  readonly source?: string;
}

export interface ToolCallMetrics {
  readonly numToolCalls: number;
  readonly numSuccessfulToolCalls: number;
  readonly numCodeExecToolCalls: number;
  readonly toolCallsByKind: Readonly<Record<string, number>>;
}

export interface TrajectoryRecord {
  readonly trajectoryId: string;
  readonly taskPath?: string;
  readonly dataSource?: string;
  readonly provider: string;
  readonly model: string;
  readonly execution?: ExecutionRef;
  readonly fidelity: RunFidelity;
  readonly stopReason: string;
  readonly numTurns: number;
  /**
   * How many times the runtime compacted this session's context mid-run.
   *
   * The SkyRL recipe tracks the same quantity as `summarization_count` ([S23]). A
   * compacted trajectory is still trainable — recovering from a context limit is
   * legitimate agent behavior — but it is not the same object as one that never hit
   * the limit, and a training run that cannot separate the two is measuring a blend.
   */
  readonly summarizationCount: number;
  readonly reward: RewardRecord;
  readonly metrics: ToolCallMetrics;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  /** Wall-clock seconds for the whole trajectory, when measured. */
  readonly e2eTimeSec?: number;
  /** {"llm": inference seconds, "env": tool-execution seconds} ([S23]). */
  readonly timeSplits?: Readonly<Record<string, number>>;
  readonly tokens?: TokenTrace;
  /** The normalized event stream, retained so a record is self-contained. */
  readonly events: readonly AgentEvent[];
}

/** SkyRL's GeneratorOutput. Keys are exactly those written by the recipe ([S23]). */
export interface GeneratorOutput {
  prompt_token_ids: number[][];
  response_ids: number[][];
  rewards: number[];
  loss_masks: number[][];
  stop_reasons: string[];
  rollout_metrics: Record<string, number>;
  rollout_logprobs: number[][] | null;
  trajectory_generation_times: number[] | null;
  trajectory_time_splits: Record<string, number[]> | null;
}

export class TrajectoryExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrajectoryExportError";
  }
}

/** Tool kinds that execute code, tracked separately as the recipe does ([S23]). */
const CODE_EXEC_KINDS = new Set(["exec", "applyPatch", "writeFile", "editFile"]);

export interface JournalToTrajectoryOptions {
  readonly trajectoryId: string;
  readonly reward?: RewardRecord;
  readonly taskPath?: string;
  readonly dataSource?: string;
  readonly tokens?: TokenTrace;
  readonly e2eTimeSec?: number;
  readonly timeSplits?: Readonly<Record<string, number>>;
}

/**
 * Fold a journal into one trajectory record.
 *
 * Always succeeds for a well-formed journal: this is the Tier-1 path, and a run with no
 * reward and no tokens is still worth keeping as an eval trace.
 */
export function journalToTrajectory(
  lines: readonly JournalLine[],
  options: JournalToTrajectoryOptions,
): TrajectoryRecord {
  const events = lines.map((line) => line.event);

  let provider = "unknown";
  let model = "unknown";
  let fidelity: RunFidelity = "event";
  let execution: ExecutionRef | undefined;
  let stopReason = "incomplete";
  let numTurns = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  let summarizationCount = 0;
  let numToolCalls = 0;
  let numCodeExecToolCalls = 0;
  const toolCallsByKind: Record<string, number> = {};
  const toolKindById = new Map<string, string>();
  const erroredToolIds = new Set<string>();
  const resolvedToolIds = new Set<string>();

  for (const event of events) {
    switch (event.type) {
      case "sessionStarted":
        provider = event.harness;
        model = event.model;
        if (event.fidelity !== undefined) fidelity = event.fidelity;
        if (event.execution !== undefined) execution = event.execution;
        break;
      case "assistantMessageCompleted":
        numTurns += 1;
        break;
      case "toolCall": {
        numToolCalls += 1;
        const kind = event.call.kind;
        toolCallsByKind[kind] = (toolCallsByKind[kind] ?? 0) + 1;
        toolKindById.set(event.id, kind);
        if (CODE_EXEC_KINDS.has(kind)) numCodeExecToolCalls += 1;
        break;
      }
      case "toolResult":
        resolvedToolIds.add(event.id);
        if (event.isError) erroredToolIds.add(event.id);
        break;
      case "usage":
        inputTokens += event.inputTokens;
        outputTokens += event.outputTokens;
        break;
      case "contextCompacted":
        summarizationCount += 1;
        break;
      case "done":
        stopReason = event.status;
        break;
      default:
        break;
    }
  }

  // A tool call with no result is not a success; only resolved non-error calls count.
  let numSuccessfulToolCalls = 0;
  for (const id of resolvedToolIds) {
    if (!erroredToolIds.has(id)) numSuccessfulToolCalls += 1;
  }

  const record: TrajectoryRecord = {
    trajectoryId: options.trajectoryId,
    provider,
    model,
    fidelity,
    stopReason,
    numTurns,
    summarizationCount,
    reward: options.reward ?? { value: 0, kind: "none" },
    metrics: {
      numToolCalls,
      numSuccessfulToolCalls,
      numCodeExecToolCalls,
      toolCallsByKind,
    },
    usage: { inputTokens, outputTokens },
    events,
    ...(options.taskPath !== undefined ? { taskPath: options.taskPath } : {}),
    ...(options.dataSource !== undefined ? { dataSource: options.dataSource } : {}),
    ...(execution !== undefined ? { execution } : {}),
    ...(options.tokens !== undefined ? { tokens: options.tokens } : {}),
    ...(options.e2eTimeSec !== undefined ? { e2eTimeSec: options.e2eTimeSec } : {}),
    ...(options.timeSplits !== undefined ? { timeSplits: options.timeSplits } : {}),
  };

  return record;
}

/** True when this record can legally contribute to a SkyRL GeneratorOutput. */
export function isTrainable(record: TrajectoryRecord): boolean {
  if (record.fidelity !== "token") return false;
  const t = record.tokens;
  if (t === undefined) return false;
  return (
    t.promptTokenIds.length > 0 &&
    t.responseIds.length > 0 &&
    t.lossMask.length === t.responseIds.length
  );
}

/**
 * Explain why a record is not trainable. Returns null when it is.
 * Used by the exporter's error message and by operators triaging a batch.
 */
export function untrainableReason(record: TrajectoryRecord): string | null {
  if (record.fidelity !== "token") {
    return `fidelity is "${record.fidelity}"; token ids are only available when Opulent owns the sampler`;
  }
  const t = record.tokens;
  if (t === undefined) return "no token trace attached";
  if (t.promptTokenIds.length === 0) return "promptTokenIds is empty";
  if (t.responseIds.length === 0) return "responseIds is empty";
  if (t.lossMask.length !== t.responseIds.length) {
    return `lossMask length ${t.lossMask.length} != responseIds length ${t.responseIds.length}`;
  }
  return null;
}

/**
 * Build a SkyRL `GeneratorOutput` from a batch of trajectories.
 *
 * Throws on the first untrainable record. That is deliberate: a batch that silently drops
 * or zero-pads trajectories changes the effective objective without any signal.
 *
 * `rollout_logprobs` is null unless every record carries logprobs, matching the recipe's
 * all-or-nothing handling of the optional per-trajectory fields ([S23]).
 */
export function toGeneratorOutput(
  records: readonly TrajectoryRecord[],
): GeneratorOutput {
  if (records.length === 0) {
    throw new TrajectoryExportError("cannot build a GeneratorOutput from zero records");
  }

  for (const record of records) {
    const reason = untrainableReason(record);
    if (reason !== null) {
      throw new TrajectoryExportError(
        `trajectory ${record.trajectoryId} is not trainable: ${reason}`,
      );
    }
  }

  // Non-null after the check above; narrowed explicitly to keep strict mode honest.
  const traces = records.map((r) => {
    const t = r.tokens;
    if (t === undefined) {
      throw new TrajectoryExportError(`trajectory ${r.trajectoryId} lost its token trace`);
    }
    return t;
  });

  const hasLogprobs = traces.every((t) => t.rolloutLogprobs !== undefined);
  const times = records.map((r) => r.e2eTimeSec);
  const allTimed = times.every((t): t is number => typeof t === "number");

  const splitRecords = records.map((r) => r.timeSplits);
  const allSplit = splitRecords.every(
    (s): s is Readonly<Record<string, number>> => s !== undefined,
  );
  let timeSplits: Record<string, number[]> | null = null;
  if (allSplit && splitRecords.length > 0) {
    const first = splitRecords[0];
    if (first !== undefined) {
      timeSplits = {};
      for (const key of Object.keys(first)) {
        timeSplits[key] = splitRecords.map((s) => s[key] ?? 0);
      }
    }
  }

  const rewards = records.map((r) => r.reward.value);
  const meanReward = rewards.reduce((a, b) => a + b, 0) / rewards.length;
  const meanTurns =
    records.reduce((a, r) => a + r.numTurns, 0) / records.length;
  const meanToolCalls =
    records.reduce((a, r) => a + r.metrics.numToolCalls, 0) / records.length;
  // Surfaced because a batch whose reward moved while compaction rates also moved has
  // two explanations, and the metric is what tells them apart ([S23]).
  const meanSummarizations =
    records.reduce((a, r) => a + r.summarizationCount, 0) / records.length;
  const compactedFraction =
    records.filter((r) => r.summarizationCount > 0).length / records.length;

  return {
    prompt_token_ids: traces.map((t) => [...t.promptTokenIds]),
    response_ids: traces.map((t) => [...t.responseIds]),
    rewards,
    loss_masks: traces.map((t) => [...t.lossMask]),
    stop_reasons: records.map((r) => r.stopReason),
    rollout_metrics: {
      "rollout/mean_reward": meanReward,
      "rollout/mean_num_turns": meanTurns,
      "rollout/mean_num_tool_calls": meanToolCalls,
      "rollout/mean_summarization_count": meanSummarizations,
      "rollout/compacted_fraction": compactedFraction,
    },
    rollout_logprobs: hasLogprobs
      ? traces.map((t) => [...(t.rolloutLogprobs ?? [])])
      : null,
    trajectory_generation_times: allTimed ? times : null,
    trajectory_time_splits: timeSplits,
  };
}

/** Serialize Tier-1 records as JSONL for the cloud trajectory store. */
export function serializeTrajectories(
  records: readonly TrajectoryRecord[],
): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
