import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
} from "./types.js";

interface ThreadTimelineNavigation {
  environmentId: string | null;
  onOpenLink: ThreadTimelineLinkHandler;
  onOpenLocalFileLink: ThreadTimelineLocalFileLinkHandler;
  resolveMentionLink: PromptMentionLinkResolver;
  workspaceRootPath: string | undefined;
}

const ThreadTimelineNavigationContext =
  createContext<ThreadTimelineNavigation | null>(null);

export function ThreadTimelineNavigationProvider({
  children,
  environmentId,
  onOpenLink,
  onOpenLocalFileLink,
  resolveMentionLink,
  workspaceRootPath,
}: ThreadTimelineNavigation & { children: ReactNode }) {
  const navigation = useMemo<ThreadTimelineNavigation>(
    () => ({
      environmentId,
      onOpenLink,
      onOpenLocalFileLink,
      resolveMentionLink,
      workspaceRootPath,
    }),
    [
      environmentId,
      onOpenLink,
      onOpenLocalFileLink,
      resolveMentionLink,
      workspaceRootPath,
    ],
  );

  return (
    <ThreadTimelineNavigationContext.Provider value={navigation}>
      {children}
    </ThreadTimelineNavigationContext.Provider>
  );
}

/**
 * Navigation owned by the surrounding thread detail surface. Hosted plugin
 * panels consume it without adding file-viewer controls to the public plugin
 * SDK contract. Null means the plugin component is mounted outside a thread
 * detail surface and must leave host-local links inert.
 */
export function useThreadTimelineNavigation(): ThreadTimelineNavigation | null {
  return useContext(ThreadTimelineNavigationContext);
}
