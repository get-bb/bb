// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { HostDiscoveredReposResponse } from "@bb/server-contract";
import type { ReactNode } from "react";
import { BbHttpError } from "@bb/sdk/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { useProjectsScanTelemetry } from "./useProjectsScanTelemetry";

vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: vi.fn() }));

const idle = {
  data: undefined,
  dataUpdatedAt: 0,
  error: null,
  errorUpdatedAt: 0,
};
const base = {
  entry: "first_run",
  step: "projects",
  operation: "scan",
} as const;

function hostUnavailable() {
  return new BbHttpError({
    body: null,
    code: "host_unavailable",
    message: "Host is not connected",
    status: 502,
  });
}

function renderScanQuery(
  queryFn: (context: {
    signal: AbortSignal;
  }) => Promise<HostDiscoveredReposResponse>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => {
      const scan = useQuery({ queryKey: ["scan"], queryFn });
      useProjectsScanTelemetry({ entry: "first_run", noHost: false, scan });
      return scan;
    },
    { wrapper },
  );
  return { queryClient, view };
}

function recorded() {
  return vi
    .mocked(recordTelemetryEvent)
    .mock.calls.map(([event]) => event.properties);
}

beforeEach(() => {
  vi.mocked(recordTelemetryEvent).mockClear();
});

afterEach(() => {
  cleanup();
});

describe("projects scan telemetry", () => {
  it("records a timed-out scan with its unreadable folder count", () => {
    renderHook(() =>
      useProjectsScanTelemetry({
        entry: "first_run",
        noHost: false,
        scan: {
          ...idle,
          dataUpdatedAt: 1,
          data: { repos: [], truncated: true, unreadableCount: 2 },
        },
      }),
    );
    expect(recorded()).toEqual([
      {
        ...base,
        outcome: "succeeded",
        item_count: 0,
        timed_out: true,
        unreadable_count: 2,
      },
    ]);
  });

  it("records a missing machine once while the step stays open", () => {
    const view = renderHook(
      ({ noHost }) =>
        useProjectsScanTelemetry({ entry: "first_run", noHost, scan: idle }),
      { initialProps: { noHost: false } },
    );
    expect(recorded()).toEqual([]);
    view.rerender({ noHost: true });
    view.rerender({ noHost: false });
    view.rerender({ noHost: true });
    expect(recorded()).toEqual([
      { ...base, outcome: "failed", failure_reason: "no_host" },
    ]);
  });

  it("records nothing when a refetch after a failure starts and is cancelled", async () => {
    let calls = 0;
    const { queryClient, view } = renderScanQuery(({ signal }) => {
      calls += 1;
      if (calls === 1) return Promise.reject(hostUnavailable());
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    });
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    act(() => {
      void view.result.current.refetch();
    });
    await waitFor(() =>
      expect(view.result.current).toMatchObject({
        error: null,
        fetchStatus: "fetching",
      }),
    );
    await act(async () => {
      await queryClient.cancelQueries({ queryKey: ["scan"] });
    });
    expect(recorded()).toEqual([
      { ...base, outcome: "failed", failure_reason: "host_unavailable" },
    ]);
  });

  it("records nothing for a scan cancelled without reverting", async () => {
    const { queryClient, view } = renderScanQuery(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    await waitFor(() =>
      expect(view.result.current.fetchStatus).toBe("fetching"),
    );
    await act(async () => {
      await queryClient
        .getQueryCache()
        .find({ queryKey: ["scan"] })
        ?.cancel();
    });
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    expect(recorded()).toEqual([]);
  });

  it("records each real failure once, including a repeat after a refetch", async () => {
    const { view } = renderScanQuery(() => Promise.reject(hostUnavailable()));
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    await act(async () => {
      await view.result.current.refetch();
    });
    await waitFor(() =>
      expect(recorded()).toEqual([
        { ...base, outcome: "failed", failure_reason: "host_unavailable" },
        { ...base, outcome: "failed", failure_reason: "host_unavailable" },
      ]),
    );
  });
});
