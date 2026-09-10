// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultUiPreferences } from "@bb/domain";
import { useUiPreferencesReady } from "./UiPreferencesSync";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@/lib/sdk", async () => {
  const actual = await import("@bb/sdk/browser");
  return {
    BbHttpError: actual.BbHttpError,
    sdk: { system: { uiPreferences: { list: mocks.list } } },
  };
});

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useSystemRealtimeSubscription: () => {},
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useUiPreferencesReady", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mocks.list.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("stays not ready until the preferences query resolves", async () => {
    let resolve: ((value: unknown) => void) | null = null;
    mocks.list.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { result } = renderHook(() => useUiPreferencesReady(), {
      wrapper: createWrapper(queryClient),
    });
    expect(result.current).toBe(false);
    await act(async () => {
      resolve!({
        preferences: Object.fromEntries(
          Object.entries(defaultUiPreferences).map(([key, value]) => [
            key,
            { revision: 0, value },
          ]),
        ),
      });
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("becomes ready with defaults when the query fails", async () => {
    mocks.list.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useUiPreferencesReady(), {
      wrapper: createWrapper(queryClient),
    });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });
});
