import changelogSource from "../../../../../CHANGELOG.md?raw";
import {
  parseChangelog,
  type ChangelogEntry,
} from "../../../../../changelog-parser";
export { RELEASE_META } from "../../../../../changelog-metadata";
export type { ChangelogBlock } from "../../../../../changelog-parser";

const LATEST_CHANGELOG_SOURCE_URL =
  "https://raw.githubusercontent.com/get-bb/bb/main/CHANGELOG.md";

export const CHANGELOG_ENTRIES = parseChangelog(changelogSource);

export const LATEST_CHANGELOG_ENTRY: ChangelogEntry | null =
  CHANGELOG_ENTRIES[0] ?? null;

export async function fetchLatestChangelogEntry(
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<ChangelogEntry> {
  const response = await fetchFn(LATEST_CHANGELOG_SOURCE_URL, { signal });
  if (!response.ok) {
    throw new Error(`Changelog request failed (${response.status})`);
  }
  const [entry] = parseChangelog(await response.text());
  if (entry === undefined) {
    throw new Error("The changelog has no releases");
  }
  return entry;
}
