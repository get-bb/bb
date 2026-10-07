import type { Thread } from "@bb/domain";
import { isThreadRead } from "@bb/client-core";
import type { PluginThreadActionTarget } from "@get-bb/plugin-sdk";

export function toThreadActionTarget(
  thread: Thread,
  environment: PluginThreadActionTarget["environment"],
): PluginThreadActionTarget {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: !isThreadRead(thread),
    status: thread.status,
    environment,
  };
}
