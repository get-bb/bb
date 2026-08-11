import type { ReactNode } from "react";
import type { ThreadTimelineUnreadDividerPlacement } from "@/components/thread/timeline";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { EmbeddedThreadChat } from "@/components/thread/embedded-chat";
import type {
  HostConnectionNotice,
  ThreadTimelineSurfaceProps,
} from "@/components/thread/timeline/ThreadTimelineSurface";
import { ThreadRewindRecoveryBanner } from "./ThreadRewindRecoveryBanner";
import { ThreadTableOfContents } from "@/components/thread/toc/ThreadTableOfContents";

interface ThreadTimelinePaneProps extends ThreadTimelineSurfaceProps {
  canSpawnChild: boolean;
  footer: ReactNode;
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  isStopping: boolean;
  onLoadOlderRows: () => void;
  resolveMentionLink: PromptMentionLinkResolver;
  stoppingAnchorAt: number;
  unreadDividerAutoScroll: boolean;
  unreadDividerPlacement: ThreadTimelineUnreadDividerPlacement | null;
}

export type { HostConnectionNotice };

export function ThreadTimelinePane({
  footer,
  ...surface
}: ThreadTimelinePaneProps) {
  const rewindBanner =
    surface.threadId.length > 0 ? (
      <ThreadRewindRecoveryBanner threadId={surface.threadId} />
    ) : null;
  return (
    <EmbeddedThreadChat
      variant="hosted-footer"
      threadId={surface.threadId}
      footer={footer}
      scrollOverlay={
        <ThreadTableOfContents
          threadId={surface.threadId}
          timelineRows={surface.timelineRows}
          hasOlderTimelineRows={surface.hasOlderTimelineRows}
          loadOlderTimelineRows={surface.onLoadOlderRows}
        />
      }
      surface={{ ...surface, leadingContent: rewindBanner }}
    />
  );
}
