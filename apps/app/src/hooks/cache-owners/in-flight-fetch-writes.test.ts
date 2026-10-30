import {
  QueryClient,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type {
  PluginInstallJob,
  PluginUpdateJob,
  SystemAiServicesResponse,
  SystemAppUpdateStatus,
  SystemVersionResponse,
} from "@bb/server-contract";
import type { PluginSettingsView } from "../queries/plugin-settings-queries";
import {
  pluginInstallJobsQueryKey,
  pluginSettingsViewQueryKey,
  pluginUpdateJobsQueryKey,
  systemAiServicesQueryKey,
  systemAppUpdateQueryKey,
  systemVersionQueryKey,
} from "../queries/query-keys";
import { hydrateAppUpdateStatus } from "./app-update-cache-owner";
import { setQueryDataOverInFlightFetch } from "./cache-effect-utils";
import {
  applyPluginInstallJob,
  applyPluginSettingsView,
  applyPluginUpdateJob,
} from "./plugin-cache-owner";
import { writeCachedAiServices } from "./system-config-cache-owner";
import { hydrateSystemVersionCache } from "./system-version-cache-owner";

interface WriteCase {
  label: string;
  queryKey: QueryKey;
  stale: unknown;
  written: unknown;
  write: (queryClient: QueryClient) => void;
}

function writeCase<T>(args: {
  label: string;
  queryKey: QueryKey;
  stale: T;
  written: T;
  write: (queryClient: QueryClient) => void;
}): WriteCase {
  return args;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function settingsView(value: string): PluginSettingsView {
  return {
    schema: { greeting: { type: "string", label: "Greeting" } },
    values: { greeting: value },
  };
}

const installTarget = {
  kind: "catalog",
  entryId: "notes",
  marketplace: "bb-community",
} as const;
const runningInstall: PluginInstallJob = {
  id: "job-1",
  target: installTarget,
  displayName: "Notes",
  state: "running",
};
const cancellingInstall: PluginInstallJob = {
  ...runningInstall,
  state: "cancelling",
};
const startedUpdate: PluginUpdateJob = {
  id: "update-1",
  pluginId: "notes",
  displayName: "Notes",
  state: "queued",
};

function appUpdateStatus(
  activity: SystemAppUpdateStatus["activity"],
): SystemAppUpdateStatus {
  return {
    activity,
    available: null,
    blocked: null,
    current: { commit: null, version: "1.0.0" },
    lastResult: null,
    runningThreadCount: 0,
    support: { kind: "supported", mode: "npm" },
  };
}

function systemVersion(latestVersion: string): SystemVersionResponse {
  return {
    currentCommit: null,
    installKind: "npm",
    currentVersion: "1.0.0",
    latestVersion,
    source: "npm",
    updateAvailable: true,
    isDevelopment: false,
    upgradeCommand: "npm install -g @get-bb/bb",
  };
}

function aiServices(
  selection: SystemAiServicesResponse["selections"]["thread-title"],
): SystemAiServicesResponse {
  return {
    selections: {
      "thread-title": selection,
      "commit-message": { mode: "automatic" },
      voice: { mode: "automatic" },
    },
    services: [],
  };
}

const applyingUpdate = appUpdateStatus({
  output: [],
  phase: "preparing",
  startedAt: "2026-10-29T00:00:00.000Z",
  step: "Downloading",
  targetVersion: "1.1.0",
});
const forcedVersion = systemVersion("1.2.0");
const selectedService = aiServices({
  mode: "service",
  pluginId: "bb-ai",
  serviceId: "bb",
});

const cases: WriteCase[] = [
  writeCase({
    label: "plugin settings save reply",
    queryKey: pluginSettingsViewQueryKey("notes"),
    stale: settingsView("old"),
    written: settingsView("new"),
    write: (queryClient) =>
      applyPluginSettingsView({
        queryClient,
        pluginId: "notes",
        view: settingsView("new"),
      }),
  }),
  writeCase({
    label: "plugin install cancel reply",
    queryKey: pluginInstallJobsQueryKey(),
    stale: [runningInstall],
    written: [cancellingInstall],
    write: (queryClient) =>
      applyPluginInstallJob({ queryClient, job: cancellingInstall }),
  }),
  writeCase({
    label: "plugin install start reply",
    queryKey: pluginInstallJobsQueryKey(),
    stale: [],
    written: [runningInstall],
    write: (queryClient) =>
      applyPluginInstallJob({ queryClient, job: runningInstall }),
  }),
  writeCase({
    label: "plugin update start reply",
    queryKey: pluginUpdateJobsQueryKey(),
    stale: [],
    written: [startedUpdate],
    write: (queryClient) =>
      applyPluginUpdateJob({ queryClient, job: startedUpdate }),
  }),
  writeCase({
    label: "app update apply reply",
    queryKey: systemAppUpdateQueryKey(),
    stale: appUpdateStatus({ phase: "idle" }),
    written: applyingUpdate,
    write: (queryClient) =>
      hydrateAppUpdateStatus({ queryClient, status: applyingUpdate }),
  }),
  writeCase({
    label: "forced version check",
    queryKey: systemVersionQueryKey(),
    stale: systemVersion("1.1.0"),
    written: forcedVersion,
    write: (queryClient) =>
      hydrateSystemVersionCache({ queryClient, version: forcedVersion }),
  }),
  writeCase({
    label: "AI service selection reply",
    queryKey: systemAiServicesQueryKey(),
    stale: aiServices({ mode: "automatic" }),
    written: selectedService,
    write: (queryClient) => writeCachedAiServices(queryClient, selectedService),
  }),
];

function observe(queryKey: QueryKey, firstFetch: Promise<unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const server = { current: undefined as unknown };
  const queryFn = vi
    .fn<() => Promise<unknown>>()
    .mockReturnValueOnce(firstFetch)
    .mockImplementation(async () => server.current);
  const observer = new QueryObserver(queryClient, { queryKey, queryFn });
  const unsubscribe = observer.subscribe(() => {});
  return { queryClient, queryFn, server, unsubscribe };
}

describe("cache writes over an in-flight fetch", () => {
  it.each(cases)(
    "keeps the $label when an older fetch lands later",
    async ({ queryKey, stale, written, write }) => {
      const staleFetch = deferred<unknown>();
      const f = observe(queryKey, staleFetch.promise);
      try {
        f.server.current = written;
        write(f.queryClient);
        staleFetch.resolve(stale);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(f.queryClient.getQueryData(queryKey)).toEqual(written);
        await vi.waitFor(() => expect(f.queryFn).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(f.queryClient.isFetching()).toBe(0));
        expect(f.queryClient.getQueryData(queryKey)).toEqual(written);
      } finally {
        f.unsubscribe();
        f.queryClient.clear();
      }
    },
  );

  it("writes without refetching when no fetch is in flight", async () => {
    const f = observe(["idle"], Promise.resolve("fetched"));
    try {
      await vi.waitFor(() => expect(f.queryClient.isFetching()).toBe(0));
      setQueryDataOverInFlightFetch(f.queryClient, ["idle"], "written");
      expect(f.queryClient.getQueryData(["idle"])).toBe("written");
      expect(f.queryClient.isFetching()).toBe(0);
      expect(f.queryFn).toHaveBeenCalledTimes(1);
    } finally {
      f.unsubscribe();
      f.queryClient.clear();
    }
  });

  it("keeps the write over a fetch of a query nothing observes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const staleFetch = deferred<string>();
    try {
      const prefetch = queryClient.prefetchQuery({
        queryKey: ["unobserved"],
        queryFn: () => staleFetch.promise,
      });
      setQueryDataOverInFlightFetch(queryClient, ["unobserved"], "written");
      staleFetch.resolve("stale");
      await prefetch;
      expect(queryClient.getQueryData(["unobserved"])).toBe("written");
      expect(queryClient.getQueryState(["unobserved"])?.isInvalidated).toBe(
        true,
      );
    } finally {
      queryClient.clear();
    }
  });
});
