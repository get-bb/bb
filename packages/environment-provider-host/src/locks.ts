import {
  getGitCommonDir,
  runGit,
  type GitCommandResult,
  type GitProcessOptions,
  type RunGitOptions,
} from "./git.js";
import path from "node:path";
import {
  withProcessLocalQueuedLocks,
  type ProcessLocalQueuedLockSpec,
  type ProcessLocalQueuedLockWork,
} from "./process-local-lock.js";

export {
  ProcessLocalQueuedLockTimeoutError,
  withGitRefMutationLock,
} from "./process-local-lock.js";

export async function withWorktreeMetadataLock<T>(
  commonDir: string,
  work: ProcessLocalQueuedLockWork<T>,
  signal?: AbortSignal,
): Promise<T> {
  const resolvedCommonDir = path.resolve(commonDir);
  return withProcessLocalQueuedLocks({
    locks: [{ key: resolvedCommonDir }],
    signal,
    work,
  });
}

export async function runGitWithWorktreeMetadataLock(
  args: string[],
  options: RunGitOptions,
): Promise<GitCommandResult> {
  const commonDir = await getGitCommonDir(options.cwd, options);
  return withWorktreeMetadataLock(
    commonDir,
    () => runGit(args, options),
    options.signal,
  );
}

const checkoutMutationAdmissionKeyPrefix = "checkout-mutation-admission:";

function getCheckoutMutationAdmissionLockSpec(
  checkoutPath: string,
): ProcessLocalQueuedLockSpec {
  return {
    key: `${checkoutMutationAdmissionKeyPrefix}${path.resolve(checkoutPath)}`,
  };
}

async function withCheckoutMutationAdmission<T>(
  checkoutPath: string,
  work: ProcessLocalQueuedLockWork<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withProcessLocalQueuedLocks({
    locks: [getCheckoutMutationAdmissionLockSpec(checkoutPath)],
    signal,
    work,
  });
}

async function tryResolveCheckoutMutationLockSpec(
  checkoutPath: string,
  options: GitProcessOptions,
): Promise<ProcessLocalQueuedLockSpec | null> {
  const result = await runGit(["rev-parse", "--absolute-git-dir"], {
    cwd: checkoutPath,
    ...options,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    return null;
  }

  const gitDir = result.stdout.trim();
  return gitDir ? { key: path.resolve(gitDir) } : null;
}

export async function tryWithCheckoutMutationLock<T>(
  checkoutPath: string,
  work: ProcessLocalQueuedLockWork<T>,
  signal?: AbortSignal,
  options: GitProcessOptions = {},
): Promise<T | null> {
  return withCheckoutMutationAdmission(
    checkoutPath,
    async () => {
      const lock = await tryResolveCheckoutMutationLockSpec(
        checkoutPath,
        options,
      );
      if (!lock) {
        return null;
      }

      return withProcessLocalQueuedLocks({ locks: [lock], signal, work });
    },
    signal,
  );
}
