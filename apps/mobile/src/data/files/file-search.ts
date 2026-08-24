import type { WorkspacePathEntry } from "@bb/server-contract";

/**
 * File search results for the Files tab: fuzzy path matches from the
 * workspace (`/environments/:id/paths` or `/projects/:id/paths`) and from
 * thread storage (`/threads/:id/thread-storage/paths`), files only, each
 * source ranked by the server's score and shown as its own section (web
 * `usePathSuggestions` ranking, sectioned instead of merged so the user sees
 * where a path lives). Pure and vitest-tested.
 */

export type FileSearchSource = "workspace" | "thread-storage";

export interface FileSearchResult {
  source: FileSearchSource;
  /** Root-relative path. */
  path: string;
  name: string;
  score: number;
  /** Character offsets in `path` that matched the query. */
  positions: number[];
}

export interface FileSearchSection {
  source: FileSearchSource;
  title: string;
  results: FileSearchResult[];
  truncated: boolean;
}

const FILE_SEARCH_SECTION_TITLES: Record<FileSearchSource, string> = {
  workspace: "Workspace files",
  "thread-storage": "Thread storage",
};

function compareResults(a: FileSearchResult, b: FileSearchResult): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** Files only, ranked by score then path, capped at `limit`. */
function rankFileSearchEntries(
  source: FileSearchSource,
  entries: readonly WorkspacePathEntry[],
  limit: number,
): FileSearchResult[] {
  return entries
    .filter((entry) => entry.kind === "file")
    .map<FileSearchResult>((entry) => ({
      source,
      path: entry.path,
      name: entry.name,
      score: entry.score,
      positions: entry.positions,
    }))
    .sort(compareResults)
    .slice(0, limit);
}

export interface BuildFileSearchSectionsArgs {
  workspace: {
    paths: readonly WorkspacePathEntry[];
    truncated: boolean;
  } | null;
  threadStorage: {
    paths: readonly WorkspacePathEntry[];
    truncated: boolean;
  } | null;
  limitPerSource: number;
}

/** Sections in display order; sources with no matches are omitted. */
export function buildFileSearchSections({
  workspace,
  threadStorage,
  limitPerSource,
}: BuildFileSearchSectionsArgs): FileSearchSection[] {
  const sections: FileSearchSection[] = [];
  const push = (
    source: FileSearchSource,
    data: { paths: readonly WorkspacePathEntry[]; truncated: boolean } | null,
  ) => {
    if (data === null) return;
    const results = rankFileSearchEntries(source, data.paths, limitPerSource);
    if (results.length === 0) return;
    sections.push({
      source,
      title: FILE_SEARCH_SECTION_TITLES[source],
      results,
      truncated: data.truncated || results.length < data.paths.length,
    });
  };
  push("workspace", workspace);
  push("thread-storage", threadStorage);
  return sections;
}

export interface HighlightSegment {
  text: string;
  matched: boolean;
}

/** Split `text` into runs of matched / unmatched characters. */
export function buildHighlightSegments(
  text: string,
  positions: readonly number[],
): HighlightSegment[] {
  if (positions.length === 0 || text.length === 0) {
    return [{ text, matched: false }];
  }
  const matched = new Set(positions);
  const segments: HighlightSegment[] = [];
  let current = "";
  let currentMatched = matched.has(0);
  for (let index = 0; index < text.length; index += 1) {
    const isMatched = matched.has(index);
    if (isMatched !== currentMatched && current.length > 0) {
      segments.push({ text: current, matched: currentMatched });
      current = "";
    }
    currentMatched = isMatched;
    current += text[index];
  }
  if (current.length > 0)
    segments.push({ text: current, matched: currentMatched });
  return segments;
}

/** `dir/` + `name` split of a root-relative path for the two-line row. */
export function splitPathForRow(path: string): {
  directory: string;
  name: string;
} {
  const index = path.lastIndexOf("/");
  if (index === -1) return { directory: "", name: path };
  return { directory: path.slice(0, index), name: path.slice(index + 1) };
}
