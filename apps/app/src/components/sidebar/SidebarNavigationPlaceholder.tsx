import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@bb/shared-ui/button";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import { createLastKnownCache } from "@/lib/last-known-cache";
import { getPluginsRoutePath } from "@/lib/route-paths";

export type SidebarNavigationPlaceholderState =
  | { kind: "loading"; height: number | null }
  | { kind: "missing" }
  | { kind: "crashed"; pluginTitle: string; onReload: () => void };

const DEFAULT_LOADING_ROWS = 4;
const LOADING_ROW_PITCH = 30;
const LOADING_ROW_WIDTHS = ["w-1/2", "w-2/5", "w-1/3", "w-2/5", "w-1/2"];

const heightCache = createLastKnownCache({
  prefix: "bb.sidebar-navigation-height",
  version: "1",
  schema: z.number().int().nonnegative(),
  maxEntries: 8,
});

export function readRememberedNavigationHeight(
  providerKey: string,
): number | null {
  return heightCache.read(heightCache.key(providerKey));
}

export function rememberNavigationHeight(
  providerKey: string,
  height: number,
): void {
  const key = heightCache.key(providerKey);
  if (heightCache.read(key) === height) return;
  heightCache.write(key, height);
}

function LoadingRow({ widthClassName }: { widthClassName: string }) {
  return (
    <div className="flex h-7 items-center rounded-md px-2">
      <Skeleton
        className={cn("h-3 rounded-sm bg-sidebar-border/50", widthClassName)}
      />
    </div>
  );
}

export function SidebarNavigationPlaceholder({
  state,
  onNavigate,
}: {
  state: SidebarNavigationPlaceholderState;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  if (state.kind === "loading") {
    if (state.height === 0) return null;
    const rows =
      state.height === null
        ? DEFAULT_LOADING_ROWS
        : Math.max(1, Math.floor(state.height / LOADING_ROW_PITCH));
    return (
      <div
        aria-label="Loading sidebar navigation"
        data-sidebar-navigation-placeholder="loading"
        className="space-y-0.5 overflow-hidden px-2 py-2"
        style={state.height === null ? undefined : { height: state.height }}
      >
        {Array.from({ length: rows }, (_, index) => (
          <LoadingRow
            key={index}
            widthClassName={
              LOADING_ROW_WIDTHS[index % LOADING_ROW_WIDTHS.length] ?? "w-1/2"
            }
          />
        ))}
      </div>
    );
  }
  if (state.kind === "missing") {
    return (
      <div
        role="status"
        data-sidebar-navigation-placeholder="missing"
        className="flex flex-col gap-2 px-3 py-2 text-sm text-muted-foreground"
      >
        <span>No navigation plugin is enabled.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            onNavigate?.();
            void navigate(getPluginsRoutePath());
          }}
        >
          Open Plugins
        </Button>
      </div>
    );
  }
  return (
    <div
      role="alert"
      data-sidebar-navigation-placeholder="crashed"
      className="flex flex-col gap-2 px-3 py-2 text-sm text-muted-foreground"
    >
      <span>{state.pluginTitle} stopped working.</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={state.onReload}
      >
        Reload
      </Button>
    </div>
  );
}
