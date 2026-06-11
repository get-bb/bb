import type { Environment, Thread } from "@bb/domain";
import type { TimelineConversationRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { buildForkThreadRequest, isThreadForkable } from "./fork-thread-request";

let nextRowSeq = 0;

function conversationRow(
  role: TimelineConversationRow["role"],
  text: string,
): TimelineConversationRow {
  const seq = (nextRowSeq += 1);
  const base = {
    id: `row_${seq}`,
    threadId: "thr_source",
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
        turnRequest: { kind: "message", status: "accepted" },
        mentions: [],
      }
    : { ...base, role: "assistant", turnRequest: null };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  const base: Thread = {
    id: "thr_source",
    projectId: "proj_test",
    environmentId: "env_source",
    automationId: null,
    providerId: "codex",
    title: "Investigate flaky test",
    titleFallback: null,
    status: "idle",
    parentThreadId: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...base, ...overrides };
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
    cleanupRequestedAt: null,
    cleanupMode: null,
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...base, ...overrides };
}

describe("buildForkThreadRequest", () => {
  it("branches a managed worktree from the source's current branch by name", () => {
    const request = buildForkThreadRequest({
      sourceThread: makeThread(),
      sourceEnvironment: makeEnvironment({
        branchName: "feature/source-branch",
      }),
      anchorMessageText: "Here is the failing stack trace.",
      sourceTimelineRows: [],
      model: "gpt-5",
      permissionMode: "readonly",
    });

    expect(request).not.toBeNull();
    expect(request?.environment).toEqual({
      type: "host",
      hostId: "hst_local",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "feature/source-branch" },
      },
    });
  });

  it("uses a personal workspace (not a managed worktree) for a personal-workspace source", () => {
    // A personal-project thread has a host but its workspace is personal; the
    // server rejects a managed worktree there ("Personal project threads must
    // use a personal workspace"), so the fork must stay on a personal workspace.
    const request = buildForkThreadRequest({
      sourceThread: makeThread({ projectId: "proj_personal" }),
      sourceEnvironment: makeEnvironment({
        projectId: "proj_personal",
        workspaceProvisionType: "personal",
      }),
      anchorMessageText: "Reply only with ok.",
      sourceTimelineRows: [],
      model: "gpt-5",
      permissionMode: "readonly",
    });

    expect(request).not.toBeNull();
    expect(request?.environment).toEqual({
      type: "host",
      hostId: "hst_local",
      workspace: { type: "personal" },
    });
  });

  it("carries lineage, anchor input, provider and execution options", () => {
    const request = buildForkThreadRequest({
      sourceThread: makeThread({ id: "thr_source", providerId: "codex" }),
      sourceEnvironment: makeEnvironment(),
      anchorMessageText: "Anchor text",
      sourceTimelineRows: [],
      model: "gpt-5",
      permissionMode: "workspace-write",
    });

    expect(request).toMatchObject({
      projectId: "proj_test",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "workspace-write",
      parentThreadId: "thr_source",
      childOrigin: "fork",
      startedOnBehalfOf: {
        initiator: "agent",
        senderThreadId: "thr_source",
      },
    });
    expect(request?.input).toEqual([
      { type: "text", text: "Anchor text", mentions: [] },
    ]);
    // The boundary requires senderThreadId === parentThreadId for a fork.
    expect(request?.startedOnBehalfOf?.senderThreadId).toBe(
      request?.parentThreadId,
    );
  });

  it("omits the title so the fork auto-titles from its first turn (no \"(fork)\" suffix)", () => {
    const request = buildForkThreadRequest({
      sourceThread: makeThread({ title: "Investigate flaky test" }),
      sourceEnvironment: makeEnvironment(),
      anchorMessageText: "x",
      sourceTimelineRows: [],
      model: "gpt-5",
      permissionMode: "readonly",
    });

    expect(request?.title).toBeUndefined();
  });

  it("seeds an agent-only lead-up snapshot before the anchor when the source has prior messages", () => {
    const anchor = "Here's the plan I'd go with.";
    const request = buildForkThreadRequest({
      sourceThread: makeThread(),
      sourceEnvironment: makeEnvironment(),
      anchorMessageText: anchor,
      sourceTimelineRows: [
        conversationRow("user", "What approach should we take?"),
        conversationRow("assistant", anchor),
      ],
      model: "gpt-5",
      permissionMode: "readonly",
    });

    // The visible anchor seed comes first; an agent-only context snapshot follows.
    expect(request?.input[0]).toEqual({
      type: "text",
      text: anchor,
      mentions: [],
    });
    const snapshot = request?.input[1];
    expect(snapshot).toMatchObject({ type: "text", visibility: "agent-only" });
    expect(snapshot?.type === "text" ? snapshot.text : "").toContain(
      "bb thread show thr_source",
    );
  });

  it("falls back to the source's default branch when no current branch is known", () => {
    const request = buildForkThreadRequest({
      sourceThread: makeThread(),
      sourceEnvironment: makeEnvironment({ branchName: null }),
      anchorMessageText: "x",
      sourceTimelineRows: [],
      model: "gpt-5",
      permissionMode: "readonly",
    });

    expect(request?.environment).toMatchObject({
      type: "host",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });

  it("returns null when the source has no host to base a worktree fork on", () => {
    const request = buildForkThreadRequest({
      sourceThread: makeThread({ environmentId: null }),
      sourceEnvironment: null,
      anchorMessageText: "x",
      sourceTimelineRows: [],
      model: "gpt-5",
      permissionMode: "readonly",
    });

    expect(request).toBeNull();
  });
});

describe("isThreadForkable", () => {
  it("is true when the source has a resolved environment (and therefore a host)", () => {
    expect(isThreadForkable(makeEnvironment())).toBe(true);
  });

  it("is false for a host-less (null-environment) personal source", () => {
    // The Fork button/handler is dropped in this case so it never renders as a
    // dead no-op on a personal/no-host source.
    expect(isThreadForkable(null)).toBe(false);
  });

  it("agrees with buildForkThreadRequest's null gate", () => {
    expect(isThreadForkable(null)).toBe(false);
    expect(
      buildForkThreadRequest({
        sourceThread: makeThread({ environmentId: null }),
        sourceEnvironment: null,
        anchorMessageText: "x",
        sourceTimelineRows: [],
      model: "gpt-5",
        permissionMode: "readonly",
      }),
    ).toBeNull();
  });
});
