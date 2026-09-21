import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type { DiffFileEntry } from "@bb/server-contract";
import type { EnvironmentDiffSearchArgs } from "@bb/sdk/browser";
import { sdk } from "@/lib/sdk";
import {
  environmentDiffSearchQueryKey,
  environmentDiffTargetKey,
} from "@/hooks/queries/query-keys";

const GIT_DIFF_SEARCH_DEBOUNCE_MS = 300;

export interface UseGitDiffFileSearchArgs {
  environmentId?: string;
  target: WorkspaceDiffTarget | undefined;
  files: readonly DiffFileEntry[];
}

export interface UseGitDiffFileSearchResult {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  matchedPaths: Set<string> | null;
  isSearching: boolean;
}

function buildEnvironmentDiffSearchArgs(
  environmentId: string,
  target: WorkspaceDiffTarget,
  q: string,
): EnvironmentDiffSearchArgs {
  switch (target.type) {
    case "uncommitted":
      return { environmentId, target: target.type, q };
    case "branch_committed":
    case "all":
      return {
        environmentId,
        target: target.type,
        mergeBaseBranch: target.mergeBaseBranch,
        q,
      };
    case "commit":
      return { environmentId, target: target.type, sha: target.sha, q };
  }
}

export function useGitDiffFileSearch({
  environmentId,
  target,
  files,
}: UseGitDiffFileSearchArgs): UseGitDiffFileSearchResult {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const targetType = target?.type ?? null;
  const targetKey = environmentDiffTargetKey(target);

  useEffect(() => {
    setSearchQuery("");
    setDebouncedQuery("");
  }, [environmentId, targetType, targetKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, GIT_DIFF_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const trimmedSearchQuery = searchQuery.trim();
  const trimmedDebouncedQuery = debouncedQuery.trim();
  const { data: contentMatchedPaths, isFetching } = useQuery({
    queryKey: environmentDiffSearchQueryKey(
      environmentId ?? "",
      targetType,
      targetKey,
      trimmedDebouncedQuery,
    ),
    queryFn: async ({ signal }) => {
      const result = await sdk.environments.diffSearch({
        ...buildEnvironmentDiffSearchArgs(
          environmentId ?? "",
          target as WorkspaceDiffTarget,
          trimmedDebouncedQuery,
        ),
        signal,
      });
      return result.outcome === "available" ? result.matchedPaths : [];
    },
    enabled:
      Boolean(environmentId) &&
      target !== undefined &&
      trimmedDebouncedQuery.length > 0,
    retry: false,
  });

  const pathMatchedPaths = useMemo(() => {
    const normalizedQuery = trimmedSearchQuery.toLowerCase();
    if (normalizedQuery.length === 0) {
      return null;
    }
    const matches = new Set<string>();
    for (const file of files) {
      if (file.path.toLowerCase().includes(normalizedQuery)) {
        matches.add(file.path);
      }
    }
    return matches;
  }, [files, trimmedSearchQuery]);

  const matchedPaths = useMemo(() => {
    if (pathMatchedPaths === null) {
      return null;
    }
    if (
      trimmedSearchQuery !== trimmedDebouncedQuery ||
      !contentMatchedPaths ||
      contentMatchedPaths.length === 0
    ) {
      return pathMatchedPaths;
    }
    return new Set([...pathMatchedPaths, ...contentMatchedPaths]);
  }, [
    contentMatchedPaths,
    pathMatchedPaths,
    trimmedDebouncedQuery,
    trimmedSearchQuery,
  ]);

  return {
    searchQuery,
    setSearchQuery,
    matchedPaths,
    isSearching:
      trimmedSearchQuery.length > 0 &&
      (trimmedSearchQuery !== trimmedDebouncedQuery || isFetching),
  };
}
