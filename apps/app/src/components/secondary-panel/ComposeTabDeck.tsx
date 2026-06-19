import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { cn } from "@/lib/utils";
import type { ComposeFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  ComposeTabContent,
  type SetComposeThreadId,
} from "./ComposeTabContent";

export interface ComposeTabDeckProps {
  composeTabs: readonly ComposeFixedPanelTab[];
  activeComposeTabId: string | null;
  resolveMentionLink: PromptMentionLinkResolver;
  onSetThreadId: SetComposeThreadId;
}

/**
 * Renders every open compose tab at once, keeping each one's composer draft and
 * (after submit) launched-thread timeline mounted for the tab's whole lifetime.
 * Only the active tab is visible; the rest are `display:none`, so switching tabs
 * never drops in-flight composer text or interrupts the new thread streaming.
 * Mirrors `SideChatTabDeck`; the whole deck collapses to `display:none` when no
 * compose tab is active.
 */
export function ComposeTabDeck({
  composeTabs,
  activeComposeTabId,
  resolveMentionLink,
  onSetThreadId,
}: ComposeTabDeckProps) {
  if (composeTabs.length === 0) {
    return null;
  }
  const isComposeTabActive = activeComposeTabId !== null;
  return (
    <div
      className={cn(
        "min-h-0 flex-1",
        isComposeTabActive ? "flex flex-col" : "hidden",
      )}
    >
      {composeTabs.map((tab) => {
        const isActive = tab.id === activeComposeTabId;
        return (
          <div
            key={tab.id}
            className={cn(isActive ? "flex min-h-0 flex-1 flex-col" : "hidden")}
          >
            <ComposeTabContent
              isActive={isActive}
              tab={tab}
              resolveMentionLink={resolveMentionLink}
              onSetThreadId={onSetThreadId}
            />
          </div>
        );
      })}
    </div>
  );
}
