import { Button } from "@bb/shared-ui/button";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";

export type ThreadListPlaceholderState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "failed"; onRetry: () => void }
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
        className="p-2"
      >
        <div className="space-y-1.5 px-2 pt-1">
          <LoadingRow textWidthClassName="w-2/3" />
          <LoadingRow textWidthClassName="w-1/2" />
        </div>
      </div>
    );
  }
  if (state.kind === "missing") {
    return (
      <div
        role="status"
        data-thread-list-placeholder="missing"
        className="flex flex-col gap-2 px-4 py-2 text-sm text-muted-foreground"
      >
        <span>No thread list plugin is enabled.</span>
      </div>
    );
  }
  const alert =
    state.kind === "failed"
      ? {
          message: "Thread list couldn't load.",
          action: "Retry",
          onClick: state.onRetry,
        }
      : {
          message: `${state.pluginTitle} stopped working.`,
          action: "Reload",
          onClick: state.onReload,
        };
  return (
    <div
      role="alert"
      data-thread-list-placeholder={state.kind}
      className="flex flex-col gap-2 px-4 py-2 text-sm text-muted-foreground"
    >
      <span>{alert.message}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={alert.onClick}
      >
        {alert.action}
      </Button>
    </div>
  );
}
