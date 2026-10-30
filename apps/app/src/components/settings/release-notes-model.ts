import type { BbDesktopInfo } from "@bb/desktop-contract";
import type {
  SystemAppUpdateStatus,
  SystemVersionResponse,
} from "@bb/server-contract";
import type { ChangelogEntry } from "../../../../../changelog-parser";

const RELEASE_VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/;

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

export interface ReleaseVersionInput {
  isDesktop: boolean;
  desktopInfo: BbDesktopInfo | null;
  appUpdate: SystemAppUpdateStatus | undefined;
  systemVersion: SystemVersionResponse | undefined;
}

export function resolveReleaseUpdateVersion({
  isDesktop,
  desktopInfo,
  appUpdate,
  systemVersion,
}: ReleaseVersionInput): string | null {
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

function isSameMinorRelease(left: string, right: string): boolean {
  const [leftMajor, leftMinor] = left.split(".");
  const [rightMajor, rightMinor] = right.split(".");
  return leftMajor === rightMajor && leftMinor === rightMinor;
}

function findEntryCoveringRelease(
  version: string,
  entries: readonly ChangelogEntry[],
): ChangelogEntry | null {
  const exact = entries.find((candidate) => candidate.version === version);
  if (exact !== undefined) {
    return exact;
  }
  let covering: ChangelogEntry | null = null;
  for (const candidate of entries) {
    if (
      isReleaseVersion(candidate.version) &&
      isSameMinorRelease(candidate.version, version) &&
      compareReleaseVersions(candidate.version, version) < 0 &&
      (covering === null ||
        compareReleaseVersions(candidate.version, covering.version) > 0)
    ) {
      covering = candidate;
    }
  }
  return covering;
}

export function findReleaseEntry(
  version: string,
  fetchedEntries: readonly ChangelogEntry[] | undefined,
  bundledEntries: readonly ChangelogEntry[],
): ChangelogEntry | null {
  return (
    (fetchedEntries === undefined
      ? null
      : findEntryCoveringRelease(version, fetchedEntries)) ??
    findEntryCoveringRelease(version, bundledEntries)
  );
}
