import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { AppSummary } from "@bb/server-contract";
import { ResolvedAppIcon } from "@/components/secondary-panel/AppIcon";
import { useOpenThreadAppTab } from "@/components/secondary-panel/useThreadFileTabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { useThreadApps } from "@/hooks/queries/thread-queries";
import { getThreadRoutePath } from "@/lib/app-route-paths";

/**
 * Trailing cluster of a thread's installed-app icons, rendered just left of the
 * row's branch/environment trailing icon. Each icon opens that app in the
 * thread's secondary panel (navigating to the thread first); beyond
 * `MAX_VISIBLE_APP_ICONS` the remainder collapse into an informational `+N` chip
 * whose tooltip + accessible name list the hidden app names. Renders nothing
 * when the thread has no apps.
 *
 * This component instantiates the thread-apps query, so mount it ONLY for
 * threads that can have apps (managers today). Mounting it per sidebar row would
 * create a TanStack query observer for every thread; the caller gates the mount.
 */
const MAX_VISIBLE_APP_ICONS = 3;

const EMPTY_THREAD_APPS: readonly AppSummary[] = [];

const APP_CLUSTER_CLASS = "relative z-10 flex items-center gap-px pr-0.5";

const APP_ICON_BUTTON_CLASS =
  "inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-subtle-foreground outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 max-md:pointer-coarse:size-6";

const APP_OVERFLOW_CHIP_CLASS =
  "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm px-1 font-mono text-xs font-medium text-subtle-foreground outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 max-md:pointer-coarse:h-6";

const APP_ICON_GLYPH_CLASS = "size-3.5 text-current";

interface ThreadRowAppClusterProps {
  projectId: string;
  threadId: string;
}

export function ThreadRowAppCluster({
  projectId,
  threadId,
}: ThreadRowAppClusterProps) {
  const appsQuery = useThreadApps(threadId);
  const apps = appsQuery.data ?? EMPTY_THREAD_APPS;
  const navigate = useNavigate();
  const openThreadAppTab = useOpenThreadAppTab(threadId);
  const openApp = useCallback(
    (appId: string) => {
      openThreadAppTab(appId);
      navigate(getThreadRoutePath({ projectId, threadId }));
    },
    [navigate, openThreadAppTab, projectId, threadId],
  );

  if (apps.length === 0) {
    return null;
  }

  const visibleApps = apps.slice(0, MAX_VISIBLE_APP_ICONS);
  const hiddenApps = apps.slice(MAX_VISIBLE_APP_ICONS);
  const hiddenAppNames = hiddenApps.map((app) => app.name);

  return (
    <TooltipProvider delayDuration={300}>
      <span className={APP_CLUSTER_CLASS}>
        {visibleApps.map((app) => (
          <Tooltip key={app.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={app.name}
                className={APP_ICON_BUTTON_CLASS}
                onClick={(event) => {
                  event.stopPropagation();
                  openApp(app.id);
                }}
              >
                <ResolvedAppIcon
                  icon={app.icon}
                  className={APP_ICON_GLYPH_CLASS}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{app.name}</TooltipContent>
          </Tooltip>
        ))}
        {hiddenApps.length > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Informational only: the chip surfaces that more apps exist and
                  names them; it does not open anything. */}
              <button
                type="button"
                aria-label={`${hiddenApps.length} more ${
                  hiddenApps.length === 1 ? "app" : "apps"
                }: ${hiddenAppNames.join(", ")}`}
                className={APP_OVERFLOW_CHIP_CLASS}
              >
                {`+${hiddenApps.length}`}
              </button>
            </TooltipTrigger>
            <TooltipContent>{hiddenAppNames.join(" · ")}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
    </TooltipProvider>
  );
}
