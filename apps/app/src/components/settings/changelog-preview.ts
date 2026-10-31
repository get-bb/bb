import { queryOptions } from "@tanstack/react-query";
import changelogSource from "../../../../../CHANGELOG.md?raw";
import {
  parseChangelog,
  type ChangelogEntry,
} from "../../../../../changelog-parser";
import { RELEASE_META } from "../../../../../changelog-metadata";

export { RELEASE_META };
export type {
  ChangelogBlock,
  ChangelogEntry,
} from "../../../../../changelog-parser";

const LATEST_CHANGELOG_SOURCE_URL =
  "https://raw.githubusercontent.com/get-bb/bb/main/CHANGELOG.md";
const LATEST_RELEASE_META_SOURCE_URL =
  "https://raw.githubusercontent.com/get-bb/bb/main/changelog-metadata.ts";
const RELEASE_META_ENTRY_PATTERN =
  /"(\d+(?:\.\d+){1,3})":\s*\{\s*date:\s*"([^"\\]+)",\s*headline:\s*"([^"\\]+)",?\s*\}/g;

export type ReleaseMeta = (typeof RELEASE_META)[string];

export const CHANGELOG_ENTRIES = parseChangelog(changelogSource);

export const LATEST_CHANGELOG_ENTRY: ChangelogEntry | null =
  CHANGELOG_ENTRIES[0] ?? null;

export const CHANGELOG_STALE_TIME_MS = 5 * 60_000;

export async function fetchChangelogEntries(
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<ChangelogEntry[]> {
  const response = await fetchFn(LATEST_CHANGELOG_SOURCE_URL, { signal });
  if (!response.ok) {
    throw new Error(`Changelog request failed (${response.status})`);
  }
  const entries = parseChangelog(await response.text());
  if (entries.length === 0) {
    throw new Error("The changelog has no releases");
  }
  return entries;
}

export function changelogEntriesQueryOptions() {
  return queryOptions({
    queryKey: ["updates", "changelog", "entries"] as const,
    queryFn: ({ signal }) => fetchChangelogEntries(fetch, signal),
    retry: false,
    staleTime: CHANGELOG_STALE_TIME_MS,
  });
}

export function parseReleaseMeta(source: string): Record<string, ReleaseMeta> {
  const meta: Record<string, ReleaseMeta> = {};
  for (const [, version, date, headline] of source.matchAll(
    RELEASE_META_ENTRY_PATTERN,
  )) {
    meta[version] = { date, headline };
  }
  return meta;
}

export async function fetchReleaseMeta(
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<Record<string, ReleaseMeta>> {
  const response = await fetchFn(LATEST_RELEASE_META_SOURCE_URL, { signal });
  if (!response.ok) {
    throw new Error(`Release metadata request failed (${response.status})`);
  }
  return parseReleaseMeta(await response.text());
}

export function releaseMetaQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: ["updates", "changelog", "meta"] as const,
    queryFn: ({ signal }) => fetchReleaseMeta(fetch, signal),
    enabled,
    retry: false,
    staleTime: CHANGELOG_STALE_TIME_MS,
  });
}
