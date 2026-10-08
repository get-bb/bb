import changelogSource from "../../../../../CHANGELOG.md?raw";
import {
  parseChangelog,
  type ChangelogEntry,
} from "../../../../../changelog-parser";
import { compareChangelogVersions } from "./whats-new-seen";
export { RELEASE_META } from "../../../../../changelog-metadata";
export type {
  ReleaseHero,
  ReleaseMeta,
} from "../../../../../changelog-metadata";
export type { ChangelogBlock } from "../../../../../changelog-parser";
export type { ChangelogEntry } from "../../../../../changelog-parser";
export {
  compareChangelogVersions,
  recordWhatsNewVersion,
  type WhatsNewVersionStorage,
} from "./whats-new-seen";

const CHANGELOG_URL = "https://getbb.app/changelog";
const LATEST_CHANGELOG_SOURCE_URL =
  "https://raw.githubusercontent.com/get-bb/bb/main/CHANGELOG.md";

export const CHANGELOG_ENTRIES = parseChangelog(changelogSource);

export function changelogUrl(version: string): string {
  return `${CHANGELOG_URL}#${version.replaceAll(".", "-")}`;
}

export interface WhatsNewReleases {
  current: ChangelogEntry;
  skipped: ChangelogEntry[];
  updatedFrom: string | null;
}

export function selectWhatsNewReleases({
  entries,
  installedVersion,
  previousVersion,
}: {
  entries: readonly ChangelogEntry[];
  installedVersion: string | null;
  previousVersion: string | null;
}): WhatsNewReleases | null {
  const current =
    (installedVersion === null
      ? undefined
      : entries.find(
          (entry) =>
            compareChangelogVersions(entry.version, installedVersion) <= 0,
        )) ?? entries[0];
  if (current === undefined) {
    return null;
  }
  if (
    previousVersion === null ||
    compareChangelogVersions(previousVersion, current.version) >= 0
  ) {
    return { current, skipped: [], updatedFrom: null };
  }
  return {
    current,
    skipped: entries.filter(
      (entry) =>
        compareChangelogVersions(entry.version, previousVersion) > 0 &&
        compareChangelogVersions(entry.version, current.version) < 0,
    ),
    updatedFrom: previousVersion,
  };
}

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
