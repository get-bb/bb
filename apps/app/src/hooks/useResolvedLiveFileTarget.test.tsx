// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResolvedLiveFileTarget } from "./useResolvedLiveFileTarget";

const mocks = vi.hoisted(() => ({
  isLocalDaemonHost: vi.fn(),
  useEnvironment: vi.fn(),
  useThreadStorageLocation: vi.fn(),
}));

vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironment: mocks.useEnvironment,
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreadStorageLocation: mocks.useThreadStorageLocation,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    isLocalDaemonHost: mocks.isLocalDaemonHost,
  }),
}));

const target = {
  kind: "thread-storage",
  path: "reports/summary.md",
  threadId: "thr_1",
} as const;

beforeEach(() => {
  mocks.isLocalDaemonHost.mockReturnValue(false);
  mocks.useEnvironment.mockReturnValue({
    data: undefined,
    isLoading: false,
  });
  mocks.useThreadStorageLocation.mockReturnValue({
    data: {
      hostId: "host_remote",
      storageRootPath: "/var/lib/bb/thread-storage/thr_1",
    },
    isError: false,
    isLoading: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
    ({ isLocal, openContext }) => {
      mocks.isLocalDaemonHost.mockReturnValue(isLocal);

      const { result } = renderHook(() =>
        useResolvedLiveFileTarget(target, { enabled: true }),
      );

      expect(result.current).toEqual({
        status: "available",
        absolutePath: "/var/lib/bb/thread-storage/thr_1/reports/summary.md",
        openContext,
      });
      expect(mocks.useThreadStorageLocation).toHaveBeenCalledWith("thr_1", {
        enabled: true,
      });
      expect(mocks.useEnvironment).toHaveBeenCalledWith("", {
        enabled: false,
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
    ({ query, status }) => {
      mocks.useThreadStorageLocation.mockReturnValue(query);

      const { result } = renderHook(() =>
        useResolvedLiveFileTarget(target, { enabled: true }),
      );

      expect(result.current).toEqual({ status });
    },
  );
});
