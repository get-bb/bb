import { memo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { AppSummary } from "@bb/server-contract";
import { ResolvedAppIcon } from "@/components/secondary-panel/AppIcon";
import { useOpenThreadAppTab } from "@/components/secondary-panel/useThreadFileTabs";
import { Icon } from "@/components/ui/icon.js";
import { COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { getThreadRoutePath } from "@/lib/app-route-paths";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_ROW_BASE_CLASS,
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

const APP_TILE_CLASS =
  "relative z-10 inline-grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-scope-manager-tile-border bg-scope-manager-tile-bg text-scope-manager transition-colors group-hover/thread-app-row:border-border-hairline group-hover/thread-app-row:bg-sidebar-foreground/10 max-md:pointer-coarse:size-6";

// The tile glyph sits at 12/18 of the tile (16/24 on coarse pointers) so the
// scope icon keeps even breathing room inside the tile, matching the mockup.
const APP_TILE_GLYPH_SIZE_CLASS = "size-3 max-md:pointer-coarse:size-4";

// Both glyphs share the tile's single grid cell so the app icon can crossfade
// to the drag grip on hover without shifting layout.
const APP_TILE_GLYPH_LAYER_CLASS =
  "col-start-1 row-start-1 transition-opacity duration-150";

function ThreadAppRowComponent({
  app,
  indent,
  isActive,
  projectId,
  threadId,
}: ThreadAppRowProps) {
  const navigate = useNavigate();
  const openThreadAppTab = useOpenThreadAppTab(threadId);
  const openApp = useCallback(() => {
    openThreadAppTab(app.id);
    navigate(getThreadRoutePath({ projectId, threadId }));
  }, [app.id, navigate, openThreadAppTab, projectId, threadId]);

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
      <span className={APP_TILE_CLASS} aria-hidden="true">
        <ResolvedAppIcon
          icon={app.icon}
          className={cn(
            APP_TILE_GLYPH_SIZE_CLASS,
            APP_TILE_GLYPH_LAYER_CLASS,
            "text-current group-hover/thread-app-row:opacity-0",
          )}
        />
        <Icon
          name="GripVertical"
          aria-hidden
          className={cn(
            APP_TILE_GLYPH_SIZE_CLASS,
            APP_TILE_GLYPH_LAYER_CLASS,
            "text-subtle-foreground opacity-0 group-hover/thread-app-row:opacity-100",
          )}
        />
      </span>
      <span className="relative z-10 min-w-0 flex-1 truncate">{app.name}</span>
    </button>
  );
}

export const ThreadAppRow = memo(ThreadAppRowComponent);
