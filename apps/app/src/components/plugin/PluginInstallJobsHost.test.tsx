// @vitest-environment jsdom

import { MemoryRouter } from "react-router-dom";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginInstallJob } from "@bb/server-contract";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { appToast } from "@/components/ui/app-toast";
import {
  pluginCatalogSearchQueryKey,
  pluginInstallJobsQueryKey,
  pluginListQueryKey,
} from "@/hooks/queries/query-keys";
import { PluginInstallJobsHost } from "./PluginInstallJobsHost";

const BASE = {
  id: "job-1",
  target: { kind: "catalog", entryId: "notes", marketplace: "bb-community" },
  displayName: "Notes",
} as const;

const PLUGIN = makeInstalledPlugin({ id: "notes", name: "Notes" });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ jobs: [] }))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderHost(initial: PluginInstallJob[]) {
  const { wrapper, queryClient } = createQueryClientTestHarness({
    queries: { staleTime: Infinity },
  });
  queryClient.setQueryData(pluginInstallJobsQueryKey(), initial);
  render(
    <MemoryRouter>
      <PluginInstallJobsHost />
    </MemoryRouter>,
    { wrapper },
  );
  return {
    queryClient,
    publish: (jobs: PluginInstallJob[]) =>
      act(async () => {
        queryClient.setQueryData(pluginInstallJobsQueryKey(), jobs);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }),
  };
}

it("replaces the progress toast with the result once a watched install finishes", async () => {
  const loading = vi.spyOn(appToast, "loading").mockReturnValue("toast");
  const success = vi.spyOn(appToast, "success").mockReturnValue("toast");
  const { queryClient, publish } = renderHost([{ ...BASE, state: "running" }]);
  queryClient.setQueryData(pluginListQueryKey(true), []);
  queryClient.setQueryData(pluginCatalogSearchQueryKey(""), []);

  await publish([{ ...BASE, state: "succeeded", plugin: PLUGIN }]);

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

it("stays quiet about installs that finished before it was watching", async () => {
  const success = vi.spyOn(appToast, "success").mockReturnValue("toast");
  const error = vi.spyOn(appToast, "error").mockReturnValue("toast");
  const { publish } = renderHost([
    { ...BASE, state: "succeeded", plugin: PLUGIN },
    { ...BASE, id: "job-2", state: "failed", error: "boom" },
  ]);

  await publish([
    { ...BASE, state: "succeeded", plugin: PLUGIN },
    { ...BASE, id: "job-2", state: "failed", error: "boom" },
  ]);

  expect(success).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

it("reports each failure and cancellation once", async () => {
  vi.spyOn(appToast, "loading").mockReturnValue("toast");
  const error = vi.spyOn(appToast, "error").mockReturnValue("toast");
  const message = vi.spyOn(appToast, "message").mockReturnValue("toast");
  const { publish } = renderHost([
    { ...BASE, state: "running" },
    { ...BASE, id: "job-2", state: "queued" },
  ]);

  const finished: PluginInstallJob[] = [
    { ...BASE, state: "failed", error: "npm install failed" },
    { ...BASE, id: "job-2", state: "cancelled" },
  ];
  await publish(finished);
  await publish([...finished]);

  expect(error).toHaveBeenCalledTimes(1);
  expect(error.mock.calls[0]?.[0]).toBe("Plugin installation failed");
  expect(message).toHaveBeenCalledTimes(1);
  expect(message.mock.calls[0]?.[0]).toBe("Plugin install cancelled");
});
