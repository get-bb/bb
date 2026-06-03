import { memo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAtomValue, useSetAtom } from "jotai";
import type { AppSummary } from "@bb/server-contract";
import { ResolvedAppIcon } from "@/components/secondary-panel/AppIcon";
import { useOpenThreadAppTab } from "@/components/secondary-panel/useThreadFileTabs";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { useAppRoute } from "@/hooks/useAppRoute";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
import { getActiveSecondaryAppId } from "@/lib/fixed-panel-tabs-state";
import { getThreadRoutePath } from "@/lib/app-route-paths";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
} from "./sidebarRowClasses";

interface SidebarAppsSectionProps {
  apps: readonly AppSummary[];
}

interface SidebarAppRowProps {
  app: AppSummary;
  isActive: boolean;
  projectId: string | undefined;
  threadId: string | undefined;
}

const SidebarAppRow = memo(function SidebarAppRow({
  app,
  isActive,
  projectId,
  threadId,
}: SidebarAppRowProps) {
  const navigate = useNavigate();
  const openThreadAppTab = useOpenThreadAppTab(threadId);
  const setConversationCollapsed = useSetAtom(
    getThreadConversationCollapsedAtom(threadId),
  );
  // Apps render only inside a thread's secondary panel, so opening one targets
  // the thread currently in view: reveal its app tab (which also opens the
  // panel), tuck the conversation into the collapsed rail so the app fills the
  // view, and route to that thread. With no thread selected there is no panel to
  // host the app, so the row is inert.
  const canOpen = threadId !== undefined && projectId !== undefined;
  const openApp = useCallback(() => {
    if (threadId === undefined || projectId === undefined) {
      return;
    }
    openThreadAppTab(app.applicationId);
    setConversationCollapsed(true);
    navigate(getThreadRoutePath({ projectId, threadId }));
  }, [
    app.applicationId,
    navigate,
    openThreadAppTab,
    projectId,
    setConversationCollapsed,
    threadId,
  ]);

  return (
    <button
      type="button"
      aria-label={`Open ${app.name} app`}
      title={canOpen ? `${app.name} app` : `Open a thread to launch ${app.name}`}
      disabled={!canOpen}
      className={cn(
        "group/sidebar-app-row",
        SIDEBAR_ROW_BASE_CLASS,
        COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
        "cursor-pointer pr-2 text-left outline-none ring-sidebar-ring focus-visible:ring-2 disabled:cursor-default disabled:opacity-60",
        isActive
          ? "bg-sidebar-border text-sidebar-foreground"
          : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
      )}
      onClick={openApp}
    >
      <span
        className={cn(
          "relative z-10",
          SIDEBAR_ROW_GLYPH_SLOT_CLASS,
          COARSE_POINTER_GLYPH_BOX_CLASS,
        )}
        aria-hidden="true"
      >
        <ResolvedAppIcon
          icon={app.icon}
          className={cn(COARSE_POINTER_ICON_SIZE_CLASS, "text-current")}
        />
      </span>
      <span className="relative z-10 min-w-0 flex-1 truncate">{app.name}</span>
    </button>
  );
});

/**
 * Top-level sidebar list of the global apps. Apps are not nested under any
 * project or manager: there is one canonical list, sourced from `useApps()` by
 * the caller. Opening an app reuses the per-thread panel path against the
 * currently selected thread (see `SidebarAppRow`), and the active highlight
 * follows that thread's full-screen app surface so it never collides with the
 * selected thread row.
 */
export const SidebarAppsSection = memo(function SidebarAppsSection({
  apps,
}: SidebarAppsSectionProps) {
  const { projectId: selectedProjectId, threadId: selectedThreadId } =
    useAppRoute();
  const fixedPanelTabsState = useFixedPanelTabsState(selectedThreadId);
  const isConversationCollapsed = useAtomValue(
    getThreadConversationCollapsedAtom(selectedThreadId),
  );
  const activeAppId =
    selectedThreadId !== undefined && isConversationCollapsed
      ? getActiveSecondaryAppId(fixedPanelTabsState)
      : null;

  return (
    <div className="space-y-px group-data-[collapsible=icon]:hidden">
      {apps.map((app) => (
        <SidebarAppRow
          key={app.applicationId}
          app={app}
          isActive={activeAppId === app.applicationId}
          projectId={selectedProjectId}
          threadId={selectedThreadId}
        />
      ))}
    </div>
  );
});
