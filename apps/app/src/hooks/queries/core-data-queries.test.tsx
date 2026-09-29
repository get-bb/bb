// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { sdk } from "@/lib/sdk";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import {
  applyProjectUpdateResult,
  applyProjectDeleteResult,
} from "../cache-owners/project-cache-owner";
import { usePluginList } from "./plugin-settings-queries";
import { usePluginCatalogSearch } from "./plugin-catalog-queries";
import { pluginListQueryKey, pluginCatalogSearchQueryKey } from "./query-keys";
import { useHosts } from "./host-queries";
import { useProjects } from "./project-queries";
import { hostsQueryKey, projectsQueryKey } from "./query-keys";

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

it("shares full SDK host objects and invalidation between core and plugin consumers", async () => {
  const host = makeHost({ id: "host-shared", name: "Before" });
  const list = vi.spyOn(sdk.hosts, "list").mockResolvedValue([host]);
  const { client, wrapper } = setup();
  const { result } = renderHook(
    () => ({
      core: useHosts(),
      plugin: pluginSdkAppImplementation.experimental_useHosts(),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.plugin.data).toEqual([host]));
  expect(result.current.core.data).toBe(result.current.plugin.data);
  expect(list).toHaveBeenCalledTimes(1);
  const renamed = { ...host, name: "After" };
  list.mockResolvedValue([renamed]);
  await act(() => client.invalidateQueries({ queryKey: hostsQueryKey() }));
  await waitFor(() => expect(result.current.core.data).toEqual([renamed]));
  expect(result.current.plugin.data).toBe(result.current.core.data);
  expect(list).toHaveBeenCalledTimes(2);
});

it("keeps project list variants separate and preserves included threads when core mutations patch them", async () => {
  const project = {
    id: "project-one",
    name: "Before",
    kind: "standard" as const,
    gitRemoteUrl: null,
    sources: [],
    createdAt: 0,
    updatedAt: 0,
  };
  const included = { ...project, threads: [], defaultExecutionOptions: null };
  const personal = { ...project, id: "personal", kind: "personal" as const };
  vi.spyOn(sdk.projects, "list").mockImplementation(async (options) =>
    options?.include === "threads"
      ? [included]
      : options?.includePersonal
        ? [project, personal]
        : [project],
  );
  const { client, wrapper } = setup();
  const { result, unmount } = renderHook(
    () => ({
      core: useProjects({ include: "threads" }),
      plugin: pluginSdkAppImplementation.experimental_useProjects({
        includePersonal: true,
      }),
    }),
    { wrapper },
  );
  await waitFor(() =>
    expect(result.current.plugin.data).toEqual([project, personal]),
  );
  expect(result.current.core.data).toEqual([included]);
  act(() =>
    applyProjectUpdateResult({
      queryClient: client,
      project: { ...project, name: "After" },
    }),
  );
  await waitFor(() =>
    expect(result.current.core.data).toEqual([{ ...included, name: "After" }]),
  );
  expect(result.current.plugin.data).toEqual([
    { ...project, name: "After" },
    personal,
  ]);
  unmount();
  applyProjectDeleteResult({ queryClient: client, projectId: project.id });
  expect(client.getQueryData(projectsQueryKey(false, "threads"))).toEqual([]);
  expect(client.getQueryData(projectsQueryKey(true))).toEqual([personal]);
});

it("does not fetch or refresh missing entity IDs", async () => {
  const getThread = vi.spyOn(sdk.threads, "get");
  const getEnvironment = vi.spyOn(sdk.environments, "get");
  const { wrapper } = setup();
  const { result } = renderHook(
    () => ({
      thread: pluginSdkAppImplementation.experimental_useThread(null),
      environment: pluginSdkAppImplementation.experimental_useEnvironment(null),
    }),
    { wrapper },
  );
  await act(async () => {
    await result.current.thread.refetch();
    await result.current.environment.refetch();
  });
  expect(getThread).not.toHaveBeenCalled();
  expect(getEnvironment).not.toHaveBeenCalled();
  expect(result.current.thread.isLoading).toBe(false);
  expect(result.current.environment.data).toBeUndefined();
});

it("shares inventory and catalog requests between core screens and SDK hooks while preserving SDK envelopes", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    Response.json(
      String(input).includes("plugin-catalog")
        ? { results: [], collections: [] }
        : { plugins: [] },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const { client, wrapper } = setup();
  const { result } = renderHook(
    () => ({
      core: usePluginList({ enabled: true }),
      plugins: pluginSdkAppImplementation.experimental_usePlugins(),
      coreCatalog: usePluginCatalogSearch("shared", { enabled: true }),
      catalog: pluginSdkAppImplementation.experimental_usePluginCatalogSearch({
        query: "shared",
      }),
    }),
    { wrapper },
  );
  await waitFor(() =>
    expect(result.current.catalog.data).toEqual({
      results: [],
      collections: [],
    }),
  );
  expect(result.current.plugins.data).toEqual({ plugins: [] });
  expect(result.current.coreCatalog.data).toEqual({
    entries: [],
    collections: [],
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => {
    await client.invalidateQueries({ queryKey: pluginListQueryKey(true) });
    await client.invalidateQueries({
      queryKey: pluginCatalogSearchQueryKey("shared"),
    });
  });
  expect(fetcher).toHaveBeenCalledTimes(4);
});
