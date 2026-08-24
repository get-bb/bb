import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import type { ProviderRetryView } from "./src/contract.js";

function retryLabel(retryAtMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(retryAtMs));
}

function description(view: ProviderRetryView, providerName: string): string {
  const retry =
    view.retryAtMs === null
      ? "Retrying automatically."
      : `Retrying ${retryLabel(view.retryAtMs)}.`;
  return `${providerName} usage limit reached. ${retry}`;
}

export function ProviderRetryBannerView({
  cancelling,
  onCancel,
  providerName,
  view,
}: {
  cancelling: boolean;
  onCancel: () => void | Promise<void>;
  /** The provider's display name from the host's directory; falls back to the id. */
  providerName: string;
  view: ProviderRetryView;
}) {
  return (
    <section
      aria-label="Provider usage recovery"
      className="grid grid-cols-[0.875rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-foreground"
    >
      <Icon name="Clock" className="size-3.5 text-warning-text" aria-hidden />
      <p className="min-w-0 leading-5">{description(view, providerName)}</p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        disabled={cancelling}
        onClick={() => void onCancel()}
      >
        Cancel
      </Button>
    </section>
  );
}
