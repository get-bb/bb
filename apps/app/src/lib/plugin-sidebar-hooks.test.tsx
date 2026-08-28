// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import type { QueryObserverSuccessResult } from "@tanstack/react-query";
import {
  PERSONAL_PROJECT_ID,
  type Host,
  type ThreadListEntry,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import * as hostQueries from "@/hooks/queries/host-queries";
import * as sidebarNavigationQuery from "@/hooks/queries/sidebar-navigation-query";
import { useSidebarThreads } from "./plugin-sidebar-hooks";

type SidebarData = NonNullable<
  ReturnType<typeof sidebarNavigationQuery.useSidebarNavigation>["data"]
>;
let sidebarData: SidebarData | undefined;
const emptyHosts: Host[] = [];

function successQueryResult<T>(data: T): QueryObserverSuccessResult<T, Error> {
  return {
    data,
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isLoading: false,
    isPending: false,
    isLoadingError: false,
    isInitialLoading: false,
    isPaused: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isSuccess: true,
    isEnabled: true,
    refetch: async () => successQueryResult(data),
    status: "success",
    fetchStatus: "idle",
    promise: Promise.resolve(data),
  };
}

function sidebarQueryData(): SidebarData {
  if (sidebarData === undefined) {
    throw new Error("Expected sidebar data before rendering the hook");
  }
  return sidebarData;
}

vi.spyOn(sidebarNavigationQuery, "useSidebarNavigation").mockImplementation(
  () => successQueryResult(sidebarQueryData()),
);
vi.spyOn(hostQueries, "useHosts").mockImplementation(() =>
  successQueryResult(emptyHosts),
);

function payload(threads: ThreadListEntry[]): SidebarData {
  const project: SidebarData["projects"][number] = {
    id: "proj_app",
    kind: "standard",
    name: "App",
    gitRemoteUrl: null,
    createdAt: 1,
    updatedAt: 1,
    sources: [],
    threads,
    defaultExecutionOptions: null,
  };
  const personalProject: SidebarData["personalProject"] = {
    id: PERSONAL_PROJECT_ID,
    kind: "personal",
    name: "Personal",
    gitRemoteUrl: null,
    createdAt: 1,
    updatedAt: 1,
    sources: [],
    threads: [],
    defaultExecutionOptions: null,
  };
  return {
    sections: [],
    projects: [project],
    personalProject,
  };
}

afterEach(() => {
  cleanup();
  sidebarData = undefined;
});

describe("useSidebarThreads", () => {
  it("keeps DTO identity for entries that did not change across a sidebar update", () => {
    const stable = makeThreadListEntry({ id: "thr_stable", title: "Stable" });
    const changing = makeThreadListEntry({ id: "thr_changing", title: "One" });
    sidebarData = payload([stable, changing]);
    const { result, rerender } = renderHook(() => useSidebarThreads());
    const before = result.current.threads;
    expect(before.map((thread) => thread.id)).toEqual([
      "thr_stable",
      "thr_changing",
    ]);

    sidebarData = payload([
      stable,
      makeThreadListEntry({ id: "thr_changing", title: "Two" }),
    ]);
    rerender();
    const after = result.current.threads;
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]?.title).toBe("Two");
  });

  it("shares DTO identity between two consumers of the same payload", () => {
    const stable = makeThreadListEntry({ id: "thr_stable", title: "Stable" });
    sidebarData = payload([stable]);
    const first = renderHook(() => useSidebarThreads());
    const second = renderHook(() => useSidebarThreads());
    expect(second.result.current.threads[0]).toBe(
      first.result.current.threads[0],
    );
    const before = first.result.current.threads[0];
    first.rerender();
    second.rerender();
    expect(first.result.current.threads[0]).toBe(before);
    expect(second.result.current.threads[0]).toBe(before);
  });
});
