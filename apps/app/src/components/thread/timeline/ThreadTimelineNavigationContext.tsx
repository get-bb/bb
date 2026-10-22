import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PromptMentionLinkResolver } from "@bb/client-core";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
} from "./types.js";

interface ThreadTimelineNavigation {
  environmentId: string | null;
  onOpenLink: ThreadTimelineLinkHandler;
  onOpenLocalFileLink: ThreadTimelineLocalFileLinkHandler;
  resolveMentionLink: PromptMentionLinkResolver;
  threadId?: string;
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
  threadId,
  workspaceRootPath,
}: ThreadTimelineNavigation & { children: ReactNode }) {
  const navigation = useMemo<ThreadTimelineNavigation>(
    () => ({
      environmentId,
      onOpenLink,
      onOpenLocalFileLink,
      resolveMentionLink,
      threadId,
      workspaceRootPath,
    }),
    [
      environmentId,
      onOpenLink,
      onOpenLocalFileLink,
      resolveMentionLink,
      threadId,
      workspaceRootPath,
    ],
  );

  return (
    <ThreadTimelineNavigationContext.Provider value={navigation}>
      {children}
    </ThreadTimelineNavigationContext.Provider>
  );
}

export function useThreadTimelineNavigation(): ThreadTimelineNavigation | null {
  return useContext(ThreadTimelineNavigationContext);
}
