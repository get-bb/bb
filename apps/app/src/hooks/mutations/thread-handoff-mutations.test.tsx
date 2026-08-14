// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { threadHandoffQueryKey, threadQueryKey } from "../queries/query-keys";
import { useThreadHandoff } from "./thread-handoff-mutations";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      threads: {
        handoff: vi.fn(),
      },
    },
  };
});

describe("useThreadHandoff", () => {
  beforeEach(() => {
    vi.mocked(sdk.threads.handoff).mockReset();
  });

  it("posts the durable takeover and seeds replacement status", async () => {
    const result = {
      sourceThreadId: "thr_source",
      replacementThreadId: "thr_replacement",
      state: "provisioning" as const,
      sourceArchived: false,
      failure: null,
    };
    vi.mocked(sdk.threads.handoff).mockResolvedValue(result);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(threadQueryKey("thr_source"), { id: "thr_source" });
    queryClient.setQueryData(threadQueryKey("thr_replacement"), {
      id: "thr_replacement",
    });
    const { result: hook } = renderHook(() => useThreadHandoff(), { wrapper });

    await act(async () => {
      await hook.current.mutateAsync({
        archiveSource: true,
        idempotencyKey: "app-handoff-1234567890",
        model: "claude-opus-5",
        permissionMode: "auto",
        providerId: "claudeCode",
        reasoningLevel: "high",
        sourceThreadId: "thr_source",
      });
    });

    expect(sdk.threads.handoff).toHaveBeenCalledWith({
      archiveSource: true,
      idempotencyKey: "app-handoff-1234567890",
      model: "claude-opus-5",
      origin: "app",
      permissionMode: "auto",
      providerId: "claudeCode",
      reasoningLevel: "high",
      sourceThreadId: "thr_source",
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData(threadHandoffQueryKey("thr_replacement")),
      ).toEqual(result);
    });
    expect(
      queryClient.getQueryState(threadQueryKey("thr_source"))?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(threadQueryKey("thr_replacement"))
        ?.isInvalidated,
    ).toBe(true);
  });
});
