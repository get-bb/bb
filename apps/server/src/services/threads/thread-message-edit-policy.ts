import type { Thread } from "@bb/domain";
import type { ProviderRegistryService } from "../providers/provider-registry.js";

export interface ThreadMessageEditPolicyDeps {
  providerRegistry: Pick<ProviderRegistryService, "supportsSessionRewind">;
}

type MessageEditCandidateThread = Pick<
  Thread,
  "archivedAt" | "deletedAt" | "providerId"
>;

export function resolveThreadMessageEditRefusal(
  deps: ThreadMessageEditPolicyDeps,
  thread: MessageEditCandidateThread,
): string | null {
  if (!deps.providerRegistry.supportsSessionRewind(thread.providerId)) {
    return `Editing messages is not supported for ${thread.providerId}`;
  }
  if (thread.archivedAt !== null || thread.deletedAt !== null) {
    return "The thread is not writable";
  }
  return null;
}

export function canThreadEditMessages(
  deps: ThreadMessageEditPolicyDeps,
  thread: MessageEditCandidateThread,
): boolean {
  return resolveThreadMessageEditRefusal(deps, thread) === null;
}
