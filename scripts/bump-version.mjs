import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), "..");
const packageTargets = [
  {
    label: "bb-app",
    path: "packages/bb-app/package.json",
  },
  {
    label: "@bb/desktop",
    path: "apps/desktop/package.json",
  },
];
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const numericIdentifierPattern = /^\d+$/u;
const defaultFileSystem = {
  readFile,
  rename,
  unlink,
  writeFile,
};

function parseSemver(version) {
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

function deriveVersion(currentVersion, bumpType) {
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

function resolveVersionArgument(argument, currentVersion) {
  if (
    argument === "--major" ||
    argument === "--minor" ||
    argument === "--patch"
  ) {
    return deriveVersion(currentVersion, argument);
  }

  if (argument.startsWith("--")) {
    throw new Error(
      "Usage: node scripts/bump-version.mjs <new-version>|--patch|--minor|--major",
    );
  }

  if (parseSemver(argument) === null) {
    throw new Error(`Invalid version: ${argument}`);
  }

  return argument;
}

function parsePackageJson({ content, packagePath }) {
  const packageJson = JSON.parse(content);

  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    Array.isArray(packageJson)
  ) {
    throw new Error(`Invalid package JSON object in ${packagePath}`);
  }

  if (typeof packageJson.version !== "string") {
    throw new Error(`Missing string version field in ${packagePath}`);
  }

  return packageJson;
}

async function readPackageTarget({ fileSystem, repoRoot, target }) {
  const absolutePath = resolve(repoRoot, target.path);
  const content = await fileSystem.readFile(absolutePath, "utf8");
  const packageJson = parsePackageJson({
    content,
    packagePath: target.path,
  });

  return {
    absolutePath,
    content,
    packageJson,
    target,
  };
}

function detectPackageJsonIndent(content) {
  const match = /\n([ \t]+)"/u.exec(content);

  return match === null ? 2 : match[1];
}

function createUpdatedPackageContent({ content, packageJson, newVersion }) {
  const trailingNewline = content.endsWith("\n") ? "\n" : "";

  return `${JSON.stringify(
    { ...packageJson, version: newVersion },
    null,
    detectPackageJsonIndent(content),
  )}${trailingNewline}`;
}

function findMaxCurrentVersion(packageReads) {
  return packageReads.reduce((maxVersion, packageRead) => {
    const currentVersion = packageRead.packageJson.version;

    return compareSemver(currentVersion, maxVersion) > 0
      ? currentVersion
      : maxVersion;
  }, packageReads[0].packageJson.version);
}

function createPackageVersionSummary(packageReads) {
  return packageReads
    .map(
      (packageRead) =>
        `${packageRead.target.label}=${packageRead.packageJson.version}`,
    )
    .join(" ");
}

async function writePackageTargetsAtomically({ fileSystem, updates }) {
  const preparedUpdates = [];
  const renamedUpdates = [];

  try {
    for (const update of updates) {
      const temporaryPath = resolve(
        dirname(update.absolutePath),
        `.tmp-${process.pid}-${randomUUID()}-${update.target.label.replaceAll(
          "/",
          "-",
        )}.json`,
      );

      await fileSystem.writeFile(temporaryPath, update.nextContent);
      preparedUpdates.push({ ...update, temporaryPath });
    }

    for (const update of preparedUpdates) {
      await fileSystem.rename(update.temporaryPath, update.absolutePath);
      renamedUpdates.push(update);
    }
  } catch (error) {
    for (const update of [...renamedUpdates].reverse()) {
      await fileSystem.writeFile(update.absolutePath, update.content);
    }

    for (const update of preparedUpdates) {
      await fileSystem.unlink(update.temporaryPath).catch(() => {});
    }

    throw error;
  }
}

export async function bumpVersion(options) {
  const repoRoot = options.repoRoot;
  const args = options.args;
  const log = options.log;
  const fileSystem = options.fileSystem ?? defaultFileSystem;

  if (args.length !== 1) {
    throw new Error(
      "Usage: node scripts/bump-version.mjs <new-version>|--patch|--minor|--major",
    );
  }

  const packageReads = await Promise.all(
    packageTargets.map((target) =>
      readPackageTarget({ fileSystem, repoRoot, target }),
    ),
  );
  const maxCurrentVersion = findMaxCurrentVersion(packageReads);
  const newVersion = resolveVersionArgument(args[0], maxCurrentVersion);

  if (compareSemver(newVersion, maxCurrentVersion) <= 0) {
    throw new Error(
      `New version ${newVersion} must be greater than current max ${maxCurrentVersion} across ${createPackageVersionSummary(packageReads)}.`,
    );
  }

  const updates = packageReads.map((packageRead) => ({
    ...packageRead,
    nextContent: createUpdatedPackageContent({
      content: packageRead.content,
      packageJson: packageRead.packageJson,
      newVersion,
    }),
  }));

  await writePackageTargetsAtomically({ fileSystem, updates });
  log(`Bumped: bb-app + @bb/desktop → ${newVersion}`);
}

async function main() {
  const repoRoot = process.env.BB_BUMP_VERSION_REPO_ROOT ?? defaultRepoRoot;

  await bumpVersion({
    args: process.argv.slice(2),
    log: console.log,
    repoRoot,
  });
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);

    console.error(message);
    process.exitCode = 1;
  });
}
