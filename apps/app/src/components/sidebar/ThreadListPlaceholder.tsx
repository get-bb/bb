import { useSyncExternalStore } from "react";
import { Button } from "@bb/shared-ui/button";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  isPluginFrontendBootSettled,
  subscribePluginFrontendBoot,
} from "@/lib/plugin-frontend";
import { getPluginsRoutePath } from "@/lib/route-paths";

export function usePluginFrontendBootSettled(): boolean {
  return useSyncExternalStore(
    subscribePluginFrontendBoot,
    isPluginFrontendBootSettled,
    isPluginFrontendBootSettled,
  );
}

export type ThreadListPlaceholderState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "crashed"; pluginTitle: string; onReload: () => void };

function LoadingRow({ textWidthClassName }: { textWidthClassName: string }) {
  return (
    <div
      data-sidebar="navigation-loading-row"
      className="flex h-7 items-center gap-2 rounded-md"
    >
      <Skeleton className="size-4 shrink-0 rounded-md bg-sidebar-border/60" />
      <Skeleton
        className={cn(
          "h-3 rounded-sm bg-sidebar-border/50",
          textWidthClassName,
        )}
      />
    </div>
  );
}

export function ThreadListPlaceholder({
  state,
}: {
  state: ThreadListPlaceholderState;
}) {
  if (state.kind === "loading") {
    return (
      <div
        aria-label="Loading sidebar navigation"
        data-thread-list-placeholder="loading"
        className="space-y-1.5 px-2 pt-1"
      >
        <LoadingRow textWidthClassName="w-2/3" />
        <LoadingRow textWidthClassName="w-1/2" />
      </div>
    );
  }
  if (state.kind === "missing") {
    return (
      <div
        role="status"
        data-thread-list-placeholder="missing"
        className="flex flex-col gap-2 px-3 py-2 text-sm text-muted-foreground"
      >
        <span>No thread list plugin is enabled.</span>
        <Button asChild variant="outline" size="sm" className="self-start">
          <a href={getPluginsRoutePath()}>Open plugins</a>
        </Button>
      </div>
    );
  }
  return (
    <div
      role="alert"
      data-thread-list-placeholder="crashed"
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
