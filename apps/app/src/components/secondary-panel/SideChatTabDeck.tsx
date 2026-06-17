import type { Environment, Thread } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import { cn } from "@/lib/utils";
import type { SideChatFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  SideChatTabContent,
  type SetSideChatThreadId,
} from "./SideChatTabContent";

export interface SideChatTabDeckProps {
  sideChatTabs: readonly SideChatFixedPanelTab[];
  activeSideChatTabId: string | null;
  /** The main thread the side chats are anchored to. */
  sourceThread: Thread;
  /**
   * The main thread's environment (host + branch), or null when not yet loaded
   * / for a personal-project source. Resolves each side chat's own workspace.
   */
  sourceEnvironment: Environment | null;
  /** The main thread's timeline rows, snapshotted into each side chat's first turn. */
  sourceTimelineRows: readonly TimelineRow[];
  onSetThreadId: SetSideChatThreadId;
}

/**
 * Renders every open side-chat tab at once, keeping each one's composer state
 * and child-thread conversation mounted for the tab's whole lifetime. Only the
 * active tab is visible; the rest are `display:none` — so switching tabs is a
 * visibility toggle, never a destroy/recreate that would drop in-flight
 * composer text or interrupt a streaming response. Mirrors `BrowserTabDeck`'s
 * keep-mounted model; the whole deck collapses to `display:none` when no
 * side-chat tab is active.
 */
export function SideChatTabDeck({
  sideChatTabs,
  activeSideChatTabId,
  sourceThread,
  sourceEnvironment,
  sourceTimelineRows,
  onSetThreadId,
}: SideChatTabDeckProps) {
  if (sideChatTabs.length === 0) {
    return null;
  }
  const isSideChatTabActive = activeSideChatTabId !== null;
  return (
    <div
      className={cn(
        "min-h-0 flex-1",
        isSideChatTabActive ? "flex flex-col" : "hidden",
      )}
    >
      {sideChatTabs.map((tab) => {
        const isActive = tab.id === activeSideChatTabId;
        return (
          <div
            key={tab.id}
            className={cn(isActive ? "flex min-h-0 flex-1 flex-col" : "hidden")}
          >
            <SideChatTabContent
              isActive={isActive}
              tab={tab}
              sourceThread={sourceThread}
              sourceEnvironment={sourceEnvironment}
              sourceTimelineRows={sourceTimelineRows}
              onSetThreadId={onSetThreadId}
            />
          </div>
        );
      })}
    </div>
  );
}
