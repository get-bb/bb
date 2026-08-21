import { appToast } from "@/components/ui/app-toast";

// Module-level, not component state: an update check keeps running (and still
// reports its result) after the user navigates away from Settings → Updates.
let isChecking = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeAppUpdateCheck(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAppUpdateCheckSnapshot(): boolean {
  return isChecking;
}

export function checkErrorDescription(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "The update check did not complete.";
}

/**
 * Run one update check at a time. `check` is started here rather than in an
 * effect so it finishes — and toasts its failure — even if the caller unmounts
 * mid-flight.
 */
export function startAppUpdateCheck(check: () => Promise<void>): void {
  if (isChecking) {
    return;
  }
  isChecking = true;
  notify();

  void check()
    .catch((error: unknown) => {
      appToast.error("Update check failed", {
        description: checkErrorDescription(error),
      });
    })
    .finally(() => {
      isChecking = false;
      notify();
    });
}

/** Drop all cross-test state from this module-level store. */
export function resetAppUpdateCheckStoreForTests(): void {
  isChecking = false;
  listeners.clear();
}
