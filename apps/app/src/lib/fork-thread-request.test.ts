import type { Thread } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildForkThreadRequest,
  isThreadForkable,
} from "./fork-thread-request";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  const base: Thread = {
    archivedAt: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "env_source",
    id: "thr_source",
    lastReadAt: null,
    latestAttentionAt: 1,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj_test",
    providerId: "codex",
    sourceThreadId: null,
    status: "idle",
    title: "Investigate flaky test",
    titleFallback: null,
    sectionId: null,
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
      permissionMode: "accept-edits",
      projectId: "proj_test",
      providerId: "codex",
      providerSupportsFork: true,
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
      permissionMode: "accept-edits",
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
      permissionMode: "auto",
      projectId: "proj_test",
      providerId: "codex",
      providerSupportsFork: true,
      reasoningLevel: "medium",
      serviceTier: undefined,
      sourceSeqEnd: undefined,
      sourceThreadId: "thr_source",
      sourceThreadTitle: "Investigate flaky test",
    });

    expect(request).not.toHaveProperty("serviceTier");
  });

  it("builds a fork request for a generic ACP provider", () => {
    expect(
      buildForkThreadRequest({
        environmentId: "env_source",
        input: [{ type: "text", text: "Continue from here", mentions: [] }],
        model: "gpt-5",
        permissionMode: "auto",
        projectId: "proj_test",
        providerId: "acp-amp",
        providerSupportsFork: true,
        reasoningLevel: "medium",
        serviceTier: undefined,
        sourceSeqEnd: undefined,
        sourceThreadId: "thr_source",
        sourceThreadTitle: "Investigate flaky test",
      }),
    ).toMatchObject({
      originKind: "fork",
      providerId: "acp-amp",
      sourceThreadId: "thr_source",
    });
  });

  it("returns null when the provider cannot fork sessions", () => {
    expect(
      buildForkThreadRequest({
        environmentId: "env_source",
        input: [{ type: "text", text: "Continue from here", mentions: [] }],
        model: "unknown-model",
        permissionMode: "auto",
        projectId: "proj_test",
        providerId: "not-a-provider",
        providerSupportsFork: false,
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
  it("is true only with an environment id and a fork-capable provider", () => {
    expect(
      isThreadForkable(makeThread({ environmentId: "env_source" }), true),
    ).toBe(true);
    expect(isThreadForkable(makeThread({ environmentId: null }), true)).toBe(
      false,
    );
    // The capability now arrives from server-provided ProviderInfo; absence
    // (unknown provider, data not loaded) reads as false.
    expect(
      isThreadForkable(makeThread({ providerId: "not-a-provider" }), false),
    ).toBe(false);
    expect(isThreadForkable(null, true)).toBe(false);
  });
});
