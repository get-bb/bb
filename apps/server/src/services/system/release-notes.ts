import {
  compareChangelogVersions,
  parseChangelog,
  RELEASE_META,
  type ChangelogBlock,
  type ChangelogEntry,
} from "@bb/domain/changelog";
import type {
  ReleaseNotes,
  SystemReleaseNotesResponse,
} from "@bb/server-contract";
import { bundledChangelogMarkdown } from "@bb/templates/generated";
import { ApiError } from "../../errors.js";

const PUBLISHED_CHANGELOG_URL =
  "https://raw.githubusercontent.com/get-bb/bb/main/CHANGELOG.md";
const PUBLISHED_CHANGELOG_TIMEOUT_MS = 5_000;
const VERSION_PATTERN = /^v?\d+(?:\.\d+)*(?:[-+].*)?$/;

let bundledEntries: ChangelogEntry[] | null = null;

export function bundledReleaseEntries(): ChangelogEntry[] {
  bundledEntries ??= parseChangelog(bundledChangelogMarkdown);
  return bundledEntries;
}

export async function fetchPublishedReleaseEntries(): Promise<
  ChangelogEntry[]
> {
  const response = await fetch(PUBLISHED_CHANGELOG_URL, {
    signal: AbortSignal.timeout(PUBLISHED_CHANGELOG_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`the changelog request failed (${response.status})`);
  }
  return parseChangelog(await response.text());
}

const IMAGE_PARAGRAPH = /^!\[([^\]]*)\]\((\S+)\)$/;

type ReleaseImage = { src: string; alt: string };

function releaseImage(block: ChangelogBlock): ReleaseImage | null {
  if (block.kind !== "paragraph") {
    return null;
  }
  const match = IMAGE_PARAGRAPH.exec(block.text);
  return match?.[2] === undefined
    ? null
    : { src: match[2], alt: match[1] ?? "" };
}

function withoutImages(blocks: readonly ChangelogBlock[]): ChangelogBlock[] {
  return blocks.filter((block) => releaseImage(block) === null);
}

function firstImage(entry: ChangelogEntry): ReleaseImage | null {
  for (const block of [
    ...entry.lede,
    ...entry.sections.flatMap((section) => section.blocks),
  ]) {
    const image = releaseImage(block);
    if (image !== null) {
      return image;
    }
  }
  return null;
}

function toReleaseNotes(entry: ChangelogEntry): ReleaseNotes {
  const meta = RELEASE_META[entry.version];
  const image = firstImage(entry);
  return {
    version: entry.version,
    date: meta?.date ?? null,
    headline: meta?.headline ?? null,
    visual: meta?.visual ?? null,
    hero:
      meta?.hero !== undefined
        ? {
            src: meta.hero.src,
            darkSrc: meta.hero.darkSrc ?? null,
            alt: meta.hero.alt,
          }
        : image === null
          ? null
          : { src: image.src, darkSrc: null, alt: image.alt },
    lede: withoutImages(entry.lede),
    sections: entry.sections.map((section) => ({
      title: section.title,
      blocks: withoutImages(section.blocks),
    })),
  };
}

function assertVersion(name: "version" | "since", value: string): void {
  if (!VERSION_PATTERN.test(value)) {
    throw new ApiError(
      400,
      "invalid_request",
      `${name} must be a bb version such as 0.45.0`,
    );
  }
}

function sameVersion(entry: ChangelogEntry, version: string): boolean {
  return compareChangelogVersions(entry.version, version) === 0;
}

async function findRelease(
  entries: readonly ChangelogEntry[],
  version: string,
  fetchPublished: () => Promise<ChangelogEntry[]>,
): Promise<ChangelogEntry> {
  const bundled = entries.find((entry) => sameVersion(entry, version));
  if (bundled !== undefined) {
    return bundled;
  }
  const newest = entries[0];
  if (
    newest !== undefined &&
    compareChangelogVersions(version, newest.version) > 0
  ) {
    let published: ChangelogEntry[];
    try {
      published = await fetchPublished();
    } catch (error) {
      throw new ApiError(
        503,
        "release_notes_unavailable",
        `Release notes for bb ${version} are not bundled with this bb, and the published changelog could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        { retryable: true },
      );
    }
    const found = published.find((entry) => sameVersion(entry, version));
    if (found !== undefined) {
      return found;
    }
  }
  throw new ApiError(
    404,
    "release_not_found",
    `No release notes for bb ${version}`,
  );
}

export async function getReleaseNotes(args: {
  installedVersion: string;
  version: string | undefined;
  since: string | undefined;
  entries: readonly ChangelogEntry[];
  fetchPublished: () => Promise<ChangelogEntry[]>;
}): Promise<SystemReleaseNotesResponse> {
  const { entries, installedVersion } = args;
  const installed =
    entries.find(
      (entry) => compareChangelogVersions(entry.version, installedVersion) <= 0,
    ) ?? entries[0];
  if (installed === undefined) {
    throw new ApiError(
      503,
      "release_notes_unavailable",
      "This bb build has no bundled release notes",
    );
  }
  if (args.version !== undefined) {
    assertVersion("version", args.version);
    const release = await findRelease(
      entries,
      args.version,
      args.fetchPublished,
    );
    return { installedVersion, releases: [toReleaseNotes(release)] };
  }
  if (args.since !== undefined) {
    const since = args.since;
    assertVersion("since", since);
    return {
      installedVersion,
      releases: entries
        .filter(
          (entry) =>
            compareChangelogVersions(entry.version, since) > 0 &&
            compareChangelogVersions(entry.version, installed.version) <= 0,
        )
        .sort((left, right) =>
          compareChangelogVersions(right.version, left.version),
        )
        .map(toReleaseNotes),
    };
  }
  return { installedVersion, releases: [toReleaseNotes(installed)] };
}
