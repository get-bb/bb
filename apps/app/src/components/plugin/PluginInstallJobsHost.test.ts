import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type {
  PluginInstallJob,
  PluginInstallJobState,
} from "@bb/server-contract";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";
import { appToast } from "@/components/ui/app-toast";
import {
  pluginCatalogSearchQueryKey,
  pluginListQueryKey,
} from "@/hooks/queries/query-keys";
import { reportPluginInstallJobs } from "./PluginInstallJobsHost";

const BASE = {
  id: "job-1",
  target: { kind: "catalog", entryId: "notes", marketplace: "bb-community" },
  displayName: "Notes",
} as const;

const PLUGIN = makeInstalledPlugin({ id: "notes", name: "Notes" });

afterEach(() => {
  vi.restoreAllMocks();
});

function createReporter() {
  const queryClient = new QueryClient();
  const seenStates = new Map<string, PluginInstallJobState>();
  return {
    queryClient,
    publish: (jobs: PluginInstallJob[]) =>
      reportPluginInstallJobs({
        jobs,
        seenStates,
        queryClient,
        cancelJob: () => {},
        action: () => ({ label: "Details", onClick: () => {} }),
      }),
  };
}

it("replaces the progress toast with the result once a watched install finishes", () => {
  const loading = vi.spyOn(appToast, "loading").mockReturnValue("toast");
  const success = vi.spyOn(appToast, "success").mockReturnValue("toast");
  const { queryClient, publish } = createReporter();
  publish([{ ...BASE, state: "running" }]);
  queryClient.setQueryData(pluginListQueryKey(true), []);
  queryClient.setQueryData(pluginCatalogSearchQueryKey(""), []);

  publish([{ ...BASE, state: "succeeded", plugin: PLUGIN }]);

  expect(loading).toHaveBeenCalledWith(
    "Installing plugin…",
    expect.objectContaining({ id: "plugin-install:job-1" }),
  );
  expect(success).toHaveBeenCalledWith(
    "Plugin installed",
    expect.objectContaining({ id: "plugin-install:job-1" }),
  );
  expect(queryClient.getQueryData(pluginListQueryKey(true))).toEqual([PLUGIN]);
  expect(
    queryClient.getQueryState(pluginCatalogSearchQueryKey(""))?.isInvalidated,
  ).toBe(true);
});

it("stays quiet about installs that finished before it was watching", () => {
  const success = vi.spyOn(appToast, "success").mockReturnValue("toast");
  const error = vi.spyOn(appToast, "error").mockReturnValue("toast");
  const { publish } = createReporter();
  const finished: PluginInstallJob[] = [
    { ...BASE, state: "succeeded", plugin: PLUGIN },
    { ...BASE, id: "job-2", state: "failed", error: "boom" },
  ];

  publish(finished);
  publish([...finished]);

  expect(success).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

it("reports each failure and cancellation once", () => {
  vi.spyOn(appToast, "loading").mockReturnValue("toast");
  const error = vi.spyOn(appToast, "error").mockReturnValue("toast");
  const message = vi.spyOn(appToast, "message").mockReturnValue("toast");
  const { publish } = createReporter();
  publish([
    { ...BASE, state: "running" },
    { ...BASE, id: "job-2", state: "queued" },
  ]);

  const finished: PluginInstallJob[] = [
    { ...BASE, state: "failed", error: "npm install failed" },
    { ...BASE, id: "job-2", state: "cancelled" },
  ];
  publish(finished);
  publish([...finished]);

  expect(error).toHaveBeenCalledTimes(1);
  expect(error.mock.calls[0]?.[0]).toBe("Plugin installation failed");
  expect(message).toHaveBeenCalledTimes(1);
  expect(message.mock.calls[0]?.[0]).toBe("Plugin install cancelled");
});
