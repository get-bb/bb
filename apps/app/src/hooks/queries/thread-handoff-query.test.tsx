// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BbHttpError, sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useThreadHandoffStatus } from "./thread-handoff-query";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      threads: {
        handoffStatus: vi.fn(),
      },
    },
  };
});

describe("useThreadHandoffStatus", () => {
  beforeEach(() => {
    vi.mocked(sdk.threads.handoffStatus).mockReset();
  });

  it("returns null when the thread has no handoff record", async () => {
    vi.mocked(sdk.threads.handoffStatus).mockRejectedValue(
      new BbHttpError({
        body: null,
        code: "not_found",
        message: "Not found",
        status: 404,
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useThreadHandoffStatus("thr_replacement"),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
  });

  it("polls only while the takeover is provisioning", async () => {
    vi.mocked(sdk.threads.handoffStatus).mockResolvedValue({
      sourceThreadId: "thr_source",
      replacementThreadId: "thr_replacement",
      state: "started",
      sourceArchived: true,
      failure: null,
    });
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useThreadHandoffStatus("thr_replacement"),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data?.state).toBe("started");
    });
    expect(result.current.data?.sourceArchived).toBe(true);
  });
});
