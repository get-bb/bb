import { Alert, AlertDescription, AlertTitle } from "@bb/shared-ui/alert";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";

export function FindingsLoadingState(): React.JSX.Element {
  return (
    <div aria-label="Loading findings" className="space-y-1 p-3" role="status">
      {Array.from({ length: 12 }, (_, index) => (
        <div className="flex h-11 items-center gap-3 border-b border-border/60" key={index}>
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
      <span className="sr-only">Reading cursor-paged findings from the local cache</span>
    </div>
  );
}

function Centered({ icon, title, detail, action }: { icon: "AlertTriangle" | "Search" | "PackageReceive"; title: string; detail: string; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-80 items-center justify-center p-6">
      <div className="max-w-lg rounded-lg border border-border bg-card p-6 text-center text-card-foreground shadow-xs">
        <Icon aria-hidden="true" className="mx-auto size-6 text-muted-foreground" name={icon} />
        <h2 className="mt-3 text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

export function FindingsEmptyState({ filtered, onClear, onRetry }: { filtered: boolean; onClear(): void; onRetry(): void }): React.JSX.Element {
  return filtered ? (
    <Centered action={<Button onClick={onClear} variant="outline">Clear filters</Button>} detail="No cached finding satisfies every active filter. Broaden the query or open a saved view." icon="Search" title="No matching findings" />
  ) : (
    <Centered action={<Button onClick={onRetry} variant="outline"><Icon aria-hidden="true" className="size-4" name="RotateCcw" />Check local cache</Button>} detail="Pull findings from the Sync panel or run bb finite-state sync pull --surface findings. This panel reads the accepted SQLite cache only." icon="PackageReceive" title="No findings cached" />
  );
}

export function FindingsErrorState({ message, onRetry }: { message: string; onRetry(): void }): React.JSX.Element {
  return <Centered action={<Button onClick={onRetry} variant="outline">Retry cached read</Button>} detail={message} icon="AlertTriangle" title="Findings unavailable" />;
}

export function FindingsUnconfiguredState({ detail }: { detail: string }): React.JSX.Element {
  return <Centered detail={detail} icon="PackageReceive" title="Choose a findings scope" />;
}

export function FindingsViewNotFound({ name, onReturn }: { name: string; onReturn(): void }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-sm">
        <Icon aria-hidden="true" className="mx-auto size-8 text-muted-foreground" name="Search" />
        <h2 className="mt-3 text-base font-semibold">Saved view not found</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">The saved view “{name}” was deleted or is no longer available in this workspace.</p>
        <Button className="mt-4" onClick={onReturn} size="sm" variant="outline">Return to findings</Button>
      </div>
    </div>
  );
}

export function FindingsStaleBanner({ message, onDismiss, onRetry }: { message: string; onDismiss(): void; onRetry(): void }): React.JSX.Element {
  return (
    <Alert className="rounded-none border-x-0 border-t-0" variant="destructive">
      <Icon aria-hidden="true" className="size-4" name="AlertTriangle" />
      <AlertTitle>Showing accepted stale data</AlertTitle>
      <AlertDescription className="flex items-center gap-3">
        <span className="min-w-0 flex-1">{message}</span>
        <Button onClick={onRetry} size="sm" variant="outline">Retry</Button>
        <Button aria-label="Dismiss stale data warning" onClick={onDismiss} size="icon" variant="ghost"><Icon aria-hidden="true" className="size-4" name="X" /></Button>
      </AlertDescription>
    </Alert>
  );
}

export function FindingsPageError({ message, loading, onRetry }: { message: string; loading: boolean; onRetry(): void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 border-t border-destructive/40 bg-muted px-4 py-2 text-xs" role="alert">
      <Icon aria-hidden="true" className="size-4 text-destructive" name="AlertTriangle" />
      <span className="flex-1">Next page failed: {message}. Loaded findings remain available.</span>
      <Button disabled={loading} onClick={onRetry} size="sm" variant="outline">Retry page</Button>
    </div>
  );
}
