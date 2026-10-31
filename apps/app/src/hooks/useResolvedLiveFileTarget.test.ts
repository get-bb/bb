import { describe, expect, it } from "vitest";
import { makeEnvironment } from "@bb/test-helpers/domain-fixtures";
import type { ExperimentalLiveFileTarget } from "@get-bb/plugin-sdk";
import type { Environment } from "@bb/domain";
import type { ThreadStorageLocationResponse } from "@bb/server-contract";
import {
  getLiveFileOpenContext,
  getLiveFileTargetLookups,
  resolveLiveFilePath,
  resolveLiveFileRoot,
} from "./useResolvedLiveFileTarget";

const SERVER_ORIGIN = "http://localhost:3000";

function resolveLiveFileTarget({
  target,
  environmentQuery,
  storageQuery,
  isLocalDaemonHost,
  serverOrigin,
}: {
  target: ExperimentalLiveFileTarget;
  environmentQuery: { data: Environment | undefined; isLoading: boolean };
  storageQuery: {
    data: ThreadStorageLocationResponse | undefined;
    isLoading: boolean;
  };
  isLocalDaemonHost: (hostId: string) => boolean;
  serverOrigin: string;
}) {
  const root = resolveLiveFileRoot({
    root: target,
    environmentQuery,
    storageQuery,
  });
  if (root.status !== "available") return root;
  return {
    status: "available",
    absolutePath: resolveLiveFilePath(root, target.path),
    openContext: getLiveFileOpenContext({
      hostId: root.hostId,
      isLocalDaemonHost,
      serverOrigin,
    }),
  };
}

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
  it("resolves a workspace revision target to the working copy", () => {
    expect(
      resolveLiveFileTarget({
        target: {
          kind: "workspace",
          environmentId: "env_test",
          path: "src/app.ts",
          experimental_ref: "HEAD",
        },
        environmentQuery: { data: makeEnvironment(), isLoading: false },
        storageQuery: { data: undefined, isLoading: false },
        isLocalDaemonHost: () => true,
        serverOrigin: SERVER_ORIGIN,
      }),
    ).toEqual({
      status: "available",
      absolutePath: "/workspace/src/app.ts",
      openContext: { kind: "local" },
    });
  });

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
          environmentQuery: { data: undefined, isLoading: false },
          storageQuery: query,
          isLocalDaemonHost: () => false,
          serverOrigin: SERVER_ORIGIN,
        }),
      ).toEqual({ status });
    },
  );

  it.each([
    { status: "ready", hostLifecycle: "active", expected: "available" },
    {
      status: "provisioning",
      hostLifecycle: "active",
      expected: "unavailable",
    },
    { status: "destroyed", hostLifecycle: "active", expected: "unavailable" },
    { status: "ready", hostLifecycle: "removing", expected: "unavailable" },
  ] as const)(
    "treats a $status environment on a $hostLifecycle host as $expected",
    ({ status, hostLifecycle, expected }) => {
      expect(
        resolveLiveFileRoot({
          root: { kind: "workspace", environmentId: "env_1" },
          environmentQuery: {
            data: makeEnvironment({
              hostId: "host_1",
              path: "/work/repo",
              status,
              hostLifecycle,
            }),
            isLoading: false,
          },
          storageQuery: { data: undefined, isLoading: false },
        }).status,
      ).toBe(expected);
    },
  );
});
