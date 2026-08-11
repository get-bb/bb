import { describe, expect, it } from "vitest";
import {
  threadRewindErrorSchema,
  threadRewindPreviewSchema,
  threadRewindProviderAnchorSchema,
  threadRewindProviderCapabilityMatrix,
  threadRewindRequestSchema,
  threadRewindResultSchema,
} from "../src/thread-rewind.js";

describe("thread rewind contract", () => {
  it("keeps provider anchors disjoint", () => {
    expect(
      threadRewindProviderAnchorSchema.parse({
        provider: "codex",
        turnId: "turn-123",
      }),
    ).toEqual({ provider: "codex", turnId: "turn-123" });
    expect(
      threadRewindProviderAnchorSchema.parse({
        messageId: "message-123",
        provider: "claude-code",
      }),
    ).toEqual({ messageId: "message-123", provider: "claude-code" });
    expect(() =>
      threadRewindProviderAnchorSchema.parse({
        messageId: "message-123",
        provider: "codex",
      }),
    ).toThrow();
    expect(() =>
      threadRewindProviderAnchorSchema.parse({
        messageId: "message-123",
        provider: "claude-code",
        turnId: "codex-turn-123",
      }),
    ).toThrow();
  });

  it("defaults requests to conversation-only mode", () => {
    expect(
      threadRewindRequestSchema.parse({
        editedInput: [{ type: "text", text: "try again" }],
        target: { branchId: "branch-1", sourceSequence: 14, turnId: "turn-1" },
      }),
    ).toEqual({
      editedInput: [{ type: "text", text: "try again", mentions: [] }],
      mode: "conversation-only",
      target: { branchId: "branch-1", sourceSequence: 14, turnId: "turn-1" },
    });
  });

  it("keeps preview and result free of opaque provider anchors", () => {
    const preview = threadRewindPreviewSchema.parse({
      displacedTurnCount: 2,
      eligibility: { status: "eligible" },
      mode: "conversation-only",
      provider: "codex",
      sourceSequence: 14,
      target: { branchId: "branch-1", sourceSequence: 14, turnId: "turn-1" },
    });
    expect(preview).not.toHaveProperty("anchor");
    expect(() =>
      threadRewindPreviewSchema.parse({
        ...preview,
        anchor: { provider: "codex", turnId: "turn-1" },
      }),
    ).not.toThrow();

    expect(
      threadRewindResultSchema.parse({
        displacedTurnCount: 2,
        mode: "conversation-only",
        previousBranchId: "branch-1",
        sourceSequence: 14,
        threadId: "thread-1",
      }),
    ).toMatchObject({ mode: "conversation-only", sourceSequence: 14 });
  });

  it("requires retryability and stable failure codes", () => {
    expect(
      threadRewindErrorSchema.parse({
        code: "stale-preview",
        message: "The thread changed after preview.",
        retryable: true,
      }),
    ).toEqual({
      code: "stale-preview",
      message: "The thread changed after preview.",
      retryable: true,
    });
  });

  it("declares only exact native providers as supported", () => {
    expect(threadRewindProviderCapabilityMatrix.codex).toMatchObject({
      exactAnchor: "codex-turn-id",
      supportsConversationBranch: true,
      supportsWorkspaceRestore: false,
    });
    expect(
      threadRewindProviderCapabilityMatrix.unsupported
        .supportsConversationBranch,
    ).toBe(false);
  });
});
