import { useMemo } from "react";
import type { ThreadType } from "@bb/domain";
import type { AppSummary } from "@bb/server-contract";
import {
  usePathSuggestions,
  type PathSuggestion,
  type PathSuggestionSource,
} from "./usePathSuggestions";
import { useApps } from "./queries/thread-queries";

const DEFAULT_FILE_SEARCH_SUGGESTION_LIMIT = 8;

export interface AppSearchSuggestion {
  source: "app";
  entryKind: "app";
  app: AppSummary;
  applicationId: string;
  name: string;
  score: number;
}

export interface FilePathSearchSuggestion {
  source: PathSuggestionSource;
  entryKind: "file";
  path: string;
  name: string;
  score: number;
  positions: number[];
}

export type FileSearchSuggestion =
  | AppSearchSuggestion
  | FilePathSearchSuggestion;

export interface UseFileSearchSuggestionsArgs {
  projectId: string | undefined;
  query: string | null;
  limit?: number;
  environmentId: string | null;
  currentThreadId?: string;
  currentThreadType?: ThreadType;
}

export interface UseFileSearchSuggestionsResult {
  suggestions: FileSearchSuggestion[];
  isLoading: boolean;
  isError: boolean;
  isDebouncing: boolean;
  isUnavailable: boolean;
}

interface FilePathSuggestion extends PathSuggestion {
  entryKind: "file";
}

interface BuildAppSearchSuggestionsArgs {
  apps: readonly AppSummary[];
  limit: number;
  query: string;
}

function isFilePathSuggestion(
  suggestion: PathSuggestion,
): suggestion is FilePathSuggestion {
  return suggestion.entryKind === "file";
}

function toFileSearchSuggestion(
  suggestion: FilePathSuggestion,
): FilePathSearchSuggestion {
  return {
    source: suggestion.source,
    entryKind: "file",
    path: suggestion.path,
    name: suggestion.name,
    score: suggestion.score,
    positions: suggestion.positions,
  };
}

function scoreAppSearchMatch(app: AppSummary, normalizedQuery: string): number {
  if (normalizedQuery.length === 0) {
    return 0;
  }

  const normalizedName = app.name.toLowerCase();
  const normalizedId = app.applicationId.toLowerCase();
  if (normalizedName === normalizedQuery || normalizedId === normalizedQuery) {
    return 100;
  }
  if (
    normalizedName.startsWith(normalizedQuery) ||
    normalizedId.startsWith(normalizedQuery)
  ) {
    return 90;
  }
  if (normalizedName.includes(normalizedQuery)) {
    return 80;
  }
  if (normalizedId.includes(normalizedQuery)) {
    return 70;
  }
  return -1;
}

function buildAppSearchSuggestions({
  apps,
  limit,
  query,
}: BuildAppSearchSuggestionsArgs): AppSearchSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  const suggestions: AppSearchSuggestion[] = [];
  for (const app of apps) {
    const score = scoreAppSearchMatch(app, normalizedQuery);
    if (score < 0) {
      continue;
    }
    suggestions.push({
      source: "app",
      entryKind: "app",
      app,
      applicationId: app.applicationId,
      name: app.name,
      score,
    });
  }

  return suggestions
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

export function useFileSearchSuggestions(
  args: UseFileSearchSuggestionsArgs,
): UseFileSearchSuggestionsResult {
  const limit = args.limit ?? DEFAULT_FILE_SEARCH_SUGGESTION_LIMIT;
  const pathSuggestions = usePathSuggestions({
    projectId: args.projectId,
    query: args.query,
    limit,
    environmentId: args.environmentId,
    currentThreadId: args.currentThreadId,
    currentThreadType: args.currentThreadType,
    includeDirectories: false,
  });
  const canSearchApps = Boolean(args.currentThreadId);
  const apps = useApps({
    enabled: canSearchApps,
  });
  const appSuggestions = useMemo<AppSearchSuggestion[]>(
    () =>
      buildAppSearchSuggestions({
        apps: apps.data ?? [],
        limit,
        query: args.query ?? "",
      }),
    [args.query, apps.data, limit],
  );
  const fileSuggestions = useMemo<FilePathSearchSuggestion[]>(
    () =>
      pathSuggestions.suggestions
        .filter(isFilePathSuggestion)
        .map(toFileSearchSuggestion),
    [pathSuggestions.suggestions],
  );
  const suggestions = useMemo<FileSearchSuggestion[]>(
    () => [...appSuggestions, ...fileSuggestions],
    [appSuggestions, fileSuggestions],
  );
  const canSearchWorkspace = Boolean(args.projectId);
  const canSearchThreadStorage =
    args.currentThreadType === "manager" && Boolean(args.currentThreadId);

  return {
    suggestions,
    isLoading:
      suggestions.length === 0 &&
      (pathSuggestions.isLoading || (canSearchApps && apps.isLoading)),
    isError: pathSuggestions.isError || (canSearchApps && apps.isError),
    isDebouncing: pathSuggestions.isDebouncing,
    isUnavailable: !canSearchApps && !canSearchWorkspace && !canSearchThreadStorage,
  };
}
