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
} from "@bb/domain";
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
  expect(items[0].text).toContain("Delegate tool work");
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
  expect(items[0].text).toContain("consult the backing agent");
  expect(items[0].text).toContain(
    "Do not claim to have the entire BB transcript",
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
    const context = getVoiceContext(db, thread);
    expect(context.at(-2)).toEqual({
      role: "user",
      text: "Include this BB request",
    });
    expect(context.at(-1)).toEqual({
      role: "assistant",
      text: "Current task reply",
    });
    expect(JSON.stringify(context)).not.toContain("Forgotten request");
    expect(JSON.stringify(context)).not.toContain("private-image");
  } finally {
    db.$client.close();
  }
});
