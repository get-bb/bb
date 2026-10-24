import type { BbDesktopInfo } from "@bb/desktop-contract";
import type {
  SystemAppUpdateStatus,
  SystemVersionResponse,
} from "@bb/server-contract";
import type {
  ChangelogBlock,
  ChangelogEntry,
} from "../../../../../changelog-parser";

export const RELEASE_WIDGET_MAX_HIGHLIGHTS = 3;

const RELEASE_VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/;
const BOLD_TITLE_PATTERN = /^\*\*(.+?)\*\*/;

export function isReleaseVersion(version: string): boolean {
  return RELEASE_VERSION_PATTERN.test(version);
}

function compareReleaseVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export interface ReleaseWidgetTargetInput {
  isDesktop: boolean;
  desktopInfo: BbDesktopInfo | null;
  appUpdate: SystemAppUpdateStatus | undefined;
  systemVersion: SystemVersionResponse | undefined;
}

export function resolveReleaseWidgetTargetVersion({
  isDesktop,
  desktopInfo,
  appUpdate,
  systemVersion,
}: ReleaseWidgetTargetInput): string | null {
  let candidate: string | null;
  let installed: string | null;
  if (isDesktop) {
    candidate =
      desktopInfo?.pendingVersion ?? desktopInfo?.latestVersion ?? null;
    installed = desktopInfo?.version ?? null;
  } else {
    const available =
      appUpdate?.available !== undefined &&
      appUpdate.available !== null &&
      appUpdate.available.channel !== "nightly"
        ? appUpdate.available.version
        : null;
    candidate =
      available ??
      (systemVersion?.updateAvailable === true
        ? systemVersion.latestVersion
        : null);
    installed =
      appUpdate?.current.version ?? systemVersion?.currentVersion ?? null;
  }
  if (candidate === null || !isReleaseVersion(candidate)) {
    return null;
  }
  if (installed !== null) {
    if (installed === candidate) {
      return null;
    }
    if (
      isReleaseVersion(installed) &&
      compareReleaseVersions(candidate, installed) <= 0
    ) {
      return null;
    }
  }
  return candidate;
}

function highlightTitle(item: string): string | null {
  const match = BOLD_TITLE_PATTERN.exec(item.trim());
  const title = match?.[1]
    ?.trim()
    .replace(/[:.]+$/, "")
    .trim();
  return title === undefined || title === "" ? null : title;
}

export function releaseHighlights(entry: ChangelogEntry): string[] {
  const section = entry.sections.find(
    (candidate) => candidate.title.trim().toLowerCase() === "highlights",
  );
  if (section === undefined) {
    return [];
  }
  const titles: string[] = [];
  for (const block of section.blocks) {
    if (block.kind !== "list") {
      continue;
    }
    for (const item of block.items) {
      const title = highlightTitle(item);
      if (title !== null) {
        titles.push(title);
      }
    }
  }
  return titles.slice(0, RELEASE_WIDGET_MAX_HIGHLIGHTS);
}

const MARKDOWN_IMAGE_PATTERN = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const RELEASE_IMAGE_ORIGIN = "https://getbb.app";
const RELEASE_IMAGE_PATH_PREFIX = "/changelog/";

export interface ReleaseWidgetImage {
  src: string;
  alt: string;
}

export interface ReleaseWidgetContent {
  highlights: string[];
  image: ReleaseWidgetImage | null;
}

function entryBlocks(entry: ChangelogEntry): ChangelogBlock[] {
  return [
    ...entry.lede,
    ...entry.sections.flatMap((section) => section.blocks),
  ];
}

function markdownImage(
  block: ChangelogBlock,
): { url: string; alt: string } | null {
  if (block.kind !== "paragraph") {
    return null;
  }
  const match = MARKDOWN_IMAGE_PATTERN.exec(block.text.trim());
  if (match === null) {
    return null;
  }
  return { alt: match[1]?.trim() ?? "", url: match[2] ?? "" };
}

function trustedReleaseImageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== RELEASE_IMAGE_ORIGIN ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !parsed.pathname.startsWith(RELEASE_IMAGE_PATH_PREFIX)
  ) {
    return null;
  }
  return parsed.href;
}

export function releaseImage(entry: ChangelogEntry): ReleaseWidgetImage | null {
  for (const block of entryBlocks(entry)) {
    const image = markdownImage(block);
    if (image === null) {
      continue;
    }
    const src = trustedReleaseImageUrl(image.url);
    if (src === null) {
      return null;
    }
    return {
      src,
      alt: image.alt === "" ? `What's new in bb ${entry.version}` : image.alt,
    };
  }
  return null;
}

export function resolveReleaseWidgetContent(
  version: string,
  fetchedEntries: readonly ChangelogEntry[] | undefined,
  bundledEntries: readonly ChangelogEntry[],
): ReleaseWidgetContent | null {
  const entry =
    fetchedEntries?.find((candidate) => candidate.version === version) ??
    bundledEntries.find((candidate) => candidate.version === version);
  if (entry === undefined) {
    return null;
  }
  const highlights = releaseHighlights(entry);
  if (highlights.length === 0) {
    return null;
  }
  return {
    highlights,
    image: releaseImage(entry),
  };
}
