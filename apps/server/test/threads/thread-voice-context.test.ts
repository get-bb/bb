import { expect, it } from "vitest";
import {
  createProject,
  createThread,
  insertEvents,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  threadVoiceContextSchema,
  THREAD_CONTEXT_CLEAR_OPERATION,
  type ThreadEventItem,
} from "@bb/domain";
import { voiceToolResult } from "../../src/services/threads/thread-voice-tools.js";
import {
  buildVoiceContext,
  getVoiceContext,
} from "../../src/services/threads/thread-voice-context.js";

it("preserves recent conversation order and includes an extractive task brief", () => {
  const messages = [
    { role: "user" as const, text: "Build native voice" },
    { role: "assistant" as const, text: "Voice is deployed" },
    { role: "user" as const, text: "Put the button beside the mic" },
  ];
  const items = buildVoiceContext("Voice in BB", messages);
  expect(items[0]).toMatchObject({
    role: "developer",
    text: expect.stringContaining("existing BB thread"),
  });
  expect(items[0].text).toContain(
    "Original request excerpt:\nBuild native voice",
  );
  expect(items[0].text).toContain(
    "Latest request excerpt:\nPut the button beside the mic",
  );
  expect(items[0].text).toContain("backing coding agent");
  expect(items.slice(1)).toEqual(messages);
});

it("bounds multilingual histories without breaking Unicode or losing the latest request", () => {
  const items = buildVoiceContext(
    null,
    Array.from({ length: 100 }, (_, index) => ({
      role: "user",
      text: `${index}: ${"你好🌿".repeat(2000)}`,
    })),
  );
  expect(threadVoiceContextSchema.safeParse(items).success).toBe(true);
  expect(items.at(-1)?.text.startsWith("99:")).toBe(true);
  expect(items.every((item) => !item.text.includes("\uFFFD"))).toBe(true);
});

it("gives a new thread identity and an honest fallback for missing details", () => {
  const items = buildVoiceContext(null, []);
  expect(items).toHaveLength(1);
  expect(items[0].text).toContain("backing coding agent");
  expect(items[0].text).toContain(
    "bounded selection rather than the entire BB transcript",
  );
});

it("uses BB history after context clearing and omits attachments", () => {
  const db = createMigratedConnection();
  try {
    const host = upsertHost(db, noopNotifier, { name: "voice-test" });
    const { project } = createProject(db, noopNotifier, {
      name: "voice-test",
      source: { type: "local_path", hostId: host.id, path: "/tmp/voice-test" },
    });
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "test-provider",
    });
    const request = (sequence: number, text: string) => ({
      threadId: thread.id,
      sequence,
      type: "client/turn/requested" as const,
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: encodeClientTurnRequestIdNumber({ value: sequence }),
        senderThreadId: null,
        input: [
          { type: "text", text, mentions: [] },
          { type: "image", url: "https://example.com/private-image" },
        ],
        target: { kind: "new-turn" },
        execution: {
          model: "test-model",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      }),
    });
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 0,
        providerThreadId: "native-test",
        type: "item/completed",
        scope: turnScope("old-turn"),
        itemId: "old-tool",
        itemKind: "commandExecution",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "old-tool",
            command: "cat old.txt",
            cwd: "/tmp",
            status: "completed",
            approvalStatus: null,
            aggregatedOutput: "Forgotten tool output",
            exitCode: 0,
          },
        }),
      },
      request(1, "Forgotten request"),
      {
        threadId: thread.id,
        sequence: 2,
        type: "system/operation",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({
          operation: THREAD_CONTEXT_CLEAR_OPERATION,
          operationId: "clear",
          status: "completed",
          message: "Fresh context",
        }),
      },
      request(3, "Include this BB request"),
      {
        threadId: thread.id,
        sequence: 4,
        providerThreadId: "native-test",
        type: "item/completed",
        scope: turnScope("voice-turn"),
        itemId: "reply",
        itemKind: "agentMessage",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: "reply",
            text: "Current task reply",
          },
        }),
      },
    ]);
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 5,
        providerThreadId: "native-test",
        type: "item/completed",
        scope: turnScope("voice-turn"),
        itemId: "tool",
        itemKind: "commandExecution",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "tool",
            command: "cat source.txt",
            cwd: "/tmp",
            status: "completed",
            approvalStatus: null,
            aggregatedOutput: "Full source content",
            exitCode: 0,
          },
        }),
      },
    ]);
    const context = getVoiceContext(db, thread);
    expect(context.find((item) => item.role === "user")).toEqual({
      role: "user",
      text: "Include this BB request",
    });
    expect(context.find((item) => item.text === "Current task reply")).toEqual({
      role: "assistant",
      text: "Current task reply",
    });
    expect(JSON.stringify(context)).not.toContain("Forgotten request");
    expect(JSON.stringify(context)).not.toContain("private-image");
    expect(JSON.stringify(context)).not.toContain("Forgotten tool output");
    expect(context.at(-1)?.text).toContain("Full source content");
  } finally {
    db.$client.close();
  }
});

function commandResult(
  sequence: number,
  command: string,
  output: string,
  failed = false,
) {
  return voiceToolResult(
    {
      type: "commandExecution",
      id: `tool-${sequence}`,
      command,
      cwd: "/tmp",
      status: failed ? "failed" : "completed",
      approvalStatus: null,
      aggregatedOutput: output,
      exitCode: failed ? 1 : 0,
    },
    sequence,
  );
}

it("retains a full source result ahead of huge listings and preserves failure details", () => {
  const source =
    "# Conversation source\n" +
    "A source paragraph with precise quotes and timestamps.\n".repeat(380);
  const tools = [
    commandResult(
      2,
      "rg --files /workspace",
      "/workspace/path/to/file\n".repeat(3000),
    ),
    commandResult(
      3,
      "cat AGENTS.md; tool --help",
      "Setup instructions\n".repeat(5000),
    ),
    commandResult(4, "cat conversation.md; tool --help", source),
    commandResult(
      5,
      "sed -n '1,28p' conversation.md; transcript",
      "Note excerpt\n".repeat(200) + "ERROR: readonly database",
      true,
    ),
    commandResult(6, "transcript session", "ERROR: no transcript found", true),
  ];
  const context = buildVoiceContext(
    "Conversation",
    [
      { role: "user", text: "Expand the note using exact source quotes" },
      { role: "assistant", text: "I have read the note" },
    ],
    tools,
  );
  const text = context.map((item) => item.text).join("");
  expect(text).toContain(source);
  expect(text).toContain("ERROR: readonly database");
  expect(text).toContain("ERROR: no transcript found");
  expect(text).toContain("exit code 1");
  expect(text).toContain("omitted");
  expect(threadVoiceContextSchema.safeParse(context).success).toBe(true);
});

it("includes complete structured tool results and diffs but omits binary payloads", () => {
  const structured: ThreadEventItem = {
    type: "toolCall",
    id: "call",
    tool: "read_record",
    arguments: { id: "record" },
    status: "completed",
    result: {
      content: [
        { type: "text", text: "Original source text" },
        { type: "image", data: "private-binary-data" },
      ],
      structuredContent: { path: "/tmp/report.md", value: 42 },
    },
  };
  const diff: ThreadEventItem = {
    type: "fileChange",
    id: "diff",
    status: "completed",
    approvalStatus: null,
    changes: [{ path: "/tmp/report.md", kind: "update", diff: "-old\n+new" }],
  };
  const context = buildVoiceContext(
    null,
    [],
    [voiceToolResult(structured, 1), voiceToolResult(diff, 2)],
  );
  const text = context.map((item) => item.text).join("");
  expect(text).toContain("Original source text");
  expect(text).toContain('"value":42');
  expect(text).toContain("/tmp/report.md");
  expect(text).toContain("-old\n+new");
  expect(text).not.toContain("private-binary-data");
});

it("bounds many large Unicode results and labels already truncated stored output", () => {
  const tools = Array.from({ length: 100 }, (_, i) =>
    commandResult(i, "cat source.txt", `${i}: ${"你好🌿".repeat(5000)}`),
  );
  const last = tools.at(-1);
  if (last) last.truncated = true;
  const context = buildVoiceContext(null, [], tools);
  expect(threadVoiceContextSchema.safeParse(context).success).toBe(true);
  const text = context.map((item) => item.text).join("");
  expect(text).toContain("Event 99:");
  expect(text).toContain("stored output was already truncated");
  expect(text).not.toContain("\uFFFD");
});
