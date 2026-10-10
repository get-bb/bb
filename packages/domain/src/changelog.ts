export {
  parseChangelog,
  type ChangelogBlock,
  type ChangelogEntry,
} from "./changelog-parser.js";
export {
  RELEASE_META,
  type ReleaseHero,
  type ReleaseMeta,
  type ReleaseVisualId,
} from "./changelog-metadata.js";

function versionParts(version: string): number[] | null {
  const match = /^v?(\d+(?:\.\d+)*)/.exec(version);
  return match?.[1] === undefined ? null : match[1].split(".").map(Number);
}

export function compareChangelogVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (leftParts === null || rightParts === null) {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  const partCount = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < partCount; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
