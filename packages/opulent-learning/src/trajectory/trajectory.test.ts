import assert from "node:assert/strict";
import { test } from "vitest";
import { closeAborted, isAborted, parseJournal, serializeJournal, type JournalLine, } from "../events/events.ts";
import { isTrainable, journalToTrajectory, toGeneratorOutput, TrajectoryExportError, untrainableReason, type TrajectoryRecord, } from "./trajectory.ts";
function journal(): JournalLine[] {
    return [
        {
            seq: 0,
            event: {
                type: "sessionStarted",
                harness: "opencode",
                model: "claude-sonnet-4-6",
                cwd: "/workspace/repo",
                sessionId: "sess-1",
                assistantMessageId: "a1",
                execution: { target: "modal", ref: "sb-abc123" },
                fidelity: "event",
            },
        },
        { seq: 1, event: { type: "textDelta", text: "Looking at the failing test." } },
        { seq: 2, event: { type: "toolCall", id: "t1", call: { kind: "exec", command: "pytest -x" } } },
        { seq: 3, event: { type: "toolResult", id: "t1", isError: true } },
        { seq: 4, event: { type: "toolCall", id: "t2", call: { kind: "readFile", path: "src/a.py" } } },
        { seq: 5, event: { type: "toolResult", id: "t2", isError: false } },
        {
            seq: 6,
            event: {
                type: "toolCall",
                id: "t3",
                call: { kind: "editFile", path: "src/a.py", oldString: "x", newString: "y" },
            },
        },
        { seq: 7, event: { type: "toolResult", id: "t3", isError: false } },
        { seq: 8, event: { type: "toolCall", id: "t4", call: { kind: "exec", command: "pytest" } } },
        { seq: 9, event: { type: "assistantMessageCompleted", assistantMessageId: "a1" } },
        { seq: 10, event: { type: "usage", inputTokens: 1200, outputTokens: 340 } },
        { seq: 11, event: { type: "done", status: "completed", sessionId: "sess-1" } },
    ];
}
test("journal round-trips through serialize/parse", () => {
    const lines = journal();
    const parsed = parseJournal(serializeJournal(lines));
    assert.deepEqual(parsed, lines);
});
test("parseJournal tolerates a torn trailing line but not earlier corruption", () => {
    const good = serializeJournal(journal()).trimEnd();
    const torn = `${good}\n{"seq": 12, "event": {"type": "textD`;
    assert.equal(parseJournal(torn).length, journal().length);
    const corrupt = `{"seq": 0, "event": {"type": "textDelta", "text": "a"}}\nnot json\n{"seq": 2, "event": {"type": "textDelta", "text": "b"}}`;
    assert.throws(() => parseJournal(corrupt), /journal line 2/);
});
test("parseJournal rejects an unknown event type", () => {
    assert.throws(() => parseJournal('{"seq": 0, "event": {"type": "teleport"}}'), /unknown event type "teleport"/);
});
test("a journal without a terminal done is aborted and can be closed", () => {
    const partial = journal().slice(0, 5);
    assert.equal(isAborted(partial), true);
    const closed = closeAborted(partial);
    const last = closed.at(-1);
    assert.ok(last);
    assert.equal(last.event.type, "done");
    assert.equal(last.seq, 5);
    assert.equal(isAborted(closed), false);
    const complete = journal();
    assert.deepEqual(closeAborted(complete), complete);
});
test("journalToTrajectory folds events into metrics", () => {
    const record = journalToTrajectory(journal(), {
        trajectoryId: "traj-1",
        reward: { value: 1, kind: "test_execution", source: "/logs/verifier/reward.txt" },
        taskPath: "tasks/opulent__fix-a",
    });
    assert.equal(record.provider, "opencode");
    assert.equal(record.model, "claude-sonnet-4-6");
    assert.equal(record.fidelity, "event");
    assert.deepEqual(record.execution, { target: "modal", ref: "sb-abc123" });
    assert.equal(record.stopReason, "completed");
    assert.equal(record.numTurns, 1);
    assert.equal(record.usage.inputTokens, 1200);
    assert.equal(record.usage.outputTokens, 340);
    assert.equal(record.metrics.numToolCalls, 4);
    assert.equal(record.metrics.numSuccessfulToolCalls, 2);
    assert.equal(record.metrics.numCodeExecToolCalls, 3);
    assert.deepEqual(record.metrics.toolCallsByKind, { exec: 2, readFile: 1, editFile: 1 });
});
test("journalToTrajectory defaults reward to none and keeps the event stream", () => {
    const record = journalToTrajectory(journal(), { trajectoryId: "traj-2" });
    assert.deepEqual(record.reward, { value: 0, kind: "none" });
    assert.equal(record.events.length, journal().length);
});
function trainableRecord(id: string, reward: number): TrajectoryRecord {
    const base = journalToTrajectory(journal(), {
        trajectoryId: id,
        reward: { value: reward, kind: "test_execution" },
        e2eTimeSec: 12.5,
        timeSplits: { llm: 8, env: 4.5 },
        tokens: {
            promptTokenIds: [1, 2, 3],
            responseIds: [4, 5, 6, 7],
            lossMask: [1, 1, 0, 1],
            rolloutLogprobs: [-0.1, -0.2, 0, -0.3],
        },
    });
    return { ...base, fidelity: "token" };
}
test("trainability requires token fidelity and aligned masks", () => {
    const ok = trainableRecord("t-ok", 1);
    assert.equal(isTrainable(ok), true);
    assert.equal(untrainableReason(ok), null);
    const eventOnly = journalToTrajectory(journal(), { trajectoryId: "t-event" });
    assert.equal(isTrainable(eventOnly), false);
    assert.match(untrainableReason(eventOnly) ?? "", /fidelity is "event"/);
    const noTokens: TrajectoryRecord = { ...eventOnly, fidelity: "token" };
    assert.equal(untrainableReason(noTokens), "no token trace attached");
    const misaligned: TrajectoryRecord = {
        ...ok,
        tokens: { promptTokenIds: [1], responseIds: [4, 5, 6], lossMask: [1, 1] },
    };
    assert.match(untrainableReason(misaligned) ?? "", /lossMask length 2 != responseIds length 3/);
});
test("toGeneratorOutput emits exactly SkyRL's keys", () => {
    const out = toGeneratorOutput([trainableRecord("a", 1), trainableRecord("b", 0)]);
    assert.deepEqual(Object.keys(out).sort(), [
        "loss_masks",
        "prompt_token_ids",
        "response_ids",
        "rewards",
        "rollout_logprobs",
        "rollout_metrics",
        "stop_reasons",
        "trajectory_generation_times",
        "trajectory_time_splits",
    ]);
    assert.deepEqual(out.prompt_token_ids, [[1, 2, 3], [1, 2, 3]]);
    assert.deepEqual(out.response_ids, [[4, 5, 6, 7], [4, 5, 6, 7]]);
    assert.deepEqual(out.loss_masks, [[1, 1, 0, 1], [1, 1, 0, 1]]);
    assert.deepEqual(out.rewards, [1, 0]);
    assert.deepEqual(out.stop_reasons, ["completed", "completed"]);
    assert.deepEqual(out.trajectory_generation_times, [12.5, 12.5]);
    assert.deepEqual(out.trajectory_time_splits, { llm: [8, 8], env: [4.5, 4.5] });
    assert.equal(out.rollout_metrics["rollout/mean_reward"], 0.5);
});
test("toGeneratorOutput refuses to fabricate tokens for a non-token run", () => {
    const eventOnly = journalToTrajectory(journal(), {
        trajectoryId: "vendor-run",
        reward: { value: 1, kind: "test_execution" },
    });
    assert.throws(() => toGeneratorOutput([trainableRecord("ok", 1), eventOnly]), (error: unknown) => {
        assert.ok(error instanceof TrajectoryExportError);
        assert.match(error.message, /vendor-run is not trainable/);
        assert.match(error.message, /fidelity is "event"/);
        return true;
    });
});
test("optional per-trajectory fields are all-or-nothing", () => {
    const withTime = trainableRecord("a", 1);
    const withoutTime: TrajectoryRecord = { ...trainableRecord("b", 1) };
    delete (withoutTime as {
        e2eTimeSec?: number;
    }).e2eTimeSec;
    delete (withoutTime as {
        timeSplits?: unknown;
    }).timeSplits;
    delete (withoutTime as {
        tokens?: unknown;
    }).tokens;
    const patched: TrajectoryRecord = {
        ...withoutTime,
        tokens: { promptTokenIds: [1], responseIds: [2], lossMask: [1] },
    };
    const out = toGeneratorOutput([withTime, patched]);
    assert.equal(out.trajectory_generation_times, null);
    assert.equal(out.trajectory_time_splits, null);
    assert.equal(out.rollout_logprobs, null);
});
test("toGeneratorOutput rejects an empty batch", () => {
    assert.throws(() => toGeneratorOutput([]), TrajectoryExportError);
});
test("an uncompacted run reports zero summarizations", () => {
    const record = journalToTrajectory(journal(), { trajectoryId: "t-clean" });
    assert.equal(record.summarizationCount, 0);
});
test("compaction is counted, and a compacted run stays trainable", () => {
    const lines = journal();
    const compacted: JournalLine[] = [
        ...lines.slice(0, 2),
        {
            seq: 99,
            event: {
                type: "contextCompacted" as const,
                droppedEvents: 12,
                droppedTokensEstimate: 4200,
                summary: "[12 earlier events were compacted out of the live context.]",
                generation: 1,
            },
        },
        ...lines.slice(2),
    ].map((line, seq) => ({ seq, event: line.event }));
    const record = journalToTrajectory(compacted, {
        trajectoryId: "t-compacted",
        tokens: {
            promptTokenIds: [1, 2],
            responseIds: [3, 4],
            lossMask: [1, 1],
        },
    });
    assert.equal(record.summarizationCount, 1);
    assert.equal(isTrainable({ ...record, fidelity: "token" }), true);
});
test("rollout metrics expose the compaction rate of a batch", () => {
    const clean = trainableRecord("t-clean", 1);
    const compacted: TrajectoryRecord = { ...trainableRecord("t-comp", 0), summarizationCount: 2 };
    const out = toGeneratorOutput([clean, compacted]);
    assert.equal(out.rollout_metrics["rollout/mean_summarization_count"], 1);
    assert.equal(out.rollout_metrics["rollout/compacted_fraction"], 0.5);
});
