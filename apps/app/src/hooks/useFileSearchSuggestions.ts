import { useMemo } from "react";
import {
  usePathSuggestions,
  type PathSuggestion,
  type PathSuggestionSource,
} from "./usePathSuggestions";

export interface FilePathSearchSuggestion {
  source: PathSuggestionSource;
  entryKind: "file";
  path: string;
  name: string;
  score: number;
  positions: number[];
}

interface UseFileSearchSuggestionsArgs {
  projectId: string | undefined;
  query: string | null;
  limit: number;
  environmentId: string | null;
  hostId?: string | null;
  currentThreadId?: string;
}

interface UseFileSearchSuggestionsResult {
  suggestions: FilePathSearchSuggestion[];
  isLoading: boolean;
  fileSearchError: boolean;
  isDebouncing: boolean;
  isUnavailable: boolean;
}

interface FilePathSuggestion extends PathSuggestion {
  entryKind: "file";
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

export function useFileSearchSuggestions(
  args: UseFileSearchSuggestionsArgs,
): UseFileSearchSuggestionsResult {
  const pathSuggestions = usePathSuggestions({
    projectId: args.projectId,
    query: args.query,
    limit: args.limit,
    environmentId: args.environmentId,
    hostId: args.hostId,
    currentThreadId: args.currentThreadId,
    includeDirectories: false,
  });
  const suggestions = useMemo<FilePathSearchSuggestion[]>(
    () =>
      pathSuggestions.suggestions
        .filter(isFilePathSuggestion)
        .map(toFileSearchSuggestion),
    [pathSuggestions.suggestions],
  );
  const canSearchWorkspace = Boolean(args.projectId);
  const canSearchThreadStorage = Boolean(args.currentThreadId);

  return {
    suggestions,
    isLoading: suggestions.length === 0 && pathSuggestions.isLoading,
    fileSearchError: pathSuggestions.isError,
    isDebouncing: pathSuggestions.isDebouncing,
    isUnavailable: !canSearchWorkspace && !canSearchThreadStorage,
  };
}
