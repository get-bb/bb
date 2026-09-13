import {
  createUpdatedPackageContent,
  parsePackageJsonWithVersion,
  writeFilesAtomically,
} from "./lib/package-version.mjs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSemver, resolveVersionArgument } from "./lib/semver.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const USAGE =
  "Usage: node scripts/bump-version.mjs <new-version>|--patch|--minor|--major";
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
const defaultFileSystem = {
  readFile,
  rename,
  unlink,
  writeFile,
};

async function readPackageTarget({ fileSystem, repoRoot, target }) {
  const absolutePath = resolve(repoRoot, target.path);
  const content = await fileSystem.readFile(absolutePath, "utf8");
  const packageJson = parsePackageJsonWithVersion({
    content,
    path: target.path,
  });

  return {
    absolutePath,
    content,
    packageJson,
    target,
  };
}

async function readPackageTargets({ fileSystem, repoRoot }) {
  return Promise.all(
    packageTargets.map((target) =>
      readPackageTarget({ fileSystem, repoRoot, target }),
    ),
  );
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

export async function readMaxTargetVersion({
  repoRoot,
  fileSystem = defaultFileSystem,
}) {
  return findMaxCurrentVersion(
    await readPackageTargets({ fileSystem, repoRoot }),
  );
}

export async function bumpVersion(options) {
  const repoRoot = options.repoRoot;
  const args = options.args;
  const log = options.log;
  const fileSystem = options.fileSystem ?? defaultFileSystem;

  if (args.length !== 1) {
    throw new Error(USAGE);
  }

  const packageReads = await readPackageTargets({ fileSystem, repoRoot });
  const maxCurrentVersion = findMaxCurrentVersion(packageReads);
  const newVersion = resolveVersionArgument({
    argument: args[0],
    currentVersion: maxCurrentVersion,
    usage: USAGE,
  });

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

  await writeFilesAtomically({
    fileSystem,
    temporarySuffix: (update) =>
      `${update.target.label.replaceAll("/", "-")}.json`,
    updates,
  });
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
