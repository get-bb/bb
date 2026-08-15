// Semver parsing, comparison, and bump derivation shared by the repo's version
// bump scripts (scripts/bump-version.mjs for bb-app/@bb/desktop,
// scripts/bump-plugin-sdk.mjs for @get-bb/plugin-sdk). Kept dependency-free so
// the release workflow can run it without an install step.
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const numericIdentifierPattern = /^\d+$/u;

export function parseSemver(version) {
  const match = semverPattern.exec(version);

  if (match === null) {
    return null;
  }

  const [, major, minor, patch, prerelease] = match;

  return {
    major: BigInt(major),
    minor: BigInt(minor),
    patch: BigInt(patch),
    prerelease: prerelease === undefined ? [] : prerelease.split("."),
    version,
  };
}

function compareCoreVersions(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] > right[key]) {
      return 1;
    }

    if (left[key] < right[key]) {
      return -1;
    }
  }

  return 0;
}

function comparePrereleaseIdentifier(left, right) {
  if (left === right) {
    return 0;
  }

  const leftIsNumeric = numericIdentifierPattern.test(left);
  const rightIsNumeric = numericIdentifierPattern.test(right);

  if (leftIsNumeric && rightIsNumeric) {
    return BigInt(left) > BigInt(right) ? 1 : -1;
  }

  if (leftIsNumeric) {
    return -1;
  }

  if (rightIsNumeric) {
    return 1;
  }

  return left > right ? 1 : -1;
}

function comparePrereleaseVersions(left, right) {
  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }

  if (left.prerelease.length === 0) {
    return 1;
  }

  if (right.prerelease.length === 0) {
    return -1;
  }

  const identifierCount = Math.max(
    left.prerelease.length,
    right.prerelease.length,
  );

  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];

    if (leftIdentifier === undefined) {
      return -1;
    }

    if (rightIdentifier === undefined) {
      return 1;
    }

    const comparison = comparePrereleaseIdentifier(
      leftIdentifier,
      rightIdentifier,
    );

    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

export function compareSemver(leftVersion, rightVersion) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);

  if (left === null) {
    throw new Error(`Invalid semver string: ${leftVersion}`);
  }

  if (right === null) {
    throw new Error(`Invalid semver string: ${rightVersion}`);
  }

  const coreComparison = compareCoreVersions(left, right);

  if (coreComparison !== 0) {
    return coreComparison;
  }

  return comparePrereleaseVersions(left, right);
}

export function deriveVersion(currentVersion, bumpType) {
  const current = parseSemver(currentVersion);

  if (current === null) {
    throw new Error(`Invalid current version: ${currentVersion}`);
  }

  if (bumpType === "--major") {
    return `${current.major + 1n}.0.0`;
  }

  if (bumpType === "--minor") {
    return `${current.major}.${current.minor + 1n}.0`;
  }

  if (bumpType === "--patch") {
    if (current.prerelease.length > 0) {
      return `${current.major}.${current.minor}.${current.patch}`;
    }

    return `${current.major}.${current.minor}.${current.patch + 1n}`;
  }

  throw new Error(`Unsupported bump flag: ${bumpType}`);
}

/**
 * Resolve a CLI version argument that is either an explicit semver string or one
 * of the `--patch`/`--minor`/`--major` bump flags.
 */
export function resolveVersionArgument({ argument, currentVersion, usage }) {
  if (
    argument === "--major" ||
    argument === "--minor" ||
    argument === "--patch"
  ) {
    return deriveVersion(currentVersion, argument);
  }

  if (argument.startsWith("--")) {
    throw new Error(usage);
  }

  if (parseSemver(argument) === null) {
    throw new Error(`Invalid version: ${argument}`);
  }

  return argument;
}
