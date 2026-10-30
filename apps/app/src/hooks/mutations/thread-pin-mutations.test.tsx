// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ThreadListEntry } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { afterEach, expect, it, vi } from "vitest";
import { appToast } from "@/components/ui/app-toast";
import { request } from "@/lib/api";
import { sdk } from "@/lib/sdk";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import type { QueryClient } from "@tanstack/react-query";
import {
  listSidebarNavigationThreads,
  updateCachedThreadListStatusState,
  updateCachedThreadStatusState,
} from "../cache-owners/query-cache";
import {
  sidebarNavigationQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";
import { useSidebarNavigation } from "../queries/sidebar-navigation-query";
import {
  useArchivedThreads,
  useThread,
  useThreads,
} from "../queries/thread-queries";
import { applyPinnedThreadOrderResult } from "../cache-owners/thread-state-cache-owner";
import { createThreadMutationBatcher } from "./thread-mutation-batcher";
import { usePinThread, useUnpinThread } from "./thread-state-mutations";

function writeEveryThreadList(
  queryClient: QueryClient,
  mapper: (list: ThreadListEntry[]) => ThreadListEntry[],
): void {
  queryClient.setQueriesData<ThreadListEntry[]>(
    { queryKey: threadsQueryKey() },
    (list) => (Array.isArray(list) ? mapper(list) : list),
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (sidebar) =>
      sidebar && {
        ...sidebar,
        personalProject: {
          ...sidebar.personalProject,
          threads: mapper(sidebar.personalProject.threads),
        },
        projects: sidebar.projects.map((project) => ({
          ...project,
          threads: mapper(project.threads),
        })),
      },
  );
}

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: vi.fn() },
}));
vi.mock("@/lib/api-server", () => ({
  apiClient: { "sidebar-bootstrap": { $get: vi.fn() } },
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  request: vi.fn(),
}));
vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      get: vi.fn(),
      list: vi.fn(),
      pin: vi.fn(),
      unpin: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentListRealtimeSubscription: () => {},
  useHostListRealtimeSubscription: () => {},
  useProjectListRealtimeSubscription: () => {},
  useThreadDetailRealtimeSubscription: () => {},
  useThreadListRealtimeSubscription: () => {},
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PROJECT_ID = "project-1";
const entry = (id: string, pinnedAt: number | null): ThreadListEntry =>
  makeThreadListEntry({
    id,
    projectId: PROJECT_ID,
    parentThreadId: null,
    pinnedAt,
    pinSortKey: null,
    status: "idle",
    updatedAt: 1,
  });

function serve(initial: ThreadListEntry[]) {
  let rows = initial;
  const navigation = (): SidebarBootstrapResponse =>
    makeSidebarBootstrapResponse({
      projects: [
        makeProjectWithThreadsResponse({ id: PROJECT_ID, threads: rows }),
      ],
    });
  vi.mocked(request).mockImplementation(async () => navigation());
  vi.mocked(sdk.threads.list).mockImplementation(async (args) =>
    structuredClone(
      rows.filter(
        (row) => (row.archivedAt !== null) === (args?.archived === true),
      ),
    ),
  );
  vi.mocked(sdk.threads.get).mockImplementation(async ({ threadId }) => {
    const row = rows.find((thread) => thread.id === threadId);
    if (row === undefined) throw new Error(threadId);
    return makeThreadResponse({ ...row });
  });
  const { queryClient, wrapper } = createQueryClientTestHarness();
  const view = renderHook(
    () => ({
      sidebar: useSidebarNavigation(),
      list: useThreads({ projectId: PROJECT_ID, archived: false }),
      thread: useThread("t1"),
      archived: useArchivedThreads({}),
      pin: usePinThread(),
      unpin: useUnpinThread(),
    }),
    { wrapper },
  );
  const pinnedAt = (id: string) => {
    const { sidebar, list, thread } = view.result.current;
    const rows = [
      thread.data?.id === id ? thread.data : undefined,
      list.data?.find((row) => row.id === id),
      sidebar.data &&
        listSidebarNavigationThreads(sidebar.data).find((row) => row.id === id),
    ];
    return rows.map((row) => (row === undefined ? "missing" : row.pinnedAt));
  };
  const realtimeRefresh = async () => {
    await act(async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: threadsQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: sidebarNavigationQueryKey(),
        }),
        queryClient.invalidateQueries({ queryKey: ["thread"] }),
      ]);
    });
  };
  const archivedPinnedAt = (id: string) =>
    view.result.current.archived.data?.pages.flat().find((row) => row.id === id)
      ?.pinnedAt;
  return {
    queryClient,
    view,
    wrapper,
    pinnedAt,
    archivedPinnedAt,
    realtimeRefresh,
    setRows(next: ThreadListEntry[]) {
      rows = next;
    },
  };
}

it("rolls back a failed pin under concurrent status and membership writes", async () => {
  const server = serve([entry("t1", null), entry("t2", null)]);
  await waitFor(() =>
    expect(server.pinnedAt("t1")).toEqual([null, null, null]),
  );
  const pin = createDeferredPromise<never>();
  vi.mocked(sdk.threads.pin).mockReturnValue(pin.promise);

  act(() => server.view.result.current.pin.mutate({ id: "t1" }));
  await waitFor(() =>
    expect(server.pinnedAt("t1")).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]),
  );

  act(() => {
    const statusChange = {
      status: "active" as const,
      runtime: { displayStatus: "active" as const },
      activity: entry("t1", null).activity,
      latestAttentionAt: 5,
      updatedAt: 5,
    };
    server.setRows([{ ...entry("t1", null), ...statusChange }]);
    updateCachedThreadListStatusState(server.queryClient, "t1", statusChange);
    updateCachedThreadStatusState(server.queryClient, "t1", statusChange);
    writeEveryThreadList(server.queryClient, (list) =>
      list.filter((thread) => thread.id !== "t2"),
    );
  });
  await act(async () => {
    pin.reject(new Error("pin refused"));
  });

  await waitFor(() =>
    expect(server.pinnedAt("t1")).toEqual([null, null, null]),
  );
  const { sidebar, list, thread } = server.view.result.current;
  expect(thread.data?.status).toBe("active");
  expect(list.data?.map((row) => [row.id, row.status])).toEqual([
    ["t1", "active"],
  ]);
  expect(
    listSidebarNavigationThreads(sidebar.data!).map((row) => row.status),
  ).toEqual(["active"]);
  expect(appToast.error).toHaveBeenCalledWith("Failed to pin thread", {
    description: "pin refused",
  });
});

it("keeps the latest pin toggle through stale reads until every write settles", async () => {
  const server = serve([entry("t1", null)]);
  await waitFor(() =>
    expect(server.pinnedAt("t1")).toEqual([null, null, null]),
  );
  const firstPin =
    createDeferredPromise<ReturnType<typeof makeThreadResponse>>();
  const lastPin =
    createDeferredPromise<ReturnType<typeof makeThreadResponse>>();
  const unpin = createDeferredPromise<ReturnType<typeof makeThreadResponse>>();
  vi.mocked(sdk.threads.pin)
    .mockReturnValueOnce(firstPin.promise)
    .mockReturnValueOnce(lastPin.promise);
  vi.mocked(sdk.threads.unpin).mockReturnValue(unpin.promise);
  const visiblyPinned = () =>
    server.pinnedAt("t1").every((value) => typeof value === "number");

  act(() => server.view.result.current.pin.mutate({ id: "t1" }));
  act(() => server.view.result.current.unpin.mutate({ id: "t1" }));
  act(() => server.view.result.current.pin.mutate({ id: "t1" }));
  await waitFor(() => expect(visiblyPinned()).toBe(true));

  await server.realtimeRefresh();
  expect(visiblyPinned()).toBe(true);

  server.setRows([entry("t1", 100)]);
  await act(async () => firstPin.resolve(makeThreadResponse(entry("t1", 100))));
  await server.realtimeRefresh();
  expect(visiblyPinned()).toBe(true);

  server.setRows([entry("t1", null)]);
  await act(async () => unpin.resolve(makeThreadResponse(entry("t1", null))));
  await server.realtimeRefresh();
  expect(visiblyPinned()).toBe(true);

  server.setRows([entry("t1", 300)]);
  await act(async () => lastPin.resolve(makeThreadResponse(entry("t1", 300))));
  await waitFor(() => expect(server.pinnedAt("t1")).toEqual([300, 300, 300]));

  server.setRows([entry("t1", null)]);
  await server.realtimeRefresh();
  await waitFor(() =>
    expect(server.pinnedAt("t1")).toEqual([null, null, null]),
  );
});

it("shows the server's pinnedAt as soon as the pin is acknowledged", async () => {
  const server = serve([entry("t1", null)]);
  await waitFor(() =>
    expect(server.pinnedAt("t1")).toEqual([null, null, null]),
  );
  const pin = createDeferredPromise<ReturnType<typeof makeThreadResponse>>();
  vi.mocked(sdk.threads.pin).mockReturnValue(pin.promise);
  act(() => server.view.result.current.pin.mutate({ id: "t1" }));
  await waitFor(() => expect(typeof server.pinnedAt("t1")[0]).toBe("number"));
  const never = new Promise<never>(() => {});
  vi.mocked(sdk.threads.list).mockReturnValue(never);
  vi.mocked(sdk.threads.get).mockReturnValue(never);
  vi.mocked(request).mockReturnValue(never);

  await act(async () =>
    pin.resolve(makeThreadResponse({ ...entry("t1", 777) })),
  );

  await waitFor(() => expect(server.pinnedAt("t1")).toEqual([777, 777, 777]));
});

it("predicts on a thread list mounted while the pin is pending", async () => {
  const server = serve([entry("t1", null)]);
  await waitFor(() =>
    expect(server.pinnedAt("t1")).toEqual([null, null, null]),
  );
  const pin = createDeferredPromise<never>();
  vi.mocked(sdk.threads.pin).mockReturnValue(pin.promise);
  act(() => server.view.result.current.pin.mutate({ id: "t1" }));

  const late = renderHook(
    () => useThreads({ projectId: PROJECT_ID, archived: false, limit: 5 }),
    { wrapper: server.wrapper },
  );
  await waitFor(() =>
    expect(typeof late.result.current.data?.[0]?.pinnedAt).toBe("number"),
  );

  await act(async () => pin.reject(new Error("pin refused")));
  await waitFor(() =>
    expect(late.result.current.data?.[0]?.pinnedAt).toBeNull(),
  );
});

it("pins an archived thread optimistically in the archived list", async () => {
  const archived = { ...entry("t3", null), archivedAt: 5 };
  const server = serve([entry("t1", null), archived]);
  await waitFor(() => expect(server.archivedPinnedAt("t3")).toBeNull());
  const pin = createDeferredPromise<never>();
  vi.mocked(sdk.threads.pin).mockReturnValue(pin.promise);
  const threads = createThreadMutationBatcher(sdk.threads, server.queryClient);

  const pinned = threads.pin({ threadId: "t3" }).catch(() => {});
  await waitFor(() =>
    expect(typeof server.archivedPinnedAt("t3")).toBe("number"),
  );
  await act(async () => {
    pin.reject(new Error("pin refused"));
    await pinned;
  });
  await waitFor(() => expect(server.archivedPinnedAt("t3")).toBeNull());
});

it("reverts an acknowledged unpin when the rest of its move fails", async () => {
  const server = serve([{ ...entry("t1", 50), sectionId: "old" }]);
  await waitFor(() => expect(server.pinnedAt("t1")).toEqual([50, 50, 50]));
  const update = createDeferredPromise<never>();
  vi.mocked(sdk.threads.unpin).mockResolvedValue(
    makeThreadResponse({ ...entry("t1", null), sectionId: "old" }),
  );
  vi.mocked(sdk.threads.update).mockReturnValue(update.promise);
  const threads = createThreadMutationBatcher(sdk.threads, server.queryClient);
  const sidebarRow = () =>
    listSidebarNavigationThreads(server.view.result.current.sidebar.data!)[0];
  const never = new Promise<never>(() => {});

  const moved = Promise.all([
    threads.unpin({ threadId: "t1" }),
    threads.update({ threadId: "t1", sectionId: "new" }),
  ]).catch(() => {});
  await waitFor(() =>
    expect(sidebarRow()).toMatchObject({ pinnedAt: null, sectionId: "new" }),
  );
  await waitFor(() => expect(sdk.threads.update).toHaveBeenCalled());
  vi.mocked(request).mockReturnValue(never);
  vi.mocked(sdk.threads.list).mockReturnValue(never);
  vi.mocked(sdk.threads.get).mockReturnValue(never);
  await act(async () => {
    update.reject(new Error("move refused"));
    await moved;
  });

  await waitFor(() =>
    expect(sidebarRow()).toMatchObject({ pinnedAt: 50, sectionId: "old" }),
  );
  expect(server.pinnedAt("t1")).toEqual([50, 50, 50]);
});

async function acknowledgedPin(server: ReturnType<typeof serve>) {
  await waitFor(() =>
    expect(server.pinnedAt("t1")).toEqual([null, null, null]),
  );
  const pin = createDeferredPromise<ReturnType<typeof makeThreadResponse>>();
  vi.mocked(sdk.threads.pin).mockReturnValue(pin.promise);
  act(() => server.view.result.current.pin.mutate({ id: "t1" }));
  await waitFor(() => expect(typeof server.pinnedAt("t1")[0]).toBe("number"));
  const never = new Promise<never>(() => {});
  vi.mocked(sdk.threads.list).mockReturnValue(never);
  vi.mocked(sdk.threads.get).mockReturnValue(never);
  vi.mocked(request).mockReturnValue(never);
  return (pinnedAt: number) =>
    act(async () =>
      pin.resolve(makeThreadResponse({ ...entry("t1", pinnedAt) })),
    );
}

it("reads the thread back when a pin response is older than concurrent thread state", async () => {
  const server = serve([entry("t1", null)]);
  const acknowledge = await acknowledgedPin(server);
  vi.mocked(sdk.threads.get).mockResolvedValue(
    makeThreadResponse({
      ...entry("t1", 777),
      status: "active",
      runtime: { displayStatus: "active" },
      updatedAt: 30,
      sectionId: "new",
      lastReadAt: 25,
    }),
  );
  act(() => {
    const statusChange = {
      status: "active" as const,
      runtime: { displayStatus: "active" as const },
      activity: entry("t1", null).activity,
      latestAttentionAt: 5,
      updatedAt: 30,
    };
    updateCachedThreadListStatusState(server.queryClient, "t1", statusChange);
    updateCachedThreadStatusState(server.queryClient, "t1", statusChange);
    writeEveryThreadList(server.queryClient, (list) =>
      list.map((thread) =>
        thread.id === "t1"
          ? { ...thread, sectionId: "new", lastReadAt: 25 }
          : thread,
      ),
    );
  });

  await acknowledge(777);

  await waitFor(() => expect(server.pinnedAt("t1")).toEqual([777, 777, 777]));
  const { sidebar, list, thread } = server.view.result.current;
  expect(thread.data).toMatchObject({
    status: "active",
    runtime: { displayStatus: "active" },
    updatedAt: 30,
  });
  for (const row of [
    list.data?.[0],
    listSidebarNavigationThreads(sidebar.data!)[0],
  ])
    expect(row).toMatchObject({
      status: "active",
      runtime: { displayStatus: "active" },
      updatedAt: 30,
      sectionId: "new",
      lastReadAt: 25,
    });
});

it("shows the pinned order written after the pin is acknowledged", async () => {
  const server = serve([entry("t1", null)]);
  const acknowledge = await acknowledgedPin(server);
  await acknowledge(777);
  await waitFor(() => expect(server.pinnedAt("t1")).toEqual([777, 777, 777]));

  act(() =>
    applyPinnedThreadOrderResult({
      queryClient: server.queryClient,
      orderedRoots: [{ ...entry("t1", 777), pinSortKey: "b" }],
    }),
  );

  await waitFor(() => {
    const { sidebar, list } = server.view.result.current;
    expect(list.data?.[0]?.pinSortKey).toBe("b");
    expect(listSidebarNavigationThreads(sidebar.data!)[0]?.pinSortKey).toBe(
      "b",
    );
  });
});
