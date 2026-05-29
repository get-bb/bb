import { memo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSetAtom } from "jotai";
import type { AppSummary } from "@bb/server-contract";
import { ResolvedAppIcon } from "@/components/secondary-panel/AppIcon";
import { useOpenThreadAppTab } from "@/components/secondary-panel/useThreadFileTabs";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { getThreadRoutePath } from "@/lib/app-route-paths";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  getSidebarThreadRowPaddingClass,
  type SidebarThreadRowIndent,
} from "./sidebarRowClasses";

interface ThreadAppRowProps {
  app: AppSummary;
  indent: SidebarThreadRowIndent;
  isActive: boolean;
  projectId: string;
  threadId: string;
}

function ThreadAppRowComponent({
  app,
  indent,
  isActive,
  projectId,
  threadId,
}: ThreadAppRowProps) {
  const navigate = useNavigate();
  const openThreadAppTab = useOpenThreadAppTab(threadId);
  const setConversationCollapsed = useSetAtom(
    getThreadConversationCollapsedAtom(threadId),
  );
  const openApp = useCallback(() => {
    // Opening an app makes it the active surface: reveal its tab in the
    // secondary panel (openThreadAppTab also opens the panel) and tuck the
    // conversation into the collapsed rail so the app fills the view.
    openThreadAppTab(app.id);
    setConversationCollapsed(true);
    navigate(getThreadRoutePath({ projectId, threadId }));
  }, [
    app.id,
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
      title={`${app.name} app`}
      className={cn(
        "group/thread-app-row",
        SIDEBAR_ROW_BASE_CLASS,
        COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        getSidebarThreadRowPaddingClass(indent),
        "cursor-pointer pr-2 text-left outline-none ring-sidebar-ring focus-visible:ring-2",
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
}

export const ThreadAppRow = memo(ThreadAppRowComponent);
