import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { useMemo } from "react";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useEnvironmentPaths, useThreadStoragePaths } from "../composer";
import { useProjectPaths } from "../projects";
import { buildFileSearchSections, type FileSearchSection } from "./file-search";

const FILE_SEARCH_DEBOUNCE_MS = 120;
const FILE_SEARCH_LIMIT_PER_SOURCE = 12;

export interface UseFileSearchArgs {
  threadId: string | null;
  projectId: string | null;
  /** Search the environment's workspace when set; else the project's source. */
  environmentId: string | null;
  hostId: string | null;
  query: string;
  limitPerSource?: number;
}

export interface UseFileSearchResult {
  sections: FileSearchSection[];
  /** The trimmed query the current sections answer. */
  debouncedQuery: string;
  hasQuery: boolean;
  isDebouncing: boolean;
  isLoading: boolean;
  isError: boolean;
  /** Neither a workspace nor thread storage can be searched. */
  isUnavailable: boolean;
}

/**
 * Files-tab search: the workspace (environment paths, or project paths while
 * the thread has no environment) and the thread's storage, each as its own
 * section, debounced like the composer typeahead (web
 * `useFileSearchSuggestions` over `usePathSuggestions`).
 */
export function useFileSearch({
  threadId,
  projectId,
  environmentId,
  hostId,
  query,
  limitPerSource = FILE_SEARCH_LIMIT_PER_SOURCE,
}: UseFileSearchArgs): UseFileSearchResult {
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(
    trimmedQuery,
    FILE_SEARCH_DEBOUNCE_MS,
  ).trim();
  const hasQuery = trimmedQuery.length > 0;
  const workspaceSource =
    environmentId !== null
      ? "environment"
      : projectId !== null && projectId !== PERSONAL_PROJECT_ID
        ? "project"
        : "none";
  const pathArgs = {
    query: debouncedQuery.length > 0 ? debouncedQuery : null,
    // Oversample: the server ranks files and directories together.
    limit: limitPerSource * 2,
    includeFiles: true,
    includeDirectories: false,
  };
  const environmentPaths = useEnvironmentPaths(
    workspaceSource === "environment" ? environmentId : null,
    pathArgs,
  );
  const projectPaths = useProjectPaths({
    projectId:
      workspaceSource === "project" ? (projectId ?? undefined) : undefined,
    hostId,
    query: pathArgs.query,
    limit: pathArgs.limit,
    includeFiles: true,
    includeDirectories: false,
  });
  const workspacePaths =
    workspaceSource === "environment"
      ? environmentPaths
      : workspaceSource === "project"
        ? projectPaths
        : null;
  const storagePaths = useThreadStoragePaths(threadId, pathArgs);

  const sections = useMemo(
    () =>
      debouncedQuery.length === 0
        ? []
        : buildFileSearchSections({
            workspace: workspacePaths?.data ?? null,
            threadStorage: storagePaths.data ?? null,
            limitPerSource,
          }),
    [debouncedQuery, limitPerSource, storagePaths.data, workspacePaths?.data],
  );
  const isDebouncing = hasQuery && trimmedQuery !== debouncedQuery;
  const isLoading =
    hasQuery &&
    sections.length === 0 &&
    ((workspacePaths?.isLoading ?? false) || storagePaths.isLoading);
  return {
    sections,
    debouncedQuery,
    hasQuery,
    isDebouncing,
    isLoading,
    isError: Boolean(workspacePaths?.isError) || storagePaths.isError,
    isUnavailable: workspaceSource === "none" && threadId === null,
  };
}
