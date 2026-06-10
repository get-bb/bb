import { describe, expect, it } from "vitest";
import type { PromptInput } from "@bb/domain";
import { buildSideChatCreateRequest } from "./side-chat-create-request";

const CONTEXT_SNAPSHOT: PromptInput[] = [
  {
    type: "text",
    text: "[bb side-chat context]\nUser: hi\n\nAssistant: hello",
    mentions: [],
    visibility: "agent-only",
  },
];

describe("buildSideChatCreateRequest", () => {
  it("links the side chat to the main thread as a read-only personal child", () => {
    const request = buildSideChatCreateRequest({
      projectId: "proj_test",
      sourceThreadId: "thr_main",
      question: "Why this approach?",
      contextSnapshot: CONTEXT_SNAPSHOT,
      providerId: "codex",
      model: "gpt-5",
      title: "Why this approach?",
    });

    expect(request).toMatchObject({
      projectId: "proj_test",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "readonly",
      parentThreadId: "thr_main",
      childOrigin: "side-chat",
      startedOnBehalfOf: null,
      environment: { type: "host", workspace: { type: "personal" } },
    });
  });

  it("puts the visible question first and the agent-only snapshot after it", () => {
    const request = buildSideChatCreateRequest({
      projectId: "proj_test",
      sourceThreadId: "thr_main",
      question: "Why this approach?",
      contextSnapshot: CONTEXT_SNAPSHOT,
      providerId: "codex",
      model: "gpt-5",
      title: "Why this approach?",
    });

    expect(request.input).toHaveLength(2);
    const [first, second] = request.input;
    expect(first).toEqual({
      type: "text",
      text: "Why this approach?",
      mentions: [],
    });
    expect(first?.type === "text" ? first.visibility : "set").toBeUndefined();
    expect(second).toEqual(CONTEXT_SNAPSHOT[0]);
  });

  it("supports an empty context snapshot (question-only first turn)", () => {
    const request = buildSideChatCreateRequest({
      projectId: "proj_test",
      sourceThreadId: "thr_main",
      question: "Standalone question",
      contextSnapshot: [],
      providerId: "codex",
      model: "gpt-5",
      title: "Standalone question",
    });

    expect(request.input).toHaveLength(1);
    expect(request.input[0]).toMatchObject({
      type: "text",
      text: "Standalone question",
    });
  });
});
