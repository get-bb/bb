import assert from "node:assert/strict";
import { test } from "vitest";
import { closeAborted, isAborted, JournalParseError, parseJournal, serializeJournal, type AgentEvent, type JournalLine, } from "./events.ts";
const line = (seq: number, event: AgentEvent): JournalLine => ({ seq, event });
const START: AgentEvent = {
    type: "sessionStarted",
    harness: "opencode",
    model: "claude-opus-5",
    cwd: "/repo",
    sessionId: "s1",
    assistantMessageId: "m0",
    execution: { target: "modal", ref: "sb-123" },
    fidelity: "event",
};
const DONE: AgentEvent = { type: "done", status: "completed", sessionId: "s1" };
test("a journal round-trips through serialize/parse unchanged", () => {
    const lines = [
        line(0, START),
        line(1, { type: "textDelta", text: "hello" }),
        line(2, { type: "toolCall", id: "t1", call: { kind: "exec", command: "cargo test" } }),
        line(3, { type: "toolResult", id: "t1", isError: false }),
        line(4, DONE),
    ];
    assert.deepEqual(parseJournal(serializeJournal(lines)), lines);
});
test("serialized journals are newline-delimited and append-safe", () => {
    const text = serializeJournal([line(0, START), line(1, DONE)]);
    assert.ok(text.endsWith("\n"), "a journal must end with a newline so the next append is clean");
    assert.equal(text.trimEnd().split("\n").length, 2);
    for (const raw of text.trimEnd().split("\n")) {
        assert.doesNotThrow(() => JSON.parse(raw), "each line must parse independently");
    }
});
test("blank lines are skipped rather than treated as corruption", () => {
    const text = `${JSON.stringify(line(0, START))}\n\n${JSON.stringify(line(1, DONE))}\n`;
    assert.equal(parseJournal(text).length, 2);
});
test("a torn final line is tolerated — that is the crash case", () => {
    const good = JSON.stringify(line(0, START));
    const torn = '{"seq":1,"event":{"type":"textDel';
    const parsed = parseJournal(`${good}\n${torn}`);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.event.type, "sessionStarted");
});
test("corruption anywhere but the final line throws with a line number", () => {
    const text = `{"seq":0,"event":{"type":"textDel\n${JSON.stringify(line(1, DONE))}\n`;
    assert.throws(() => parseJournal(text), (error: unknown) => error instanceof JournalParseError && error.lineNumber === 1);
});
test("structurally invalid lines are rejected, not silently dropped", () => {
    const cases: Array<[
        string,
        string
    ]> = [
        ["not an object", "[1,2,3]"],
        ["missing seq", '{"event":{"type":"done","status":"completed"}}'],
        ["non-integer seq", '{"seq":1.5,"event":{"type":"done","status":"completed"}}'],
        ["missing event.type", '{"seq":0,"event":{}}'],
        ["unknown event type", '{"seq":0,"event":{"type":"telepathy"}}'],
    ];
    for (const [label, raw] of cases) {
        assert.throws(() => parseJournal(`${raw}\n`), JournalParseError, label);
    }
});
test("isAborted is true until a terminal done arrives", () => {
    assert.equal(isAborted([]), true, "an empty journal is an aborted run, not a finished one");
    assert.equal(isAborted([line(0, START)]), true);
    assert.equal(isAborted([line(0, START), line(1, DONE)]), false);
});
test("closeAborted appends exactly one synthetic terminal event", () => {
    const crashed = [line(0, START), line(1, { type: "textDelta", text: "partial" })];
    const closed = closeAborted(crashed);
    assert.equal(closed.length, 3);
    assert.equal(closed[2]?.seq, 2, "the synthetic event continues the seq sequence");
    const last = closed[2]?.event;
    assert.equal(last?.type, "done");
    assert.equal(last?.type === "done" ? last.status : null, "errored");
    assert.equal(isAborted(closed), false);
});
test("closeAborted is idempotent and never rewrites a clean journal", () => {
    const clean = [line(0, START), line(1, DONE)];
    assert.deepEqual(closeAborted(clean), clean);
    assert.deepEqual(closeAborted(closeAborted(clean)), clean);
    const crashed = [line(0, START)];
    const once = closeAborted(crashed);
    assert.deepEqual(closeAborted(once), once);
});
test("closeAborted does not mutate its input", () => {
    const crashed = [line(0, START)];
    closeAborted(crashed);
    assert.equal(crashed.length, 1);
});
test("an empty journal closes to a single recovered done", () => {
    const closed = closeAborted([]);
    assert.equal(closed.length, 1);
    assert.equal(closed[0]?.seq, 0);
});
test("the fidelity and execution extensions survive a round trip", () => {
    const [parsed] = parseJournal(serializeJournal([line(0, START)]));
    const event = parsed?.event;
    assert.equal(event?.type, "sessionStarted");
    if (event?.type !== "sessionStarted")
        return;
    assert.equal(event.fidelity, "event");
    assert.deepEqual(event.execution, { target: "modal", ref: "sb-123" });
});
test("a journal written before the Opulent extensions still parses", () => {
    const legacy = '{"seq":0,"event":{"type":"sessionStarted","harness":"claude-code","model":"opus","cwd":"/r","sessionId":"s","assistantMessageId":"m"}}\n';
    const parsed = parseJournal(legacy);
    assert.equal(parsed.length, 1);
    const event = parsed[0]?.event;
    assert.equal(event?.type === "sessionStarted" ? event.fidelity : "x", undefined);
});
