// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ExperimentalThreadState } from "@get-bb/plugin-sdk";
import { memo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  sidebarNavigationQueryKey,
  threadQueryKey,
} from "@/hooks/queries/query-keys";
import { BbHttpError, sdk } from "@/lib/sdk";
import { addSidebarThreads } from "@/test/fixtures/related-threads";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { makeSidebarBootstrapResponse } from "@/test/fixtures/projects";
import { useSidebarThreadEntries } from "./sidebar-thread-entries";
import { useThreadState } from "./thread-state";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderStates(queryClient: QueryClient, threadIds: readonly string[]) {
  const seen = new Map<string, ExperimentalThreadState>();
  const renders = new Map<string, number>();
  const history = new Map<string, string[]>();
  const Reader = memo(function Reader({ threadId }: { threadId: string }) {
    renders.set(threadId, (renders.get(threadId) ?? 0) + 1);
    const state = useThreadState(threadId);
    seen.set(threadId, state);
    history.set(threadId, [...(history.get(threadId) ?? []), state.status]);
    return null;
  });
  render(
    <QueryClientProvider client={queryClient}>
      {threadIds.map((threadId) => (
        <Reader key={threadId} threadId={threadId} />
      ))}
    </QueryClientProvider>,
  );
  return { seen, renders, history };
}

function httpError(status: number): BbHttpError {
  return new BbHttpError({
    body: null,
    code: null,
    message: "failed",
    status,
  });
}

describe("useThreadState", () => {
  it("reads a held thread without a request and re-renders only when that thread changes", async () => {
    const get = vi.spyOn(sdk.threads, "get");
    const queryClient = createQueryClient();
    const watched = makeThreadListEntry({
      id: "thr_watched",
      title: "Watched",
    });
    addSidebarThreads(queryClient, "proj_1", [
      watched,
      makeThreadListEntry({ id: "thr_other", title: "Other" }),
    ]);
    let listRenders = 0;
    function WholeList() {
      listRenders += 1;
      useSidebarThreadEntries();
      return null;
    }
    const { seen, renders } = renderStates(queryClient, ["thr_watched"]);
    render(
      <QueryClientProvider client={queryClient}>
        <WholeList />
      </QueryClientProvider>,
    );
    expect(seen.get("thr_watched")).toMatchObject({
      status: "ready",
      thread: { id: "thr_watched", title: "Watched" },
    });
    expect(get).not.toHaveBeenCalled();
    const before = { watched: renders.get("thr_watched"), list: listRenders };

    await act(async () => {
      addSidebarThreads(queryClient, "proj_1", [
        makeThreadListEntry({ id: "thr_other", title: "Renamed" }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(listRenders).toBeGreaterThan(before.list);
    expect(renders.get("thr_watched")).toBe(before.watched);

    await act(async () => {
      addSidebarThreads(queryClient, "proj_1", [
        { ...watched, title: "Watched again" },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renders.get("thr_watched")).toBe((before.watched ?? 0) + 1);
    expect(seen.get("thr_watched")?.thread?.title).toBe("Watched again");
  });

  it("fetches a thread the sidebar does not hold into the same shape as a held one", async () => {
    const queryClient = createQueryClient();
    addSidebarThreads(queryClient, "proj_1", [
      makeThreadListEntry({ id: "thr_held", projectId: "proj_1" }),
    ]);
    let resolveFetch: (
      thread: ReturnType<typeof makeThreadResponse>,
    ) => void = () => {};
    vi.spyOn(sdk.threads, "get").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const { seen } = renderStates(queryClient, ["thr_held", "thr_archived"]);
    expect(seen.get("thr_archived")).toEqual({
      status: "loading",
      thread: null,
    });

    await act(async () => {
      resolveFetch(
        makeThreadResponse({
          id: "thr_archived",
          projectId: "proj_1",
          archivedAt: 5,
          canEditMessages: true,
        }),
      );
    });
    await waitFor(() => {
      expect(seen.get("thr_archived")).toMatchObject({
        status: "ready",
        thread: { id: "thr_archived", archivedAt: 5 },
      });
    });
    const fetched = seen.get("thr_archived");
    const held = seen.get("thr_held");
    expect(Object.keys(fetched?.thread ?? {}).sort()).toEqual(
      Object.keys(held?.thread ?? {}).sort(),
    );
    expect(held?.thread).not.toHaveProperty("activity");
    expect(fetched?.thread).not.toHaveProperty("canEditMessages");
  });

  it("tells a missing thread apart from a failed read", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarBootstrapResponse(),
    );
    vi.spyOn(sdk.threads, "get").mockImplementation(async ({ threadId }) => {
      throw httpError(threadId === "thr_deleted" ? 404 : 500);
    });
    const { seen } = renderStates(queryClient, ["thr_deleted", "thr_broken"]);
    await waitFor(() => {
      expect(seen.get("thr_deleted")?.status).toBe("notFound");
      expect(seen.get("thr_broken")?.status).toBe("error");
    });
  });

  it("reads a fetched thread as not found once it is deleted while watched", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarBootstrapResponse(),
    );
    const get = vi
      .spyOn(sdk.threads, "get")
      .mockResolvedValue(
        makeThreadResponse({ id: "thr_archived", archivedAt: 5 }),
      );
    const { seen } = renderStates(queryClient, ["thr_archived"]);
    await waitFor(() => {
      expect(seen.get("thr_archived")?.status).toBe("ready");
    });

    get.mockRejectedValue(httpError(404));
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: threadQueryKey("thr_archived"),
      });
    });
    await waitFor(() => {
      expect(seen.get("thr_archived")).toEqual({
        status: "notFound",
        thread: null,
      });
    });
  });

  it("reads thread data that carries deletedAt as not found", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarBootstrapResponse(),
    );
    queryClient.setQueryData(
      threadQueryKey("thr_gone"),
      makeThreadResponse({ id: "thr_gone", deletedAt: 9 }),
    );
    vi.spyOn(sdk.threads, "get").mockImplementation(
      () => new Promise(() => {}),
    );
    const { seen } = renderStates(queryClient, ["thr_gone"]);
    expect(seen.get("thr_gone")).toEqual({ status: "notFound", thread: null });
  });

  it("keeps a thread that leaves the sidebar ready until its fetch answers", async () => {
    const queryClient = createQueryClient();
    addSidebarThreads(queryClient, "proj_1", [
      makeThreadListEntry({ id: "thr_leaving", projectId: "proj_1" }),
    ]);
    let resolveFetch: (
      thread: ReturnType<typeof makeThreadResponse>,
    ) => void = () => {};
    vi.spyOn(sdk.threads, "get").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const { seen, history } = renderStates(queryClient, ["thr_leaving"]);

    await act(async () => {
      queryClient.setQueryData(
        sidebarNavigationQueryKey(),
        makeSidebarBootstrapResponse(),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(seen.get("thr_leaving")).toMatchObject({
      status: "ready",
      thread: { id: "thr_leaving", archivedAt: null },
    });

    await act(async () => {
      resolveFetch(
        makeThreadResponse({
          id: "thr_leaving",
          projectId: "proj_1",
          archivedAt: 7,
        }),
      );
    });
    await waitFor(() => {
      expect(seen.get("thr_leaving")?.thread?.archivedAt).toBe(7);
    });
    expect(history.get("thr_leaving")).not.toContain("loading");
  });

  it("reports an empty id as not found without a request", () => {
    const get = vi.spyOn(sdk.threads, "get");
    const { seen } = renderStates(createQueryClient(), [""]);
    expect(seen.get("")).toEqual({ status: "notFound", thread: null });
    expect(get).not.toHaveBeenCalled();
  });
});
