import { useMemo } from "react";
import { useDebounceValue } from "usehooks-ts";
import { useEnvironmentPathSuggestions } from "./queries/environment-queries";
import { useProjectPathSuggestions } from "./queries/project-queries";
import { useThreadStoragePaths } from "./queries/thread-queries";
import { isProjectlessProjectId } from "@/lib/app-route-paths";
import type { PathListOptions } from "@/lib/path-list-options";

export const PATH_SUGGESTION_DEBOUNCE_MS = 120;

const DEFAULT_PATH_SUGGESTION_LIMIT = 8;
const SOURCE_OVERSAMPLE_MULTIPLIER = 2;

export type PathSuggestionSource = "workspace" | "thread-storage";
export type PathSuggestionEntryKind = "file" | "directory";

type WorkspaceSource = "environment" | "project" | "none";

export interface PathSuggestion {
  source: PathSuggestionSource;
  entryKind: PathSuggestionEntryKind;
  path: string;
  name: string;
  score: number;
  positions: number[];
}

export interface UsePathSuggestionsArgs {
  projectId: string | undefined;
  query: string | null;
  limit?: number;
  environmentId: string | null;
  currentThreadId?: string;
  includeDirectories: boolean;
}

export interface UsePathSuggestionsResult {
  suggestions: PathSuggestion[];
  isLoading: boolean;
  isError: boolean;
  isDebouncing: boolean;
}

interface RankedPathSuggestion extends PathSuggestion {
  sourceRank: number;
}

function getSourceRank(source: PathSuggestionSource): number {
  return source === "workspace" ? 0 : 1;
}

function comparePathSuggestions(
  left: RankedPathSuggestion,
  right: RankedPathSuggestion,
): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.sourceRank !== right.sourceRank) {
    return left.sourceRank - right.sourceRank;
  }
  if (left.entryKind !== right.entryKind) {
    return left.entryKind === "directory" ? -1 : 1;
  }
  return left.path.localeCompare(right.path);
}

function toPathSuggestion(
  rankedSuggestion: RankedPathSuggestion,
): PathSuggestion {
  return {
    source: rankedSuggestion.source,
    entryKind: rankedSuggestion.entryKind,
    path: rankedSuggestion.path,
    name: rankedSuggestion.name,
    score: rankedSuggestion.score,
    positions: rankedSuggestion.positions,
  };
}

export function usePathSuggestions(
  args: UsePathSuggestionsArgs,
): UsePathSuggestionsResult {
  const limit = args.limit ?? DEFAULT_PATH_SUGGESTION_LIMIT;
  const oversampleLimit = limit * SOURCE_OVERSAMPLE_MULTIPLIER;
  const [debouncedNonNullQuery] = useDebounceValue(
    args.query,
    PATH_SUGGESTION_DEBOUNCE_MS,
  );
  const debouncedQuery = args.query === null ? null : debouncedNonNullQuery;
  const trimmedQuery = args.query?.trim() ?? "";
  const hasQuery = trimmedQuery.length > 0;
  const debouncedTrimmedQuery = debouncedQuery?.trim() ?? "";
  const isDebouncing = hasQuery && trimmedQuery !== debouncedTrimmedQuery;
  const hasDebouncedQuery = debouncedTrimmedQuery.length > 0;
  // The workspace source for an existing thread is its environment; the
  // project's default source is only used by the new-thread compose box before
  // an environment exists. Projectless (personal) threads have no project
  // source, so without an environment there is no workspace to search.
  const workspaceSource: WorkspaceSource = args.environmentId
    ? "environment"
    : args.projectId && !isProjectlessProjectId(args.projectId)
      ? "project"
      : "none";
  const includeWorkspace = workspaceSource !== "none";
  const includeThreadStorage = Boolean(args.currentThreadId);
  const isWorkspaceQueryEnabled = includeWorkspace && hasDebouncedQuery;
  const isThreadStorageQueryEnabled = includeThreadStorage && hasDebouncedQuery;

  const threadStorageOptions = useMemo<PathListOptions>(
    () => ({
      limit: oversampleLimit,
      query: debouncedQuery,
      includeFiles: true,
      includeDirectories: args.includeDirectories,
    }),
    [args.includeDirectories, debouncedQuery, oversampleLimit],
  );

  const projectWorkspaceQuery = useProjectPathSuggestions({
    projectId: workspaceSource === "project" ? args.projectId : undefined,
    query: debouncedQuery,
    limit: oversampleLimit,
    includeFiles: true,
    includeDirectories: args.includeDirectories,
  });
  const environmentWorkspaceQuery = useEnvironmentPathSuggestions({
    environmentId:
      workspaceSource === "environment" ? args.environmentId : undefined,
    query: debouncedQuery,
    limit: oversampleLimit,
    includeFiles: true,
    includeDirectories: args.includeDirectories,
  });
  const workspaceQuery =
    workspaceSource === "environment"
      ? environmentWorkspaceQuery
      : projectWorkspaceQuery;
  const threadStorageQuery = useThreadStoragePaths(
    args.currentThreadId ?? "",
    threadStorageOptions,
    {
      // Match the workspace query: only search once there is a (debounced)
      // query. Without this an empty input still fires a storage request whose
      // results we discard, and whose failure surfaces as a spurious error.
      enabled: isThreadStorageQueryEnabled,
    },
  );

  const suggestions = useMemo<PathSuggestion[]>(() => {
    if (!hasQuery) {
      return [];
    }

    const rankedSuggestions: RankedPathSuggestion[] = [];
    if (includeWorkspace) {
      for (const pathEntry of workspaceQuery.data?.paths ?? []) {
        rankedSuggestions.push({
          source: "workspace",
          sourceRank: getSourceRank("workspace"),
          entryKind: pathEntry.kind,
          path: pathEntry.path,
          name: pathEntry.name,
          score: pathEntry.score,
          positions: pathEntry.positions,
        });
      }
    }
    if (includeThreadStorage) {
      for (const pathEntry of threadStorageQuery.data?.paths ?? []) {
        rankedSuggestions.push({
          source: "thread-storage",
          sourceRank: getSourceRank("thread-storage"),
          entryKind: pathEntry.kind,
          path: pathEntry.path,
          name: pathEntry.name,
          score: pathEntry.score,
          positions: pathEntry.positions,
        });
      }
    }

    return rankedSuggestions
      .sort(comparePathSuggestions)
      .slice(0, limit)
      .map(toPathSuggestion);
  }, [
    hasQuery,
    includeThreadStorage,
    includeWorkspace,
    limit,
    threadStorageQuery.data?.paths,
    workspaceQuery.data?.paths,
  ]);

  const isFetching =
    (isWorkspaceQueryEnabled && workspaceQuery.isFetching) ||
    (isThreadStorageQueryEnabled && threadStorageQuery.isFetching);
  const isPending =
    (isWorkspaceQueryEnabled && workspaceQuery.isPending) ||
    (isThreadStorageQueryEnabled && threadStorageQuery.isPending);
  const isLoading =
    hasQuery &&
    suggestions.length === 0 &&
    (isDebouncing || isPending || isFetching);
  const isError =
    hasQuery &&
    ((isWorkspaceQueryEnabled && workspaceQuery.isError) ||
      (isThreadStorageQueryEnabled && threadStorageQuery.isError));

  return {
    suggestions,
    isLoading,
    isError,
    isDebouncing,
  };
}
