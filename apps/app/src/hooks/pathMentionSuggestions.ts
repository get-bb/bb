import type { PathSuggestion } from "./usePathSuggestions";
import type { PromptMentionSuggestion } from "@bb/client-core";

export type PathMentionSuggestion = Extract<
  PromptMentionSuggestion,
  { kind: "path" }
>;

interface BuildPathMentionSuggestionsArgs {
  paths: readonly PathSuggestion[];
}

function getDirectoryPath(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function getPathMentionReplacement(path: PathSuggestion): string {
  const mentionPath =
    path.entryKind === "directory" ? getDirectoryPath(path.path) : path.path;
  return path.source === "thread-storage"
    ? `thread-storage:${mentionPath}`
    : mentionPath;
}

export function buildPathMentionSuggestions(
  args: BuildPathMentionSuggestionsArgs,
): PathMentionSuggestion[] {
  return args.paths.map((path) => ({
    kind: "path",
    source: path.source,
    entryKind: path.entryKind,
    path: path.path,
    name: path.name,
    replacement: getPathMentionReplacement(path),
  }));
}
