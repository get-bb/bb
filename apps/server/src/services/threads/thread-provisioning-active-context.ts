import type { ThreadProvisionContext } from "./thread-provisioning-context.js";

const activeThreadProvisionContexts = new Map<string, ThreadProvisionContext>();

export function rememberActiveThreadProvisionContext(entry: {
  context: ThreadProvisionContext;
  threadId: string;
}): void {
  activeThreadProvisionContexts.set(entry.threadId, entry.context);
}

export function forgetActiveThreadProvisionContext(threadId: string): void {
  activeThreadProvisionContexts.delete(threadId);
}

export function getActiveThreadProvisionContext(
  threadId: string,
): ThreadProvisionContext | null {
  return activeThreadProvisionContexts.get(threadId) ?? null;
}
