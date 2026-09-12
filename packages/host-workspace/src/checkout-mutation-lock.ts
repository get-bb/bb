import path from "node:path";
import {
  withProcessLocalQueuedLocks,
  type ProcessLocalQueuedLockSpec,
  type ProcessLocalQueuedLockWork,
} from "bb-environment-provider-host/process-local-lock";
import { getAbsoluteGitDir, type GitProcessOptions } from "./git.js";

type CheckoutMutationLockWork<T> = ProcessLocalQueuedLockWork<T>;

const checkoutMutationAdmissionKeyPrefix = "checkout-mutation-admission:";

function getCheckoutMutationAdmissionLockSpec(
  checkoutPath: string,
): ProcessLocalQueuedLockSpec {
  return {
    key: `${checkoutMutationAdmissionKeyPrefix}${path.resolve(checkoutPath)}`,
  };
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
  options: GitProcessOptions,
): Promise<ProcessLocalQueuedLockSpec> {
  return { key: await getAbsoluteGitDir(checkoutPath, options) };
}

export async function withCheckoutMutationLock<T>(
  checkoutPath: string,
  work: CheckoutMutationLockWork<T>,
  signal?: AbortSignal,
  options: GitProcessOptions = {},
): Promise<T> {
  return withCheckoutMutationAdmission(
    checkoutPath,
    async () => {
      const lock = await resolveCheckoutMutationLockSpec(checkoutPath, options);
      return withProcessLocalQueuedLocks({ locks: [lock], signal, work });
    },
    signal,
  );
}
