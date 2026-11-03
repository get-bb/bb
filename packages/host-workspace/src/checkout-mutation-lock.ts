import { withCheckoutMutationAdmission } from "bb-environment-provider-host/locks";
import {
  withProcessLocalQueuedLocks,
  type ProcessLocalQueuedLockWork,
} from "bb-environment-provider-host/process-local-lock";
import type { GitProcessOptions } from "bb-environment-provider-host/workspace-git";
import { getAbsoluteGitDir } from "./git.js";

export async function withCheckoutMutationLock<T>(
  checkoutPath: string,
  work: ProcessLocalQueuedLockWork<T>,
  signal?: AbortSignal,
  options: GitProcessOptions = {},
): Promise<T> {
  return withCheckoutMutationAdmission(
    checkoutPath,
    async () => {
      const key = await getAbsoluteGitDir(checkoutPath, options);
      return withProcessLocalQueuedLocks({ locks: [{ key }], signal, work });
    },
    signal,
  );
}
