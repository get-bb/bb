import type { AgentEvent, JournalLine, RunFidelity } from "../events/events.ts";
import type { ExecutionRef } from "../events/events.ts";
export interface TokenTrace {
    readonly promptTokenIds: readonly number[];
    readonly responseIds: readonly number[];
    readonly lossMask: readonly number[];
    readonly rolloutLogprobs?: readonly number[];
}
export interface RewardRecord {
    readonly value: number;
    readonly kind: "test_execution" | "diff_similarity" | "rubric" | "none";
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
    readonly summarizationCount: number;
    readonly reward: RewardRecord;
    readonly metrics: ToolCallMetrics;
    readonly usage: {
        readonly inputTokens: number;
        readonly outputTokens: number;
    };
    readonly e2eTimeSec?: number;
    readonly timeSplits?: Readonly<Record<string, number>>;
    readonly tokens?: TokenTrace;
    readonly events: readonly AgentEvent[];
}
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
export function journalToTrajectory(lines: readonly JournalLine[], options: JournalToTrajectoryOptions): TrajectoryRecord {
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
                if (event.fidelity !== undefined)
                    fidelity = event.fidelity;
                if (event.execution !== undefined)
                    execution = event.execution;
                break;
            case "assistantMessageCompleted":
                numTurns += 1;
                break;
            case "toolCall": {
                numToolCalls += 1;
                const kind = event.call.kind;
                toolCallsByKind[kind] = (toolCallsByKind[kind] ?? 0) + 1;
                toolKindById.set(event.id, kind);
                if (CODE_EXEC_KINDS.has(kind))
                    numCodeExecToolCalls += 1;
                break;
            }
            case "toolResult":
                resolvedToolIds.add(event.id);
                if (event.isError)
                    erroredToolIds.add(event.id);
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
    let numSuccessfulToolCalls = 0;
    for (const id of resolvedToolIds) {
        if (!erroredToolIds.has(id))
            numSuccessfulToolCalls += 1;
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
export function isTrainable(record: TrajectoryRecord): boolean {
    return untrainableReason(record) === null;
}
export function untrainableReason(record: TrajectoryRecord): string | null {
    if (record.fidelity !== "token") {
        return `fidelity is "${record.fidelity}"; token ids are only available when Opulent owns the sampler`;
    }
    const t = record.tokens;
    if (t === undefined)
        return "no token trace attached";
    if (t.promptTokenIds.length === 0)
        return "promptTokenIds is empty";
    if (t.responseIds.length === 0)
        return "responseIds is empty";
    if (t.lossMask.length !== t.responseIds.length) {
        return `lossMask length ${t.lossMask.length} != responseIds length ${t.responseIds.length}`;
    }
    if (![...t.promptTokenIds, ...t.responseIds].every((id) => Number.isSafeInteger(id) && id >= 0)) return "token ids must be non-negative safe integers";
    if (!t.lossMask.every((mask) => mask === 0 || mask === 1)) return "loss masks must be binary";
    if (t.rolloutLogprobs !== undefined && (t.rolloutLogprobs.length !== t.responseIds.length || !t.rolloutLogprobs.every(Number.isFinite))) return "logprobs must be finite and aligned with responseIds";
    if (!Number.isFinite(record.reward.value)) return "reward must be finite";
    return null;
}
export function toGeneratorOutput(records: readonly TrajectoryRecord[]): GeneratorOutput {
    if (records.length === 0) {
        throw new TrajectoryExportError("cannot build a GeneratorOutput from zero records");
    }
    for (const record of records) {
        const reason = untrainableReason(record);
        if (reason !== null) {
            throw new TrajectoryExportError(`trajectory ${record.trajectoryId} is not trainable: ${reason}`);
        }
    }
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
    const allSplit = splitRecords.every((s): s is Readonly<Record<string, number>> => s !== undefined);
    let timeSplits: Record<string, number[]> | null = null;
    if (allSplit && splitRecords.length > 0) {
        const first = splitRecords[0];
        if (first !== undefined) {
            timeSplits = {};
            const keys = Object.keys(first).sort();
            if (!splitRecords.every((s) => JSON.stringify(Object.keys(s).sort()) === JSON.stringify(keys))) throw new TrajectoryExportError("time split keys must match across the batch");
            for (const key of keys) {
                timeSplits[key] = splitRecords.map((s) => {
                    const value = s[key];
                    if (value === undefined || !Number.isFinite(value) || value < 0) throw new TrajectoryExportError("time splits must be finite non-negative seconds");
                    return value;
                });
            }
        }
    }
    const rewards = records.map((r) => r.reward.value);
    const meanReward = rewards.reduce((a, b) => a + b, 0) / rewards.length;
    const meanTurns = records.reduce((a, r) => a + r.numTurns, 0) / records.length;
    const meanToolCalls = records.reduce((a, r) => a + r.metrics.numToolCalls, 0) / records.length;
    const meanSummarizations = records.reduce((a, r) => a + r.summarizationCount, 0) / records.length;
    const compactedFraction = records.filter((r) => r.summarizationCount > 0).length / records.length;
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
export function serializeTrajectories(records: readonly TrajectoryRecord[]): string {
    return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
