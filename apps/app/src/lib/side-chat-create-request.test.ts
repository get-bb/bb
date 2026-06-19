import { describe, expect, it } from "vitest";
import type { Environment } from "@bb/domain";
import type { TimelineConversationRow } from "@bb/server-contract";
import {
  buildSideChatCreateRequest,
  buildSideChatMessageInput,
  resolveSideChatReplyReference,
} from "./side-chat-create-request";

let nextRowSeq = 0;

function conversationRow(
  role: TimelineConversationRow["role"],
  text: string,
): TimelineConversationRow {
  const seq = (nextRowSeq += 1);
  const base = {
    id: `row_${seq}`,
    threadId: "thr_main",
    turnId: "turn_1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
    kind: "conversation" as const,
    text,
    attachments: null,
  };
  return role === "user"
    ? {
        ...base,
        role: "user",
        initiator: "user",
        senderThreadId: null,
        systemMessageKind: "unlabeled",
        systemMessageSubject: null,
        turnRequest: { kind: "message", status: "accepted" },
        mentions: [],
      }
    : { ...base, role: "assistant", turnRequest: null };
}

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  const base: Environment = {
    id: "env_source",
    name: null,
    projectId: "proj_test",
    hostId: "hst_local",
    path: "/Users/dev/Projects/bb",
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    branchName: "feature/source-branch",
    baseBranch: "main",
    defaultBranch: "main",
    mergeBaseBranch: null,
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...base, ...overrides };
}

describe("resolveSideChatReplyReference", () => {
  it("returns null when the anchor IS the parent's last conversation message", () => {
    const anchor = "Here's the plan.";
    const reference = resolveSideChatReplyReference({
      anchorMessageText: anchor,
      sourceTimelineRows: [
        conversationRow("user", "What's the plan?"),
        conversationRow("assistant", anchor),
      ],
    });
    expect(reference).toBeNull();
  });

  it("returns the anchor text when it is an earlier (not last) message", () => {
    const anchor = "Earlier idea worth revisiting.";
    const reference = resolveSideChatReplyReference({
      anchorMessageText: anchor,
      sourceTimelineRows: [
        conversationRow("assistant", anchor),
        conversationRow("user", "Actually let's do something else."),
        conversationRow("assistant", "Sounds good, doing the other thing."),
      ],
    });
    expect(reference).toBe(anchor);
  });

  it("finds the last conversation message nested inside a turn row", () => {
    const anchor = "Nested earlier reply.";
    const reference = resolveSideChatReplyReference({
      anchorMessageText: anchor,
      sourceTimelineRows: [
        {
          id: "turn_row",
          threadId: "thr_main",
          turnId: "turn_1",
          sourceSeqStart: 1,
          sourceSeqEnd: 9,
          startedAt: 1,
          createdAt: 1,
          kind: "turn",
          status: "completed",
          summaryCount: 0,
          completedAt: 9,
          children: [
            conversationRow("assistant", anchor),
            conversationRow("user", "And the latest message."),
          ],
        },
      ],
    });
    // The anchor is not the last (the nested user message is), so it surfaces.
    expect(reference).toBe(anchor);
  });

  it("returns null for an empty anchor or empty timeline", () => {
    expect(
      resolveSideChatReplyReference({
        anchorMessageText: "   ",
        sourceTimelineRows: [conversationRow("assistant", "hi")],
      }),
    ).toBeNull();
    expect(
      resolveSideChatReplyReference({
        anchorMessageText: "anything",
        sourceTimelineRows: [],
      }),
    ).toBe("anything");
  });
});

describe("buildSideChatCreateRequest", () => {
  it("builds a first-message create request for a read-only side chat", () => {
    const request = buildSideChatCreateRequest({
      input: [{ type: "text", text: "Why this approach?", mentions: [] }],
      projectId: "proj_test",
      sourceThreadId: "thr_main",
      sourceEnvironment: makeEnvironment(),
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      serviceTier: "fast",
      sourceSeqEnd: 7,
      title: "Why this approach?",
    });

    expect(request).toMatchObject({
      projectId: "proj_test",
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      serviceTier: "fast",
      permissionMode: "readonly",
      sourceSeqEnd: 7,
      sourceThreadId: "thr_main",
      originKind: "side-chat",
      startedOnBehalfOf: null,
      input: [{ type: "text", text: "Why this approach?", mentions: [] }],
      environment: {
        type: "host",
        hostId: "hst_local",
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "named", name: "feature/source-branch" },
        },
      },
    });
  });

  it("links the side chat to the main thread as a read-only same-project child", () => {
    const request = buildSideChatCreateRequest({
      input: [{ type: "text", text: "Why this approach?", mentions: [] }],
      projectId: "proj_test",
      sourceThreadId: "thr_main",
      sourceEnvironment: makeEnvironment(),
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      serviceTier: "fast",
      title: "Why this approach?",
    });

    expect(request).toMatchObject({
      projectId: "proj_test",
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      serviceTier: "fast",
      permissionMode: "readonly",
      sourceThreadId: "thr_main",
      originKind: "side-chat",
      startedOnBehalfOf: null,
    });
  });

  it("runs a standard-project side chat in a fresh managed worktree off the source branch", () => {
    const request = buildSideChatCreateRequest({
      input: [{ type: "text", text: "Why this approach?", mentions: [] }],
      projectId: "proj_test",
      sourceThreadId: "thr_main",
      sourceEnvironment: makeEnvironment({
        branchName: "feature/source-branch",
      }),
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      serviceTier: "fast",
      title: "Why this approach?",
    });

    // NOT the personal workspace — a personal workspace is rejected outside the
    // personal project (assertProjectWorkspaceCompatibility), so a standard
    // project must get its own same-project managed worktree.
    expect(request.environment).toEqual({
      type: "host",
      hostId: "hst_local",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "feature/source-branch" },
      },
    });
  });

  it("defers to the source's default branch when no branch is known", () => {
    const request = buildSideChatCreateRequest({
      input: [{ type: "text", text: "Why this approach?", mentions: [] }],
      projectId: "proj_test",
      sourceThreadId: "thr_main",
      sourceEnvironment: makeEnvironment({ branchName: null }),
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      serviceTier: "fast",
      title: "Why this approach?",
    });

    expect(request.environment).toMatchObject({
      type: "host",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });

  it("falls back to the personal workspace only when the source has no host", () => {
    const request = buildSideChatCreateRequest({
      input: [{ type: "text", text: "Why this approach?", mentions: [] }],
      projectId: "proj_personal",
      sourceThreadId: "thr_main",
      sourceEnvironment: null,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      serviceTier: undefined,
      title: "Why this approach?",
    });

    expect(request.environment).toEqual({
      type: "host",
      workspace: { type: "personal" },
    });
  });

  it("keeps a personal workspace for a personal-project source even though it has a host", () => {
    // Regression: a personal-project thread has a host but a personal workspace.
    // The resolver previously saw the host and built a managed worktree, which
    // the server rejects ("Personal project threads must use a personal
    // workspace"). It must keep the personal workspace, carrying the host.
    const request = buildSideChatCreateRequest({
      input: [{ type: "text", text: "Why this approach?", mentions: [] }],
      projectId: "proj_personal",
      sourceThreadId: "thr_main",
      sourceEnvironment: makeEnvironment({
        projectId: "proj_personal",
        workspaceProvisionType: "personal",
      }),
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      serviceTier: "fast",
      title: "Why this approach?",
    });

    expect(request.environment).toEqual({
      type: "host",
      hostId: "hst_local",
      workspace: { type: "personal" },
    });
  });
});

describe("buildSideChatMessageInput", () => {
  it("sends a question-only first turn when there is no reply reference", () => {
    const input = buildSideChatMessageInput({
      includeReplyReference: true,
      replyReference: null,
      visibleInput: [
        { type: "text", text: "Standalone question", mentions: [] },
      ],
    });

    expect(input).toHaveLength(1);
    expect(input[0]).toEqual({
      type: "text",
      text: "Standalone question",
      mentions: [],
    });
  });

  it("prepends an agent-only reply reference before the visible question", () => {
    const input = buildSideChatMessageInput({
      includeReplyReference: true,
      replyReference: "An earlier message worth discussing.",
      visibleInput: [{ type: "text", text: "Why this approach?", mentions: [] }],
    });

    expect(input).toHaveLength(2);
    const [reference, question] = input;
    expect(reference).toMatchObject({
      type: "text",
      visibility: "agent-only",
    });
    expect(reference?.type === "text" ? reference.text : "").toContain(
      "An earlier message worth discussing.",
    );
    // The visible question carries no agent-only marker (it renders in the UI).
    expect(question).toEqual({
      type: "text",
      text: "Why this approach?",
      mentions: [],
    });
  });

  it("preserves prompt mentions on the visible question", () => {
    const input = buildSideChatMessageInput({
      includeReplyReference: true,
      visibleInput: [
        {
          type: "text",
          text: "/goal Make side chat match the main composer",
          mentions: [
            {
              start: 0,
              end: "/goal".length,
              resource: {
                kind: "command",
                trigger: "/",
                name: "goal",
                source: "command",
                origin: "user",
                label: "goal",
                argumentHint: null,
              },
            },
          ],
        },
      ],
      replyReference: "Earlier context",
    });

    expect(input).toHaveLength(2);
    expect(input[1]).toEqual({
      type: "text",
      text: "/goal Make side chat match the main composer",
      mentions: [
        {
          start: 0,
          end: "/goal".length,
          resource: {
            kind: "command",
            trigger: "/",
            name: "goal",
            source: "command",
            origin: "user",
            label: "goal",
            argumentHint: null,
          },
        },
      ],
    });
  });

  it("does not repeat the reply reference after the first user-visible turn", () => {
    const input = buildSideChatMessageInput({
      includeReplyReference: false,
      replyReference: "Earlier context",
      visibleInput: [{ type: "text", text: "Follow up", mentions: [] }],
    });

    expect(input).toEqual([{ type: "text", text: "Follow up", mentions: [] }]);
  });

  it("preserves non-text visible input chunks", () => {
    const input = buildSideChatMessageInput({
      includeReplyReference: true,
      replyReference: "Earlier context",
      visibleInput: [
        { type: "text", text: "Review this file", mentions: [] },
        {
          type: "localFile",
          path: "thread-storage/uploads/example.md",
          name: "example.md",
          sizeBytes: 123,
          mimeType: "text/markdown",
        },
      ],
    });

    expect(input).toEqual([
      expect.objectContaining({
        type: "text",
        visibility: "agent-only",
      }),
      { type: "text", text: "Review this file", mentions: [] },
      {
        type: "localFile",
        path: "thread-storage/uploads/example.md",
        name: "example.md",
        sizeBytes: 123,
        mimeType: "text/markdown",
      },
    ]);
  });
});
