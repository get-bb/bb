// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import type {
  ProviderCliStatusResponse,
  ProviderUsageResponse,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  hostProviderCliStatusQueryKey,
  systemExecutionOptionsQueryKey,
  systemProvidersQueryKey,
  systemUsageLimitsQueryKey,
} from "./query-keys";
import {
  useHostProviderCliStatus,
  useSystemExecutionOptions,
  useSystemUsageLimits,
} from "./system-queries";

vi.mock("@/lib/sdk", () => ({
  BbHttpError: class BbHttpError extends Error {},
  sdk: {
    hosts: { providerCliStatus: vi.fn() },
    system: {
      executionOptions: vi.fn(),
      usageLimits: vi.fn(),
    },
  },
}));

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
  cursor: { status: "unauthenticated" },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSystemExecutionOptions", () => {
  it("separates requests and cache entries for different hosts", async () => {
    vi.mocked(sdk.system.executionOptions).mockImplementation(async (args) =>
      args?.hostId === "host-a"
        ? { ...EXECUTION_OPTIONS_RESPONSE, models: [] }
        : { ...EXECUTION_OPTIONS_RESPONSE, selectedOnlyModels: [] },
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(
      () => [
        useSystemExecutionOptions({ hostId: "host-a", providerId: "codex" }),
        useSystemExecutionOptions({ hostId: "host-b", providerId: "codex" }),
      ],
      { wrapper },
    );

    await waitFor(() => {
      expect(sdk.system.executionOptions).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: "host-a", providerId: "codex" }),
      );
      expect(sdk.system.executionOptions).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: "host-b", providerId: "codex" }),
      );
    });

    const hostAKey = systemExecutionOptionsQueryKey({
      environmentId: null,
      hostId: "host-a",
      providerId: "codex",
    });
    const hostBKey = systemExecutionOptionsQueryKey({
      environmentId: null,
      hostId: "host-b",
      providerId: "codex",
    });
    expect(hostAKey).not.toEqual(hostBKey);
    expect(queryClient.getQueryState(hostAKey)).toBeDefined();
    expect(queryClient.getQueryState(hostBKey)).toBeDefined();
    expect(systemProvidersQueryKey({ hostId: "host-a" })).not.toEqual(
      systemProvidersQueryKey({ hostId: "host-b" }),
    );
  });

  it("retries one transient failure before surfacing model selector errors", async () => {
    vi.mocked(sdk.system.executionOptions)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(EXECUTION_OPTIONS_RESPONSE);

    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () => useSystemExecutionOptions({ providerId: "codex" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toBe(EXECUTION_OPTIONS_RESPONSE);
      expect(sdk.system.executionOptions).toHaveBeenCalledTimes(2);
    });
  });

  it("does not retry intentionally aborted model selector requests", async () => {
    vi.mocked(sdk.system.executionOptions).mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );

    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () => useSystemExecutionOptions({ providerId: "codex" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
      expect(sdk.system.executionOptions).toHaveBeenCalledTimes(1);
    });
  });
});

describe("useHostProviderCliStatus", () => {
  it("keeps host CLI status session-static", async () => {
    vi.mocked(sdk.hosts.providerCliStatus).mockResolvedValue(
      PROVIDER_CLI_STATUS_RESPONSE,
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(
      () => useHostProviderCliStatus({ hostId: "host-1", enabled: true }),
      { wrapper },
    );

    await waitFor(() => {
      expect(sdk.hosts.providerCliStatus).toHaveBeenCalledTimes(1);
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
    vi.mocked(sdk.system.usageLimits).mockResolvedValue(
      PROVIDER_USAGE_RESPONSE,
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(() => useSystemUsageLimits({ hostId: "host-1" }), { wrapper });

    await waitFor(() => {
      expect(sdk.system.usageLimits).toHaveBeenCalledTimes(1);
    });

    expect(sdk.system.usageLimits).toHaveBeenCalledWith({
      hostId: "host-1",
      signal: expect.any(AbortSignal),
    });

    const query = queryClient.getQueryCache().find({
      queryKey: systemUsageLimitsQueryKey("host-1"),
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
