// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import type {
  ProviderCliStatusResponse,
  ProviderUsageResponse,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  hostProviderCliStatusQueryKey,
  systemUsageLimitsQueryKey,
} from "./query-keys";
import {
  useHostProviderCliStatus,
  useSystemExecutionOptions,
  useSystemUsageLimits,
} from "./system-queries";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchHostProviderCliStatus: vi.fn(),
    getSystemExecutionOptions: vi.fn(),
    getSystemUsageLimits: vi.fn(),
  };
});

const EXECUTION_OPTIONS_RESPONSE: SystemExecutionOptionsResponse = {
  providers: [],
  models: [],
  selectedOnlyModels: [],
  modelLoadError: null,
};

const PROVIDER_CLI_STATUS_RESPONSE = {} as ProviderCliStatusResponse;

const PROVIDER_USAGE_RESPONSE: ProviderUsageResponse = {
  codex: { status: "unauthenticated" },
  claudeCode: { status: "unauthenticated" },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSystemExecutionOptions", () => {
  it("retries one transient failure before surfacing model selector errors", async () => {
    vi.mocked(api.getSystemExecutionOptions)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(EXECUTION_OPTIONS_RESPONSE);

    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () => useSystemExecutionOptions({ providerId: "codex" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toBe(EXECUTION_OPTIONS_RESPONSE);
      expect(api.getSystemExecutionOptions).toHaveBeenCalledTimes(2);
    });
  });

  it("does not retry intentionally aborted model selector requests", async () => {
    vi.mocked(api.getSystemExecutionOptions).mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );

    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () => useSystemExecutionOptions({ providerId: "codex" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
      expect(api.getSystemExecutionOptions).toHaveBeenCalledTimes(1);
    });
  });
});

describe("useHostProviderCliStatus", () => {
  it("keeps host CLI status session-static", async () => {
    vi.mocked(api.fetchHostProviderCliStatus).mockResolvedValue(
      PROVIDER_CLI_STATUS_RESPONSE,
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(
      () => useHostProviderCliStatus({ hostId: "host-1", enabled: true }),
      { wrapper },
    );

    await waitFor(() => {
      expect(api.fetchHostProviderCliStatus).toHaveBeenCalledTimes(1);
    });

    const query = queryClient.getQueryCache().find({
      queryKey: hostProviderCliStatusQueryKey("host-1"),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
      }),
    );
  });
});

describe("useSystemUsageLimits", () => {
  it("refreshes stale usage data on focus and reconnect", async () => {
    vi.mocked(api.getSystemUsageLimits).mockResolvedValue(
      PROVIDER_USAGE_RESPONSE,
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(() => useSystemUsageLimits(), { wrapper });

    await waitFor(() => {
      expect(api.getSystemUsageLimits).toHaveBeenCalledTimes(1);
    });

    const query = queryClient.getQueryCache().find({
      queryKey: systemUsageLimitsQueryKey(),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
        staleTime: 30_000,
      }),
    );
  });
});
