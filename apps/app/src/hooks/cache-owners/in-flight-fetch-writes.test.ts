import {
  QueryClient,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { PluginInstallJob, PluginUpdateJob } from "@bb/server-contract";
import type { PluginSettingsView } from "../queries/plugin-settings-queries";
import {
  pluginInstallJobsQueryKey,
  pluginSettingsViewQueryKey,
  pluginUpdateJobsQueryKey,
} from "../queries/query-keys";
import { setQueryDataOverInFlightFetch } from "./cache-effect-utils";
import {
  applyPluginInstallJob,
  applyPluginSettingsView,
  applyPluginUpdateJob,
} from "./plugin-cache-owner";

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
