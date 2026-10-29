import { createElement, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { CommitToastDescription } from "./CommitToastDescription.js";
import { COMMIT_FAILED_TITLE, commitErrorMessage } from "./commit-errors.js";

export interface CommitDialogTarget {
  threadId: string;
  environmentId: string;
}

let dialogTarget: CommitDialogTarget | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setDialogTarget(next: CommitDialogTarget | null): void {
  if (dialogTarget === next) return;
  dialogTarget = next;
  for (const listener of listeners) listener();
}

export function openCommitDialog(target: CommitDialogTarget): void {
  setDialogTarget(target);
}

export function closeCommitDialog(): void {
  setDialogTarget(null);
}

export function closeCommitDialogUnlessShown(
  shownThreadIds: readonly string[],
): void {
  if (
    dialogTarget !== null &&
    !shownThreadIds.includes(dialogTarget.threadId)
  ) {
    setDialogTarget(null);
  }
}

export function useCommitDialogTarget(): CommitDialogTarget | null {
  return useSyncExternalStore(subscribe, () => dialogTarget);
}

interface CommitQueue {
  tail: Promise<void>;
  pending: number;
}

const queues = new Map<string, CommitQueue>();

async function runCommit(
  sdk: PluginBrowserBbSdk,
  environmentId: string,
  toastId: string | number,
): Promise<void> {
  try {
    const response = await sdk.environments.commit({ environmentId });
    toast.success("Commit created", {
      id: toastId,
      description: createElement(CommitToastDescription, {
        commitSha: response.commitSha,
        commitSubject: response.commitSubject,
      }),
    });
  } catch (error) {
    const message = commitErrorMessage(error);
    toast.error(COMMIT_FAILED_TITLE, {
      id: toastId,
      ...(message === COMMIT_FAILED_TITLE ? {} : { description: message }),
    });
  }
}

export function commit(
  sdk: PluginBrowserBbSdk,
  target: CommitDialogTarget,
): Promise<void> {
  const queue = queues.get(target.threadId) ?? {
    tail: Promise.resolve(),
    pending: 0,
  };
  queues.set(target.threadId, queue);
  const isQueued = queue.pending > 0;
  queue.pending += 1;
  const toastId = toast.loading(isQueued ? "Commit queued" : "Creating commit");
  const run = async (): Promise<void> => {
    if (isQueued) toast.loading("Creating commit", { id: toastId });
    await runCommit(sdk, target.environmentId, toastId);
  };
  const queued = queue.tail.then(run, run);
  queue.tail = queued
    .catch(() => undefined)
    .finally(() => {
      queue.pending -= 1;
      if (queue.pending === 0 && queues.get(target.threadId) === queue) {
        queues.delete(target.threadId);
      }
    });
  return queued;
}
