import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACP_PROTOCOL_VERSION,
  AcpTranslator,
  decodeToolCall,
  isTruncatedStop,
  stopReasonToStatus,
  type SessionNotification,
  type StopReason,
} from "./acp.ts";
import { parseJournal, serializeJournal, type AgentEvent, type JournalLine } from "../events/events.ts";

const sess = (update: SessionNotification["update"]): SessionNotification => ({
  sessionId: "sess_abc123def456",
  update,
});

test("protocol version matches the published v1 major", () => {
  assert.equal(ACP_PROTOCOL_VERSION, 1);
});

test("agent message chunks become text deltas and thoughts become reasoning deltas", () => {
  const t = new AcpTranslator();
  assert.deepEqual(
    t.translate(
      sess({
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_agent_c42b9",
        content: { type: "text", text: "I'll analyze your code" },
      }),
    ),
    [{ type: "textDelta", text: "I'll analyze your code" }],
  );
  assert.deepEqual(
    t.translate(
      sess({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "checking imports" },
      }),
    ),
    [{ type: "reasoningDelta", text: "checking imports" }],
  );
});

test("non-text content blocks and empty text produce no timeline event", () => {
  const t = new AcpTranslator();
  assert.deepEqual(
    t.translate(sess({ sessionUpdate: "agent_message_chunk", content: { type: "image", data: "..." } })),
    [],
  );
  assert.deepEqual(
    t.translate(sess({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } })),
    [],
  );
});

test("a tool call emits once even when the agent re-sends it", () => {
  const t = new AcpTranslator();
  const open = sess({
    sessionUpdate: "tool_call",
    toolCallId: "call_001",
    title: "Run tests",
    kind: "execute",
    status: "pending",
    rawInput: { command: "npm test" },
  });

  assert.deepEqual(t.translate(open), [
    { type: "toolCall", id: "call_001", call: { kind: "exec", command: "npm test" } },
  ]);
  // Redundant re-announcement: no duplicate row in the transcript.
  assert.deepEqual(t.translate(open), []);
});

test("a tool call settles exactly once, and failure is preserved", () => {
  const t = new AcpTranslator();
  t.translate(
    sess({ sessionUpdate: "tool_call", toolCallId: "c1", title: "Read", kind: "read", status: "pending" }),
  );

  assert.deepEqual(t.translate(sess({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "in_progress" })), []);
  assert.deepEqual(t.translate(sess({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "failed" })), [
    { type: "toolResult", id: "c1", isError: true },
  ]);
  // A late duplicate terminal update must not double-count.
  assert.deepEqual(t.translate(sess({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" })), []);
});

test("a tool call that opens already-terminal emits both events in order", () => {
  const t = new AcpTranslator();
  const events = t.translate(
    sess({
      sessionUpdate: "tool_call",
      toolCallId: "c9",
      title: "Glob",
      kind: "search",
      status: "completed",
      rawInput: { pattern: "**/*.ts" },
    }),
  );
  assert.equal(events.length, 2);
  assert.equal(events[0]?.type, "toolCall");
  assert.deepEqual(events[1], { type: "toolResult", id: "c9", isError: false });
});

test("decodeToolCall maps unambiguous shapes and refuses to guess otherwise", () => {
  assert.deepEqual(decodeToolCall("Run", "execute", { command: "ls" }), { kind: "exec", command: "ls" });
  assert.deepEqual(decodeToolCall("Read", "read", { file_path: "/a.ts" }), { kind: "readFile", path: "/a.ts" });
  assert.deepEqual(decodeToolCall("Edit", "edit", { path: "/a.ts", old_string: "x", new_string: "y" }), {
    kind: "editFile",
    path: "/a.ts",
    oldString: "x",
    newString: "y",
  });
  assert.deepEqual(decodeToolCall("Write", "edit", { path: "/a.ts", content: "hi" }), {
    kind: "writeFile",
    path: "/a.ts",
    content: "hi",
  });
  assert.deepEqual(decodeToolCall("Fetch", "fetch", { url: "https://x.dev" }), {
    kind: "webFetch",
    url: "https://x.dev",
  });

  // kind says execute but there is no command: preserve, do not invent.
  assert.deepEqual(decodeToolCall("Mystery", "execute", { foo: 1 }), {
    kind: "unknown",
    name: "Mystery",
    input: { foo: 1 },
  });
  // No kind at all (the field is optional in the schema).
  assert.deepEqual(decodeToolCall("Thing", undefined, undefined), { kind: "unknown", name: "Thing" });
});

test("every ACP stop reason maps to a status, and truncation is never success", () => {
  const all: StopReason[] = ["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"];
  for (const reason of all) {
    const status = stopReasonToStatus(reason);
    assert.ok(["completed", "interrupted", "errored"].includes(status));
    if (isTruncatedStop(reason)) {
      assert.equal(status, "errored", `${reason} must not read as success`);
    }
  }
  assert.equal(stopReasonToStatus("end_turn"), "completed");
  assert.equal(stopReasonToStatus("cancelled"), "interrupted");
});

test("finish carries the truncation reason into the done event", () => {
  const t = new AcpTranslator();
  const done = t.finish("max_tokens", "sess_1");
  assert.deepEqual(done, {
    type: "done",
    status: "errored",
    error: "turn truncated: max_tokens",
    sessionId: "sess_1",
  });
  assert.deepEqual(t.finish("end_turn"), { type: "done", status: "completed" });
});

test("a plan update becomes a todo tool call with completion carried over", () => {
  const t = new AcpTranslator();
  const [event] = t.translate(
    sess({
      sessionUpdate: "plan",
      entries: [
        { content: "Check for syntax errors", priority: "high", status: "completed" },
        { content: "Suggest improvements", priority: "low", status: "pending" },
      ],
    }),
  );
  assert.equal(event?.type, "toolCall");
  assert.deepEqual(event?.type === "toolCall" ? event.call : null, {
    kind: "todo",
    items: [
      { text: "Check for syntax errors", done: true },
      { text: "Suggest improvements", done: false },
    ],
  });
});

test("usage_update records context occupancy without inventing an output split", () => {
  const t = new AcpTranslator();
  assert.deepEqual(
    t.translate(sess({ sessionUpdate: "usage_update", used: 53000, size: 200000 })),
    [{ type: "usage", inputTokens: 53000, outputTokens: 0 }],
  );
});

test("UI-only and unknown future updates are dropped, not thrown on", () => {
  const t = new AcpTranslator();
  assert.deepEqual(t.translate(sess({ sessionUpdate: "available_commands_update", availableCommands: [] })), []);
  assert.deepEqual(t.translate(sess({ sessionUpdate: "current_mode_update", currentModeId: "ask" })), []);
  assert.deepEqual(t.translate(sess({ sessionUpdate: "some_future_variant_v3" })), []);
  assert.deepEqual(
    t.translate(sess({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "hi" } })),
    [],
  );
});

test("a full ACP turn round-trips through the journal", () => {
  const t = new AcpTranslator();
  const events: AgentEvent[] = [
    {
      type: "sessionStarted",
      harness: "opencode",
      model: "claude-opus-5",
      cwd: "/repo",
      sessionId: "sess_abc123def456",
      assistantMessageId: "m0",
      execution: { target: "local", ref: "/repo" },
      fidelity: "event",
    },
    ...t.translate(sess({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working" } })),
    ...t.translate(
      sess({
        sessionUpdate: "tool_call",
        toolCallId: "call_001",
        title: "Run tests",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "npm test" },
      }),
    ),
    ...t.translate(sess({ sessionUpdate: "tool_call_update", toolCallId: "call_001", status: "completed" })),
    t.finish("end_turn", "sess_abc123def456"),
  ];

  const lines: JournalLine[] = events.map((event, i) => ({ seq: i + 1, event }));
  const round = parseJournal(serializeJournal(lines));
  assert.deepEqual(round, lines);
  assert.equal(round.at(-1)?.event.type, "done");
});
