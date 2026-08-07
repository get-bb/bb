import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import type { ProviderRetryView } from "./src/contract.js";

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

function retryLabel(retryAtMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(retryAtMs));
}

function description(view: ProviderRetryView): string {
  const provider = providerLabel(view.providerId);
  const retry =
    view.retryAtMs === null
      ? "Retrying automatically."
      : `Retrying ${retryLabel(view.retryAtMs)}.`;
  return `${provider} usage limit reached. ${retry}`;
}

export function ProviderRetryBannerView({
  cancelling,
  onCancel,
  view,
}: {
  cancelling: boolean;
  onCancel: () => void | Promise<void>;
  view: ProviderRetryView;
}) {
  return (
    <section
      aria-label="Provider usage recovery"
      className="grid grid-cols-[0.875rem_minmax(0,1fr)] items-start gap-x-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-foreground"
    >
      <Icon
        name="Clock"
        className="mt-0.5 size-3.5 text-warning-text"
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="leading-5">{description(view)}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 self-start px-2 text-xs text-muted-foreground"
          disabled={cancelling}
          onClick={() => void onCancel()}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}
