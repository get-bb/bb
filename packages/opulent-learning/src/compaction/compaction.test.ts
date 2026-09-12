import assert from "node:assert/strict";
import { test } from "vitest";
import type { AgentEvent } from "../events/events.ts";
import { parseJournal, serializeJournal } from "../events/events.ts";
import { compactionGeneration, compactJournalWindow, compactMiddle, DEFAULT_POLICY, estimateTotalTokens, summarizeSpan, type CompactionPolicy, } from "./compaction.ts";
const started: AgentEvent = {
    type: "sessionStarted",
    harness: "opencode",
    model: "claude-opus-5",
    cwd: "/w",
    sessionId: "s1",
    assistantMessageId: "m1",
    fidelity: "event",
};
function filler(n: number): AgentEvent[] {
    return Array.from({ length: n }, (_, i) => ({
        type: "textDelta" as const,
        text: `chunk ${i} `.padEnd(400, "x"),
    }));
}
function tight(overrides: Partial<CompactionPolicy> = {}): CompactionPolicy {
    return { keepHead: 2, keepTail: 2, targetTokens: 500, ...overrides };
}
test("a transcript under budget is returned untouched", () => {
    const events = [started, ...filler(2)];
    const result = compactMiddle(events, { ...DEFAULT_POLICY });
    assert.equal(result.compacted, false);
    assert.deepEqual(result.events, events);
});
test("compaction frees tokens and reports what it dropped", () => {
    const events = [started, ...filler(60)];
    const before = estimateTotalTokens(events);
    const result = compactMiddle(events, tight());
    assert.equal(result.compacted, true);
    assert.ok(result.marker.droppedEvents > 0);
    assert.ok(estimateTotalTokens(result.events) < before);
    assert.ok(result.marker.droppedTokensEstimate > 0);
});
test("the head and the tail always survive", () => {
    const head = [started, { type: "textDelta" as const, text: "THE TASK" }];
    const tail: AgentEvent[] = [
        { type: "textDelta", text: "PENULTIMATE" },
        { type: "textDelta", text: "LAST" },
    ];
    const events = [...head, ...filler(60), ...tail];
    const result = compactMiddle(events, tight());
    assert.equal(result.compacted, true);
    assert.deepEqual(result.events.slice(0, 2), head);
    assert.deepEqual(result.events.slice(-2), tail);
});
test("a tool call is never separated from its result", () => {
    const events: AgentEvent[] = [
        started,
        ...filler(20),
        { type: "toolCall", id: "t1", call: { kind: "exec", command: "pytest -q" } },
        ...filler(20),
        { type: "toolResult", id: "t1", isError: false },
        ...filler(20),
    ];
    const result = compactMiddle(events, tight({ targetTokens: 300 }));
    assert.equal(result.compacted, true);
    const hasCall = result.events.some((e) => e.type === "toolCall" && e.id === "t1");
    const hasResult = result.events.some((e) => e.type === "toolResult" && e.id === "t1");
    assert.equal(hasCall, hasResult, "a toolCall and its toolResult must be dropped or kept together");
});
test("an inputRequested is never separated from its resolution", () => {
    const events: AgentEvent[] = [
        started,
        ...filler(20),
        {
            type: "inputRequested",
            requestId: "q1",
            questions: [{ id: "a", header: "h", question: "which?", options: ["x", "y"] }],
        },
        ...filler(20),
        { type: "inputResolved", requestId: "q1" },
        ...filler(20),
    ];
    const result = compactMiddle(events, tight({ targetTokens: 300 }));
    assert.equal(result.compacted, true);
    const asked = result.events.some((e) => e.type === "inputRequested" && e.requestId === "q1");
    const answered = result.events.some((e) => e.type === "inputResolved" && e.requestId === "q1");
    assert.equal(asked, answered, "a question must not outlive its own answer");
});
test("a pair straddling the protected tail is left whole", () => {
    const events: AgentEvent[] = [
        started,
        ...filler(40),
        { type: "toolCall", id: "t9", call: { kind: "exec", command: "make" } },
        { type: "toolResult", id: "t9", isError: false },
    ];
    const result = compactMiddle(events, tight({ keepTail: 1, targetTokens: 200 }));
    const hasCall = result.events.some((e) => e.type === "toolCall" && e.id === "t9");
    const hasResult = result.events.some((e) => e.type === "toolResult" && e.id === "t9");
    assert.equal(hasCall, hasResult);
});
test("the marker is spliced where the dropped span used to be", () => {
    const events = [started, ...filler(60)];
    const result = compactMiddle(events, tight());
    const index = result.events.findIndex((e) => e.type === "contextCompacted");
    assert.ok(index > 0, "the marker must not displace the head");
    assert.ok(index < result.events.length - 1, "the marker must not be the last event");
});
test("the summary names concrete actions and warns against stale memory", () => {
    const dropped: AgentEvent[] = [
        { type: "toolCall", id: "a", call: { kind: "exec", command: "pytest -q" } },
        { type: "toolCall", id: "b", call: { kind: "editFile", path: "src/app.py" } },
        { type: "textDelta", text: "some output" },
        { type: "error", message: "transient network failure" },
    ];
    const summary = summarizeSpan(dropped);
    assert.match(summary, /pytest -q/);
    assert.match(summary, /src\/app\.py/);
    assert.match(summary, /1 error event/);
    assert.match(summary, /Re-read any file/);
});
test("a long action list is truncated rather than reproducing the transcript", () => {
    const dropped: AgentEvent[] = Array.from({ length: 100 }, (_, i) => ({
        type: "toolCall" as const,
        id: `t${i}`,
        call: { kind: "exec" as const, command: `cmd-${i}` },
    }));
    const summary = summarizeSpan(dropped);
    assert.match(summary, /and 60 more/);
});
test("compaction is recorded, never silent", () => {
    const events = [started, ...filler(60)];
    const result = compactMiddle(events, tight());
    const markers = result.events.filter((e) => e.type === "contextCompacted");
    assert.equal(markers.length, 1);
    assert.equal(result.marker.generation, 1);
});
test("generations increment across repeated compactions", () => {
    const first = compactMiddle([started, ...filler(60)], tight());
    assert.equal(compactionGeneration(first.events), 1);
    const grown = [...first.events, ...filler(60)];
    const second = compactMiddle(grown, tight(), compactionGeneration(grown) + 1);
    assert.equal(second.marker.generation, 2);
    assert.equal(compactionGeneration(second.events), 2);
});
test("a transcript that cannot be compacted reports failure instead of looping", () => {
    const events = [started, ...filler(4)];
    const result = compactMiddle(events, { keepHead: 3, keepTail: 3, targetTokens: 1 });
    assert.equal(result.compacted, false);
    assert.equal(result.marker.droppedEvents, 0);
});
test("compaction rejects an incoherent policy rather than guessing", () => {
    assert.throws(() => compactMiddle([started], { keepHead: -1, keepTail: 0, targetTokens: 10 }), /non-negative/);
    assert.throws(() => compactMiddle([started], { keepHead: 0, keepTail: 0, targetTokens: 0 }), /must be positive/);
});
test("the compacted window renumbers contiguously and survives the journal codec", () => {
    const lines = [started, ...filler(60)].map((event, seq) => ({ seq, event }));
    const { window, result } = compactJournalWindow(lines, tight());
    assert.equal(result.compacted, true);
    assert.deepEqual(window.map((l) => l.seq), window.map((_, i) => i));
    const round = parseJournal(serializeJournal(window));
    assert.deepEqual(round, window);
});
