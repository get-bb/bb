import { useCallback } from "react";
import { Link } from "react-router-dom";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import { getThreadRoutePath } from "@/lib/route-paths";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { ComposeFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { ThreadTimelinePanelContent } from "@/components/thread/timeline/ThreadTimelinePanelContent";
import { Icon } from "@/components/ui/icon";
import { RootComposeView } from "@/views/RootComposeView";

export type SetComposeThreadId = (args: {
  tabId: string;
  projectId: string;
  threadId: string;
}) => void;

export interface ComposeTabContentProps {
  isActive: boolean;
  tab: ComposeFixedPanelTab;
  resolveMentionLink: PromptMentionLinkResolver;
  onSetThreadId: SetComposeThreadId;
}

/**
 * A full-page new-thread composer hosted in the secondary panel. Before submit
 * it embeds the same composer as the root compose page (`RootComposeView` in its
 * embeddable "popout" surface), so it inherits project/environment/branch/model
 * selection, attachments, mentions, slash commands, prompt history, and the rich
 * markdown editor. On submit a brand-new top-level thread is created; the tab
 * records its id and switches to rendering that thread's live timeline — "the
 * tab turns into the thread you just launched".
 */
export function ComposeTabContent({
  tab,
  resolveMentionLink,
  onSetThreadId,
}: ComposeTabContentProps) {
  const handleThreadCreated = useCallback(
    (args: ThreadRoutePathArgs) => {
      onSetThreadId({
        tabId: tab.id,
        projectId: args.projectId,
        threadId: args.threadId,
      });
    },
    [onSetThreadId, tab.id],
  );

  if (tab.threadId === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background px-4 pb-4 pt-3">
        <RootComposeView
          surface="popout"
          onThreadCreated={handleThreadCreated}
          onEscapeEmptyPrompt={() => {}}
        />
      </div>
    );
  }

  const threadRoutePath =
    tab.projectId !== null
      ? getThreadRoutePath({
          projectId: tab.projectId,
          threadId: tab.threadId,
        })
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="MessageSquarePlus" className="size-3.5" aria-hidden />
          Launched thread
        </span>
        {threadRoutePath !== null ? (
          <Link
            to={threadRoutePath}
            className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            Open
          </Link>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <ThreadTimelinePanelContent
          threadId={tab.threadId}
          projectId={tab.projectId ?? undefined}
          resolveMentionLink={resolveMentionLink}
        />
      </div>
    </div>
  );
}
