// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { makeEnvironment } from "@bb/test-helpers/domain-fixtures";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCanOpenFileExternally } from "./useCanOpenFileExternally";
import type { LiveFileRoot } from "./useResolvedLiveFileTarget";

const mocks = vi.hoisted(() => ({
  getEnvironment: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: { get: mocks.getEnvironment },
    threads: { storageLocation: vi.fn() },
  },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentDetailRealtimeSubscription: () => undefined,
  useThreadDetailRealtimeSubscription: () => undefined,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    isLocalDaemonHost: (hostId: string) => hostId === "host_local",
  }),
}));

vi.mock("@/hooks/useLocalOpenTargets", () => ({
  useLocalOpenTargets: (args: {
    enabled: boolean;
    openContext?: OpenInTargetContext;
  }) => ({
    canOpenPreferredFileTarget:
      args.enabled && args.openContext?.kind === "local",
  }),
}));

const ENVIRONMENT = makeEnvironment({
  id: "env_1",
  hostId: "host_local",
  path: "/work/repo",
  status: "ready",
  hostLifecycle: "active",
});

function renderCanOpen(initialRoot: LiveFileRoot) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ root }: { root: LiveFileRoot }) => useCanOpenFileExternally(root),
    { wrapper, initialProps: { root: initialRoot } },
  );
}

afterEach(() => {
  cleanup();
  mocks.getEnvironment.mockReset();
});

describe("useCanOpenFileExternally", () => {
  it("re-renders from false to true once a workspace target resolves", async () => {
    mocks.getEnvironment.mockResolvedValue(ENVIRONMENT);
    const { result } = renderCanOpen({
      kind: "workspace",
      environmentId: "env_1",
    });

    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.getEnvironment).toHaveBeenCalledTimes(1);
  });

  it("checks host targets against their own host's open context", () => {
    const { result, rerender } = renderCanOpen({
      kind: "host",
      hostId: "host_local",
    });
    expect(result.current).toBe(true);

    rerender({ root: { kind: "host", hostId: "host_remote" } });
    expect(result.current).toBe(false);
  });
});
