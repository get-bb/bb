import type { Thread } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildForkThreadRequest,
  isThreadForkable,
} from "./fork-thread-request";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  const base: Thread = {
    archivedAt: null,
    childOrigin: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "env_source",
    id: "thr_source",
    lastReadAt: null,
    latestAttentionAt: 1,
    originKind: null,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj_test",
    providerId: "codex",
    sourceThreadId: null,
    status: "idle",
    title: "Investigate flaky test",
    titleFallback: null,
    folderId: null,
    updatedAt: 1,
  };
  return { ...base, ...overrides };
}

describe("buildForkThreadRequest", () => {
  it("reuses the source environment and starts with the user's first message", () => {
    const request = buildForkThreadRequest({
      environmentId: "env_source",
      input: [{ type: "text", text: "Continue from here", mentions: [] }],
      model: "gpt-5",
      permissionMode: "workspace-write",
      projectId: "proj_test",
      providerId: "codex",
      reasoningLevel: "high",
      serviceTier: "fast",
      sourceSeqEnd: 42,
      sourceThreadId: "thr_source",
      sourceThreadTitle: "Investigate flaky test",
    });

    expect(request).toEqual({
      environment: { type: "reuse", environmentId: "env_source" },
      input: [{ type: "text", text: "Continue from here", mentions: [] }],
      model: "gpt-5",
      originKind: "fork",
      permissionMode: "workspace-write",
      projectId: "proj_test",
      providerId: "codex",
      reasoningLevel: "high",
      serviceTier: "fast",
      sourceSeqEnd: 42,
      sourceThreadId: "thr_source",
      startedOnBehalfOf: null,
    });
  });

  it("omits unsupported service tier", () => {
    const request = buildForkThreadRequest({
      environmentId: "env_source",
      input: [{ type: "text", text: "Continue from here", mentions: [] }],
      model: "gpt-5",
      permissionMode: "readonly",
      projectId: "proj_test",
      providerId: "codex",
      reasoningLevel: "medium",
      serviceTier: undefined,
      sourceSeqEnd: undefined,
      sourceThreadId: "thr_source",
      sourceThreadTitle: "Investigate flaky test",
    });

    expect(request).not.toHaveProperty("serviceTier");
  });

  it("returns null when the provider cannot fork sessions", () => {
    expect(
      buildForkThreadRequest({
        environmentId: "env_source",
        input: [{ type: "text", text: "Continue from here", mentions: [] }],
        model: "gpt-5",
        permissionMode: "readonly",
        projectId: "proj_test",
        providerId: "acp-cursor",
        reasoningLevel: "medium",
        serviceTier: undefined,
        sourceSeqEnd: undefined,
        sourceThreadId: "thr_source",
        sourceThreadTitle: "Investigate flaky test",
      }),
    ).toBeNull();
  });
});

describe("isThreadForkable", () => {
  it("is true only when the source thread has an environment id and fork-capable provider", () => {
    expect(isThreadForkable(makeThread({ environmentId: "env_source" }))).toBe(
      true,
    );
    expect(isThreadForkable(makeThread({ environmentId: null }))).toBe(false);
    expect(isThreadForkable(makeThread({ providerId: "acp-cursor" }))).toBe(
      false,
    );
    expect(isThreadForkable(makeThread({ providerId: "not-a-provider" }))).toBe(
      false,
    );
    expect(isThreadForkable(null)).toBe(false);
  });
});
