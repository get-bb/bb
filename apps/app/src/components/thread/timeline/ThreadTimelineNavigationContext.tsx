import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PromptMentionLinkResolver } from "@bb/client-core";
import type { ThreadTimelineLocalFileLinkHandler } from "./types.js";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing";
import { buildThreadHostFileContentUrl } from "@/lib/file-content-urls";

interface ThreadTimelineNavigation {
  environmentId: string | null;
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
  onOpenLocalFileLink,
  resolveMentionLink,
  threadId,
  workspaceRootPath,
}: ThreadTimelineNavigation & { children: ReactNode }) {
  const navigation = useMemo<ThreadTimelineNavigation>(
    () => ({
      environmentId,
      onOpenLocalFileLink,
      resolveMentionLink,
      threadId,
      workspaceRootPath,
    }),
    [
      environmentId,
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

export function useMessageLinkRouting(
  threadId: string | undefined,
): MarkdownLinkRouting | undefined {
  const navigation = useThreadTimelineNavigation();
  const onOpenLocalFileLink = navigation?.onOpenLocalFileLink;
  const workspaceRootPath = navigation?.workspaceRootPath;
  return useMemo(() => {
    if (onOpenLocalFileLink === undefined && threadId === undefined) {
      return undefined;
    }
    const relativePaths =
      workspaceRootPath === undefined
        ? undefined
        : { baseDir: workspaceRootPath, rootPath: workspaceRootPath };
    const routing: MarkdownLinkRouting = {};
    if (threadId !== undefined) {
      routing.localImage = {
        absolutePaths: { kind: "trusted-host" },
        resolveSrc: ({ path }) => buildThreadHostFileContentUrl(threadId, path),
        ...(relativePaths === undefined ? {} : { relativePaths }),
      };
    }
    if (onOpenLocalFileLink !== undefined) {
      routing.localFile = {
        absoluteLinks: { kind: "trusted-host" },
        onOpenLink: onOpenLocalFileLink,
        ...(relativePaths === undefined
          ? {}
          : { relativeLinks: relativePaths }),
      };
    }
    return routing;
  }, [onOpenLocalFileLink, threadId, workspaceRootPath]);
}
