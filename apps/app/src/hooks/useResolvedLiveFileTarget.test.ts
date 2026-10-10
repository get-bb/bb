import { describe, expect, it } from "vitest";
import {
  getLiveFileTargetLookups,
  resolveLiveFileTarget,
} from "./useResolvedLiveFileTarget";

const SERVER_ORIGIN = "http://localhost:3000";

const target = {
  kind: "thread-storage",
  path: "reports/summary.md",
  threadId: "thr_1",
} as const;

const storageLocation = {
  hostId: "host_remote",
  storageRootPath: "/var/lib/bb/thread-storage/thr_1",
};

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
        serverOrigin: SERVER_ORIGIN,
      },
    },
  ] as const)(
    "resolves thread storage from the direct location lookup when local is $isLocal",
    ({ isLocal, openContext }) => {
      expect(
        resolveLiveFileTarget({
          target,
          enabled: true,
          environmentQuery: { data: undefined, isLoading: false },
          storageQuery: { data: storageLocation, isLoading: false },
          isLocalDaemonHost: () => isLocal,
          serverOrigin: SERVER_ORIGIN,
        }),
      ).toEqual({
        status: "available",
        absolutePath: "/var/lib/bb/thread-storage/thr_1/reports/summary.md",
        openContext,
      });
      expect(getLiveFileTargetLookups(target, true)).toEqual({
        environmentId: "",
        environmentEnabled: false,
        storageThreadId: "thr_1",
        storageEnabled: true,
      });
    },
  );

  it.each([
    {
      query: { data: undefined, isLoading: true },
      status: "loading",
    },
    {
      query: { data: undefined, isLoading: false },
      status: "unavailable",
    },
  ] as const)(
    "preserves the $status storage lookup state",
    ({ query, status }) => {
      expect(
        resolveLiveFileTarget({
          target,
          enabled: true,
          environmentQuery: { data: undefined, isLoading: false },
          storageQuery: query,
          isLocalDaemonHost: () => false,
          serverOrigin: SERVER_ORIGIN,
        }),
      ).toEqual({ status });
    },
  );
});
