// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadWithRuntime } from "@bb/domain";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import * as api from "@/lib/api";
import { useHireProjectManager } from "./project-mutations";

vi.mock("@/lib/api", () => ({
  hireProjectManager: vi.fn(),
}));

type ThreadOverrides = Partial<ThreadWithRuntime>;

function makeThread(overrides: ThreadOverrides = {}): ThreadWithRuntime {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 1,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "project-1",
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Manager",
    titleFallback: "Manager",
    type: "manager",
    updatedAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("project mutations", () => {
  it("passes selected service tier when hiring a project manager", async () => {
    vi.mocked(api.hireProjectManager).mockResolvedValue(makeThread());
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useHireProjectManager(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "project-1",
        name: "Manager",
        providerId: "codex",
        model: "gpt-5.5",
        serviceTier: "fast",
        reasoningLevel: "xhigh",
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          serviceTier: "explicit",
          reasoningLevel: "explicit",
        },
        environment: { type: "host", hostId: "host-1" },
        input: [{ type: "text", text: "Start here" }],
      });
    });

    expect(api.hireProjectManager).toHaveBeenCalledWith("project-1", {
      name: "Manager",
      providerId: "codex",
      model: "gpt-5.5",
      serviceTier: "fast",
      reasoningLevel: "xhigh",
      executionInputSources: {
        providerId: "explicit",
        model: "explicit",
        serviceTier: "explicit",
        reasoningLevel: "explicit",
      },
      environment: { type: "host", hostId: "host-1" },
      input: [{ type: "text", text: "Start here" }],
    });
  });
});
