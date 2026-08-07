import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import type { ProviderRetryView } from "./src/contract.js";

export type ProviderRetryBannerAction = "cancel" | "now" | "refresh";

function providerLabel(providerId: string): string {
  switch (providerId) {
    case "codex":
      return "Codex";
    case "claude-code":
      return "Claude Code";
    default:
      return providerId;
  }
}

function resetLabel(dueAtMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dueAtMs));
}

function limitDescription(view: ProviderRetryView): string {
  const provider = providerLabel(view.providerId);
  const window = view.windowLabel ? ` ${view.windowLabel.toLowerCase()}` : "";
  if (view.phase === "unsafe") {
    return `${provider}${window} usage limit reached, but bb cannot safely continue this turn because output or other work may already have occurred.`;
  }
  if (view.phase === "blocked") {
    const reason = view.reachedReason ?? view.overageReason;
    return `${provider} ${view.kind.replaceAll("-", " ")} limit reached${reason ? ` (${reason.replaceAll("_", " ")})` : ""}. There is no automatic reset time.`;
  }
  if (view.phase === "manual-only") {
    const reset =
      view.resetsAtMs === null
        ? "at an unknown time"
        : resetLabel(view.resetsAtMs);
    return `${provider}${window} usage limit resets ${reset}, beyond the configured maximum automatic wait. Retry manually when ready.`;
  }
  if (view.phase === "waiting-for-host") {
    return `${provider}${window} usage limit reset passed. This thread will continue when its host reconnects, while this bb server remains running.`;
  }
  if (view.phase === "retry-failed") {
    return `${provider}${window} usage is available, but bb could not continue automatically${view.continuationError ? `: ${view.continuationError}` : ""}. Resolve the issue, then retry.`;
  }
  if (view.phase === "releasing") {
    return `${provider}${window} usage is available. Continuing this thread…`;
  }
  if (view.dueAtMs !== null) {
    return `${provider}${window} usage limit reached. This thread will continue ${resetLabel(view.dueAtMs)} while this bb server remains running.`;
  }
  return `${provider}${window} usage limit reached.`;
}

export function ProviderRetryBannerView({
  actionError,
  busy,
  onAction,
  view,
}: {
  actionError: string | null;
  busy: ProviderRetryBannerAction | null;
  onAction: (action: ProviderRetryBannerAction) => void | Promise<void>;
  view: ProviderRetryView;
}) {
  const canRefresh =
    view.providerId === "codex" || view.providerId === "claude-code";
  const canRetry = view.failedRequestId !== null && view.phase !== "releasing";

  return (
    <section
      aria-label="Provider usage recovery"
      className="grid grid-cols-[0.875rem_minmax(0,1fr)] items-start gap-x-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-foreground"
    >
      <Icon
        name={view.phase === "releasing" ? "Spinner" : "Clock"}
        className={`mt-0.5 size-3.5 text-warning-text ${
          view.phase === "releasing" ? "animate-spin" : ""
        }`}
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="min-w-0 flex-1 leading-5">{limitDescription(view)}</p>
        {view.refreshError === null ? null : (
          <p role="status" className="text-warning-text">
            Refresh unavailable: {view.refreshError}
          </p>
        )}
        {actionError === null ? null : (
          <p role="alert" className="text-destructive-text">
            {actionError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {canRefresh ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy !== null || view.phase === "releasing"}
              onClick={() => void onAction("refresh")}
            >
              {busy === "refresh" ? "Refreshing…" : "Refresh"}
            </Button>
          ) : null}
          {canRetry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy !== null}
              onClick={() => void onAction("now")}
            >
              {busy === "now" ? "Continuing…" : "Retry now"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={busy !== null || view.phase === "releasing"}
            onClick={() => void onAction("cancel")}
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      </div>
    </section>
  );
}
