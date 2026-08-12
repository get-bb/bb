interface RetryStateProps {
  onRetry(): void;
}

export function CanvasLoadingState(): React.JSX.Element {
  return (
    <div
      aria-label="Loading product-security model"
      className="grid h-full min-h-80 grid-cols-3 gap-8 bg-background p-10"
      role="status"
    >
      {[0, 1, 2].map((column) => (
        <div className="space-y-16" key={column}>
          {[0, 1].map((row) => (
            <div
              className="h-28 animate-pulse rounded-lg border border-border bg-muted"
              key={row}
            />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading architecture canvas</span>
    </div>
  );
}

export function CanvasEmptyState({
  onRetry,
}: RetryStateProps): React.JSX.Element {
  return (
    <div className="flex h-full min-h-80 items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center text-card-foreground">
        <p className="text-base font-medium">No architecture model yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Pull Product Security from the Sync panel or add local architecture
          YAML, then retry this cache read.
        </p>
        <button
          className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRetry}
          type="button"
        >
          Retry local read
        </button>
      </div>
    </div>
  );
}

export function CanvasErrorState({
  onRetry,
}: RetryStateProps): React.JSX.Element {
  return (
    <div className="flex h-full min-h-80 items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-lg border border-destructive/40 bg-card p-6 text-card-foreground">
        <p className="text-base font-medium">
          Product-security cache unavailable
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          The local cache could not be read. The canvas did not contact Forge or
          an upstream service.
        </p>
        <button
          className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRetry}
          type="button"
        >
          Retry local read
        </button>
      </div>
    </div>
  );
}

export function CanvasUnconfiguredState(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-80 items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground">
        <p className="text-base font-medium">Choose a project</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Product Security needs a project context before it can read local YAML
          or the accepted cache.
        </p>
      </div>
    </div>
  );
}

interface CanvasCacheBannerProps {
  stale: boolean;
  error: string | null;
  pulledAt: string | null;
}

export function CanvasCacheBanner({
  stale,
  error,
  pulledAt,
}: CanvasCacheBannerProps): React.JSX.Element | null {
  if (!stale && !error) return null;
  return (
    <div
      className="border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground"
      role="status"
    >
      {error
        ? "Refresh failed. The accepted warm-cache canvas remains available."
        : "This canvas is stale and remains readable from the accepted local cache."}
      {pulledAt ? ` Last accepted pull: ${pulledAt}.` : ""}
    </div>
  );
}
