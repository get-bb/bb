import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bumpVersion, readMaxTargetVersion } from "./bump-version.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), "..");
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

export async function prepareNightlyVersion(options) {
  const maxCurrentVersion = await readMaxTargetVersion({
    repoRoot: options.repoRoot,
  });
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
