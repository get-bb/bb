import { fuzzyMatchText } from "@bb/fuzzy-match";
import type { PromptMentionSuggestion } from "@/components/promptbox/mentions/types";
import { compareCodepoint } from "@/lib/codepoint-compare";

export type FolderMentionSuggestion = Extract<
  PromptMentionSuggestion,
  { kind: "folder" }
>;

/** A thread folder the mention menu can offer. */
export interface FolderMentionCandidate {
  id: string;
  name: string;
}

export interface BuildFolderMentionSuggestionsArgs {
  folders: readonly FolderMentionCandidate[];
  query: string;
  limit: number;
}

function getFolderSearchTexts(
  folder: FolderMentionCandidate,
): readonly string[] {
  const name = folder.name.trim();
  return name ? [name, folder.id] : [folder.id];
}

function toFolderMentionSuggestion(
  folder: FolderMentionCandidate,
): FolderMentionSuggestion {
  return {
    kind: "folder",
    path: `folder:${folder.id}`,
    replacement: `folder:${folder.id}`,
    folderId: folder.id,
    name: folder.name.trim() || folder.id,
  };
}

export function buildFolderMentionSuggestions(
  args: BuildFolderMentionSuggestionsArgs,
): FolderMentionSuggestion[] {
  const trimmedQuery = args.query.trim();
  if (trimmedQuery.length === 0 || args.limit <= 0) {
    return [];
  }

  const matches = fuzzyMatchText({
    items: args.folders,
    query: trimmedQuery,
    getText: getFolderSearchTexts,
    limit: args.folders.length,
  });

  return matches
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.name.localeCompare(right.item.name) ||
        compareCodepoint(left.item.id, right.item.id),
    )
    .slice(0, args.limit)
    .map((match) => toFolderMentionSuggestion(match.item));
}
