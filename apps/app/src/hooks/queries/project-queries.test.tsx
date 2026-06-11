// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installAbortableJsonRoute } from "@/test/abort-signal-test-utils";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import {
  useProjectDefaultExecutionOptions,
  useProjectPromptHistory,
  useProjectSourceBranches,
} from "./project-queries";

interface DefaultExecutionOptionsHookProps {
  projectId: string;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("project queries", () => {
  it("loads project default execution options without a thread type", async () => {
    const requestUrls: URL[] = [];
    installFetchRoutes([
      {
        pathname: "/api/v1/projects/project-1/default-execution-options",
        handler: (request) => {
          requestUrls.push(new URL(request.url));
          return jsonResponse({
            providerId: "codex",
            model: "gpt-5.5",
            reasoningLevel: "xhigh",
            permissionMode: "full",
            serviceTier: "default",
          });
        },
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () =>
        useProjectDefaultExecutionOptions({
          projectId: "project-1",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data?.reasoningLevel).toBe("xhigh");
    });

    expect(requestUrls[0]?.searchParams.has("threadType")).toBe(false);
  });

  it("keeps previous project defaults while new project defaults load", async () => {
    let projectTwoRequestCount = 0;
    let resolveProjectTwoResponse: () => void = () => {
      throw new Error("Project 2 request did not start");
    };
    installFetchRoutes([
      {
        pathname: "/api/v1/projects/project-1/default-execution-options",
        handler: () =>
          jsonResponse({
            providerId: "codex",
            model: "gpt-5.5",
            reasoningLevel: "xhigh",
            permissionMode: "full",
            serviceTier: "fast",
          }),
      },
      {
        pathname: "/api/v1/projects/project-2/default-execution-options",
        handler: () => {
          projectTwoRequestCount += 1;
          return new Promise<Response>((resolve) => {
            resolveProjectTwoResponse = () =>
              resolve(
                jsonResponse({
                  providerId: "codex",
                  model: "gpt-5.6",
                  reasoningLevel: "high",
                  permissionMode: "workspace-write",
                  serviceTier: "default",
                }),
              );
          });
        },
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();

    const { result, rerender } = renderHook(
      ({ projectId }: DefaultExecutionOptionsHookProps) =>
        useProjectDefaultExecutionOptions({
          projectId,
        }),
      {
        initialProps: { projectId: "project-1" },
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.data?.serviceTier).toBe("fast");
    });

    rerender({ projectId: "project-2" });

    await waitFor(() => {
      expect(projectTwoRequestCount).toBe(1);
    });
    expect(result.current.data?.serviceTier).toBe("fast");
    expect(result.current.isPlaceholderData).toBe(true);

    await act(async () => {
      resolveProjectTwoResponse();
    });

    await waitFor(() => {
      expect(result.current.data?.serviceTier).toBe("default");
    });
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it("passes AbortSignal through project prompt history requests", async () => {
    const route = installAbortableJsonRoute({
      pathname: "/api/v1/projects/project-1/prompt-history",
      body: [],
    });
    const { wrapper } = createQueryClientTestHarness();
    const { unmount } = renderHook(() => useProjectPromptHistory("project-1"), {
      wrapper,
    });

    await waitFor(() => {
      expect(route.getSignal()).toBeInstanceOf(AbortSignal);
    });

    unmount();

    await waitFor(() => {
      expect(route.getSignal()?.aborted).toBe(true);
    });
  });

  it("does not poll project source branches in the background", async () => {
    vi.useFakeTimers();
    let branchRequestCount = 0;
    const branchRequestUrls: URL[] = [];
    installFetchRoutes([
      {
        pathname: "/api/v1/projects/project-1/branches",
        handler: (request) => {
          branchRequestCount += 1;
          branchRequestUrls.push(new URL(request.url));
          return jsonResponse({
            branches: ["main"],
            branchesTruncated: false,
            checkout: {
              kind: "branch",
              branchName: "main",
              headSha: "abc123",
            },
            defaultBranch: "main",
            hasUncommittedChanges: false,
            operation: { kind: "none" },
            remoteBranches: [],
            remoteBranchesTruncated: false,
            selectedBranch: null,
          });
        },
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useProjectSourceBranches("project-1", "host-1"), {
      wrapper,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(branchRequestCount).toBe(1);
    expect(branchRequestUrls[0]?.searchParams.get("selectedBranch")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(branchRequestCount).toBe(1);
  });

  it("passes selected branch through project source branch requests", async () => {
    const branchRequestUrls: URL[] = [];
    installFetchRoutes([
      {
        pathname: "/api/v1/projects/project-1/branches",
        handler: (request) => {
          branchRequestUrls.push(new URL(request.url));
          return jsonResponse({
            branches: [],
            branchesTruncated: false,
            checkout: { kind: "unknown", reason: "not checked" },
            defaultBranch: "main",
            hasUncommittedChanges: false,
            operation: { kind: "none" },
            remoteBranches: ["upstream/main"],
            remoteBranchesTruncated: false,
            selectedBranch: { name: "upstream/main", kind: "remote" },
          });
        },
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () =>
        useProjectSourceBranches("project-1", "host-1", {
          selectedBranch: "upstream/main",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data?.selectedBranch).toEqual({
        name: "upstream/main",
        kind: "remote",
      });
    });
    const branchRequestUrl = branchRequestUrls[0];
    expect(branchRequestUrl?.searchParams.get("selectedBranch")).toBe(
      "upstream/main",
    );
  });
});
