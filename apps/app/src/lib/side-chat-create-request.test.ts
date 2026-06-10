import { describe, expect, it } from "vitest";
import type { Environment, PromptInput } from "@bb/domain";
import { buildSideChatCreateRequest } from "./side-chat-create-request";

const CONTEXT_SNAPSHOT: PromptInput[] = [
  {
    type: "text",
    text: "[bb side-chat context]\nUser: hi\n\nAssistant: hello",
    mentions: [],
    visibility: "agent-only",
  },
];

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
    cleanupRequestedAt: null,
    cleanupMode: null,
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...base, ...overrides };
}

describe("buildSideChatCreateRequest", () => {
  it("links the side chat to the main thread as a read-only same-project child", () => {
    const request = buildSideChatCreateRequest({
      projectId: "proj_test",
      sourceThreadId: "thr_main",
      sourceEnvironment: makeEnvironment(),
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
    });
  });

  it("runs a standard-project side chat in a fresh managed worktree off the source branch", () => {
    const request = buildSideChatCreateRequest({
      projectId: "proj_test",
      sourceThreadId: "thr_main",
      sourceEnvironment: makeEnvironment({
        branchName: "feature/source-branch",
      }),
      question: "Why this approach?",
      contextSnapshot: CONTEXT_SNAPSHOT,
      providerId: "codex",
      model: "gpt-5",
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
      projectId: "proj_test",
      sourceThreadId: "thr_main",
      sourceEnvironment: makeEnvironment({ branchName: null }),
      question: "Why this approach?",
      contextSnapshot: CONTEXT_SNAPSHOT,
      providerId: "codex",
      model: "gpt-5",
      title: "Why this approach?",
    });

    expect(request.environment).toMatchObject({
      type: "host",
      hostId: "hst_local",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });

  it("falls back to the personal workspace only when the source has no host", () => {
    const request = buildSideChatCreateRequest({
      projectId: "proj_personal",
      sourceThreadId: "thr_main",
      sourceEnvironment: null,
      question: "Why this approach?",
      contextSnapshot: CONTEXT_SNAPSHOT,
      providerId: "codex",
      model: "gpt-5",
      title: "Why this approach?",
    });

    expect(request.environment).toEqual({
      type: "host",
      workspace: { type: "personal" },
    });
  });

  it("puts the visible question first and the agent-only snapshot after it", () => {
    const request = buildSideChatCreateRequest({
      projectId: "proj_test",
      sourceThreadId: "thr_main",
      sourceEnvironment: makeEnvironment(),
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
      sourceEnvironment: makeEnvironment(),
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
