import { memo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { AppSummary } from "@bb/server-contract";
import { ResolvedAppIcon } from "@/components/secondary-panel/AppIcon";
import { Icon } from "@/components/ui/icon.js";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { useCloseMobileSidebar } from "@/components/ui/sidebar.js";
import { useAppRoute } from "@/hooks/useAppRoute";
import { getStandaloneAppRoutePath } from "@/lib/app-route-paths";
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
}

const SidebarAppRow = memo(function SidebarAppRow({
  app,
  isActive,
}: SidebarAppRowProps) {
  const navigate = useNavigate();
  const closeMobileSidebar = useCloseMobileSidebar();
  // Global apps open on their own thread-independent route, so the row simply
  // navigates there — no thread required, and the active highlight follows the
  // current `/apps/:applicationId` route.
  const openApp = useCallback(() => {
    closeMobileSidebar();
    navigate(getStandaloneAppRoutePath(app.applicationId));
  }, [app.applicationId, closeMobileSidebar, navigate]);

  return (
    <button
      type="button"
      aria-label={`Open ${app.name} app`}
      title={`${app.name} app`}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group/sidebar-app-row",
        SIDEBAR_ROW_BASE_CLASS,
        COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
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
      {app.source !== null ? (
        // Source-managed apps update on source sync; the glyph marks them as
        // externally owned without taking row space from the name.
        <Icon
          name="GitBranch"
          aria-hidden="true"
          className="relative z-10 size-3 shrink-0 text-muted-foreground"
        />
      ) : null}
    </button>
  );
});

/**
 * Top-level sidebar list of the global apps. Apps are not nested under any
 * project or manager: there is one canonical list, sourced from `useApps()` by
 * the caller. Opening an app routes to its standalone surface
 * (`/apps/:applicationId`), which is thread-independent, so rows stay active
 * even with no thread selected. The highlight follows the current app route.
 */
export const SidebarAppsSection = memo(function SidebarAppsSection({
  apps,
}: SidebarAppsSectionProps) {
  const { applicationId: activeApplicationId } = useAppRoute();

  return (
    <div className="space-y-px group-data-[collapsible=icon]:hidden">
      {apps.map((app) => (
        <SidebarAppRow
          key={app.applicationId}
          app={app}
          isActive={activeApplicationId === app.applicationId}
        />
      ))}
    </div>
  );
});
