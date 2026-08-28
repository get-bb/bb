// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import * as hostDaemonHooks from "@/hooks/useHostDaemon";
import { useResolvedLiveFileTarget } from "./useResolvedLiveFileTarget";

const target = {
  kind: "thread-storage",
  path: "reports/summary.md",
  threadId: "thr_1",
} as const;

interface TestProvidersProps {
  children: ReactNode;
  queryClient: QueryClient;
}

function TestProviders({ children, queryClient }: TestProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderTarget() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderHook(
    () => useResolvedLiveFileTarget(target, { enabled: true }),
    {
      wrapper: ({ children }) => (
        <TestProviders queryClient={queryClient}>{children}</TestProviders>
      ),
    },
  );
}

const storageLocation = {
  hostId: "host_remote",
  storageRootPath: "/var/lib/bb/thread-storage/thr_1",
};
let storageLocationSpy: ReturnType<typeof vi.spyOn>;
const isLocalDaemonHost =
  vi.fn<(hostId: string | null | undefined) => boolean>();

beforeEach(() => {
  isLocalDaemonHost.mockReturnValue(false);
  vi.spyOn(hostDaemonHooks, "useHostDaemon").mockReturnValue({
    localDaemonHostId: null,
    localHostId: null,
    hasDaemon: false,
    supportsNativeFolderPicker: false,
    platform: null,
    isLocalDaemonHost,
  });
  storageLocationSpy = vi
    .spyOn(sdk.threads, "storageLocation")
    .mockResolvedValue(storageLocation);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useResolvedLiveFileTarget", () => {
  it.each([
    {
      isLocal: true,
      openContext: { kind: "local" },
    },
    {
      isLocal: false,
      openContext: {
        kind: "remote-ssh",
        hostId: "host_remote",
        serverOrigin: window.location.origin,
      },
    },
  ] as const)(
    "resolves thread storage from the direct location lookup when local is $isLocal",
    async ({ isLocal, openContext }) => {
      isLocalDaemonHost.mockReturnValue(isLocal);
      const { result } = renderTarget();

      await waitFor(() => {
        expect(result.current).toEqual({
          status: "available",
          absolutePath: "/var/lib/bb/thread-storage/thr_1/reports/summary.md",
          openContext,
        });
      });
    },
  );

  it.each([
    {
      query: { data: undefined, isError: false, isLoading: true },
      status: "loading",
    },
    {
      query: { data: undefined, isError: true, isLoading: false },
      status: "unavailable",
    },
  ] as const)(
    "preserves the $status storage lookup state",
    async ({ status }) => {
      if (status === "loading") {
        storageLocationSpy.mockReturnValue(new Promise(() => {}));
        const { result } = renderTarget();
        expect(result.current).toEqual({ status: "loading" });
        return;
      }
      storageLocationSpy.mockRejectedValue(new Error("storage unavailable"));
      const { result } = renderTarget();
      await waitFor(() => expect(result.current).toEqual({ status }));
    },
  );
});
