// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ThreadListEntry } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as pluginContributionQueries from "./queries/plugin-contribution-queries";
import * as sidebarNavigationQuery from "./queries/sidebar-navigation-query";
import * as threadQueries from "./queries/thread-queries";
import * as pathSuggestions from "./usePathSuggestions";
import { usePromptMentions } from "./usePromptMentions";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";

function queryResult<T>(data: T | undefined): UseQueryResult<T, Error> {
  const common = {
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    errorUpdateCount: 0,
    failureCount: 0,
    failureReason: null,
    fetchStatus: "idle" as const,
    isEnabled: true,
    isError: false,
    isFetching: false,
    isLoadingError: false,
    isPaused: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    refetch: async () => queryResult(data),
  } as const;
  if (data === undefined) {
    return {
      ...common,
      data: undefined,
      isFetched: false,
      isFetchedAfterMount: false,
      isInitialLoading: true,
      isLoading: true,
      isPending: true,
      isSuccess: false,
      promise: new Promise<T>(() => {}),
      status: "pending" as const,
    };
  }
  return {
    ...common,
    data,
    isFetched: true,
    isFetchedAfterMount: true,
    isInitialLoading: false,
    isLoading: false,
    isPending: false,
    isSuccess: true,
    promise: Promise.resolve(data),
    status: "success" as const,
  };
}

const usePathSuggestions = vi.spyOn(pathSuggestions, "usePathSuggestions");
const usePluginContributions = vi.spyOn(
  pluginContributionQueries,
  "usePluginContributions",
);
const usePluginMentionSearch = vi.spyOn(
  pluginContributionQueries,
  "usePluginMentionSearch",
);
const useSidebarNavigation = vi.spyOn(
  sidebarNavigationQuery,
  "useSidebarNavigation",
);
const useThreadMentionCandidates = vi.spyOn(
  threadQueries,
  "useThreadMentionCandidates",
);

function makeThread(): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_existing",
    projectId: "proj_1",
    environmentId: "env_worktree",
    providerId: "codex",
    title: "Only worktree thread",
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
  });
}

beforeEach(() => {
  usePathSuggestions.mockReturnValue({
    suggestions: [],
    isLoading: false,
    isError: false,
    isDebouncing: false,
  });
  usePluginContributions.mockImplementation(() => {
    return queryResult({ mentionProviders: [] });
  });
  usePluginMentionSearch.mockImplementation(() => {
    return queryResult<pluginContributionQueries.PluginMentionSearchGroup[]>(
      undefined,
    );
  });
  useSidebarNavigation.mockImplementation(() => {
    return queryResult<SidebarBootstrapResponse>(undefined);
  });
  useThreadMentionCandidates.mockImplementation(() => {
    return {
      data: [makeThread()],
      isLoading: false,
      isFetching: false,
      isError: false,
    };
  });
});

describe("usePromptMentions thread contexts", () => {
  it("can mention the only thread in a reused worktree while searching its storage", () => {
    const { result } = renderHook(() =>
      usePromptMentions("proj_1", {
        environmentId: "env_worktree",
        threadStorageThreadId: "thr_existing",
      }),
    );

    act(() => {
      result.current.setQuery("Only worktree", "@");
    });

    expect(result.current.suggestions).toEqual([
      expect.objectContaining({
        kind: "thread",
        threadId: "thr_existing",
      }),
    ]);
    expect(usePathSuggestions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentThreadId: "thr_existing",
        environmentId: "env_worktree",
      }),
    );
  });
});
