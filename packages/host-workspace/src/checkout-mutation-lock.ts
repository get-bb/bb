import path from "node:path";
import { getAbsoluteGitDir, runGit } from "./git.js";
import {
  withProcessLocalQueuedLocks,
  type ProcessLocalQueuedLockSpec,
  type ProcessLocalQueuedLockWork,
} from "./process-local-queued-lock.js";

type CheckoutMutationLockWork<T> = ProcessLocalQueuedLockWork<T>;

const checkoutMutationAdmissionKeyPrefix = "checkout-mutation-admission:";

function getCheckoutMutationAdmissionLockSpec(
  checkoutPath: string,
): ProcessLocalQueuedLockSpec {
  return {
    key: `${checkoutMutationAdmissionKeyPrefix}${path.resolve(checkoutPath)}`,
  };
}

function getCheckoutMutationAdmissionLockSpecs(
  checkoutPaths: string[],
): ProcessLocalQueuedLockSpec[] {
  return checkoutPaths.map((checkoutPath) =>
    getCheckoutMutationAdmissionLockSpec(checkoutPath),
  );
}

export async function withCheckoutMutationAdmission<T>(
  checkoutPath: string,
  work: CheckoutMutationLockWork<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withProcessLocalQueuedLocks({
    locks: [getCheckoutMutationAdmissionLockSpec(checkoutPath)],
    signal,
    work,
  });
}

async function resolveCheckoutMutationLockSpec(
  checkoutPath: string,
): Promise<ProcessLocalQueuedLockSpec> {
  return { key: await getAbsoluteGitDir(checkoutPath) };
}

async function tryResolveCheckoutMutationLockSpec(
  checkoutPath: string,
): Promise<ProcessLocalQueuedLockSpec | null> {
  const result = await runGit(["rev-parse", "--absolute-git-dir"], {
    cwd: checkoutPath,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    return null;
  }

  const gitDir = result.stdout.trim();
  return gitDir ? { key: path.resolve(gitDir) } : null;
}

export async function withCheckoutMutationLock<T>(
  checkoutPath: string,
  work: CheckoutMutationLockWork<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withCheckoutMutationAdmission(
    checkoutPath,
    async () => {
      const lock = await resolveCheckoutMutationLockSpec(checkoutPath);
      return withProcessLocalQueuedLocks({ locks: [lock], signal, work });
    },
    signal,
  );
}

async function withCheckoutMutationAdmissions<T>(
  checkoutPaths: string[],
  work: CheckoutMutationLockWork<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withProcessLocalQueuedLocks({
    locks: getCheckoutMutationAdmissionLockSpecs(checkoutPaths),
    signal,
    work,
  });
}

export async function tryWithCheckoutMutationLock<T>(
  checkoutPath: string,
  work: CheckoutMutationLockWork<T>,
  signal?: AbortSignal,
): Promise<T | null> {
  return withCheckoutMutationAdmission(
    checkoutPath,
    async () => {
      const lock = await tryResolveCheckoutMutationLockSpec(checkoutPath);
      if (!lock) {
        return null;
      }

      return withProcessLocalQueuedLocks({ locks: [lock], signal, work });
    },
    signal,
  );
}

export async function withCheckoutMutationLocks<T>(
  checkoutPaths: string[],
  work: CheckoutMutationLockWork<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withCheckoutMutationAdmissions(
    checkoutPaths,
    async () => {
      const locks = await Promise.all(
        checkoutPaths.map((checkoutPath) =>
          resolveCheckoutMutationLockSpec(checkoutPath),
        ),
      );
      return withProcessLocalQueuedLocks({ locks, signal, work });
    },
    signal,
  );
}
