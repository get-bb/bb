import type { ThreadListEntry } from "@bb/domain";
import type { PluginThreadStatus } from "@get-bb/plugin-sdk";
import { experimental_resolveThreadStatus } from "@get-bb/plugin-sdk/internal/thread-status";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";
import { toThreadStatusThread } from "@/lib/plugin-sidebar-threads";
import { usePluginThreadRowStatus } from "@/lib/plugin-thread-row-status";

interface HiddenThreads {
  threads: readonly ThreadListEntry[];
  haveDraft: boolean;
}

const NO_HIDDEN_THREADS: HiddenThreads = { threads: [], haveDraft: false };

export function useThreadListEntryStatus(
  thread: ThreadListEntry,
  hidden: HiddenThreads = NO_HIDDEN_THREADS,
): PluginThreadStatus {
  const hasDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId: thread.projectId,
    threadId: thread.id,
  });
  const rowStatus = usePluginThreadRowStatus(thread.id);
  return experimental_resolveThreadStatus({
    thread: toThreadStatusThread(thread),
    hiddenThreads: hidden.threads.map(toThreadStatusThread),
    hasUnsubmittedDraft: hasDraft || hidden.haveDraft,
    rowStatus,
  });
}
