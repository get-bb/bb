import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bumpVersion } from "./bump-version.mjs";
import { compareSemver } from "./lib/semver.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), "..");
const packagePaths = [
  "packages/bb-app/package.json",
  "apps/desktop/package.json",
];
const semverCorePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/u;
const positiveIntegerPattern = /^[1-9]\d*$/u;

function normalizePositiveInteger(value, label) {
  if (!positiveIntegerPattern.test(value)) {
    throw new Error(`${label} must be a positive integer, got ${value}.`);
  }

  return BigInt(value).toString();
}

export function deriveNightlyVersion(currentVersion, runId, runAttempt) {
  const coreMatch = semverCorePattern.exec(currentVersion);
  if (coreMatch === null) {
    throw new Error(`Invalid current version: ${currentVersion}`);
  }

  const [, major, minor, patch] = coreMatch;
  const normalizedRunId = normalizePositiveInteger(runId, "GITHUB_RUN_ID");
  const normalizedRunAttempt = normalizePositiveInteger(
    runAttempt,
    "GITHUB_RUN_ATTEMPT",
  );

  return `${major}.${minor}.${BigInt(patch) + 1n}-nightly.${normalizedRunId}.${normalizedRunAttempt}`;
}

async function readCurrentVersions(repoRoot) {
  return await Promise.all(
    packagePaths.map(async (packagePath) => {
      const packageJson = JSON.parse(
        await readFile(resolve(repoRoot, packagePath), "utf8"),
      );
      if (
        typeof packageJson !== "object" ||
        packageJson === null ||
        typeof packageJson.version !== "string"
      ) {
        throw new Error(`Missing string version in ${packagePath}.`);
      }

      return packageJson.version;
    }),
  );
}

export async function prepareNightlyVersion(options) {
  const currentVersions = await readCurrentVersions(options.repoRoot);
  const maxCurrentVersion = currentVersions.reduce((maxVersion, version) =>
    compareSemver(version, maxVersion) > 0 ? version : maxVersion,
  );
  const nightlyVersion = deriveNightlyVersion(
    maxCurrentVersion,
    options.runId,
    options.runAttempt,
  );

  await bumpVersion({
    args: [nightlyVersion],
    log: () => {},
    repoRoot: options.repoRoot,
  });

  return nightlyVersion;
}

async function main() {
  const repoRoot = process.env.BB_NIGHTLY_VERSION_REPO_ROOT ?? defaultRepoRoot;
  const runId = process.env.GITHUB_RUN_ID ?? "";
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "";
  const nightlyVersion = await prepareNightlyVersion({
    repoRoot,
    runAttempt,
    runId,
  });

  process.stdout.write(`${nightlyVersion}\n`);
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
