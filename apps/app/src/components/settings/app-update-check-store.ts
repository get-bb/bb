import { appToast } from "@/components/ui/app-toast";

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

export function checkErrorDescription(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return "The update check did not complete.";
}

export function startAppUpdateCheck(check: () => Promise<void>): void {
  if (isChecking) {
    return;
  }
  isChecking = true;
  notify();

  void check()
    .catch((cause: unknown) => {
      appToast.error("Update check failed", {
        description: checkErrorDescription(cause),
      });
    })
    .finally(() => {
      isChecking = false;
      notify();
    });
}

export function resetAppUpdateCheckStoreForTests(): void {
  isChecking = false;
  listeners.clear();
}
