import type {
  ProviderUsage,
  ProviderUsageWindow,
} from "@bb/host-daemon-contract";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/ui/settings-section";
import { useSystemUsageLimits } from "@/hooks/queries/system-queries";
import { cn } from "@/lib/utils";

interface ProviderConfig {
  key: "codex" | "claudeCode";
  name: string;
  signInHint: string;
  expiredHint: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    key: "codex",
    name: "Codex",
    signInHint: "Run `codex` to sign in and see your usage.",
    expiredHint: "Your Codex session expired. Run `codex`, then refresh.",
  },
  {
    key: "claudeCode",
    name: "Claude Code",
    signInHint: "Run `claude` to sign in and see your usage.",
    expiredHint: "Your Claude session expired. Run `claude`, then refresh.",
  },
];

function barColorClass(usedPercent: number): string {
  if (usedPercent >= 95) {
    return "bg-destructive";
  }
  if (usedPercent >= 80) {
    return "bg-warning";
  }
  return "bg-primary";
}

function formatReset(resetsAt: string | null): string | null {
  if (!resetsAt) {
    return null;
  }
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) {
    return null;
  }
  const diffMs = reset.getTime() - Date.now();
  if (diffMs <= 0) {
    return "Resetting now";
  }

  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) {
    return `Resets in ${diffMinutes} min`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    const minutes = diffMinutes % 60;
    return minutes > 0
      ? `Resets in ${diffHours} hr ${minutes} min`
      : `Resets in ${diffHours} hr`;
  }

  const withinWeek = diffMs < 7 * 24 * 60 * 60_000;
  const formatted = reset.toLocaleString(undefined, {
    weekday: withinWeek ? "short" : undefined,
    month: withinWeek ? undefined : "short",
    day: withinWeek ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Resets ${formatted}`;
}

function UsageWindowRow({ window }: { window: ProviderUsageWindow }) {
  const reset = formatReset(window.resetsAt);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{window.label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {window.usedPercent}% used
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            barColorClass(window.usedPercent),
          )}
          style={{ width: `${Math.max(window.usedPercent, 2)}%` }}
        />
      </div>
      {reset ? <p className="text-xs text-muted-foreground">{reset}</p> : null}
    </div>
  );
}

interface ProviderUsageBlockProps {
  config: ProviderConfig;
  usage: ProviderUsage | undefined;
  isLoading: boolean;
  isError: boolean;
}

function ProviderUsageBlock({
  config,
  usage,
  isLoading,
  isError,
}: ProviderUsageBlockProps) {
  const planLabel = usage?.status === "ok" ? usage.planLabel : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{config.name}</h3>
        {planLabel ? (
          <span className="text-xs text-muted-foreground">{planLabel}</span>
        ) : null}
      </div>
      <ProviderUsageBody
        config={config}
        usage={usage}
        isLoading={isLoading}
        isError={isError}
      />
    </div>
  );
}

function ProviderUsageBody({
  config,
  usage,
  isLoading,
  isError,
}: ProviderUsageBlockProps) {
  if (isError) {
    return (
      <p className="text-xs text-muted-foreground">
        Couldn&apos;t load usage right now. Make sure bb&apos;s host is
        connected, then refresh.
      </p>
    );
  }
  if (!usage) {
    return (
      <p className="text-xs text-muted-foreground">
        {isLoading ? "Loading usage…" : "Usage unavailable."}
      </p>
    );
  }
  switch (usage.status) {
    case "ok":
      if (usage.windows.length === 0) {
        return (
          <p className="text-xs text-muted-foreground">
            No usage limits reported for this plan.
          </p>
        );
      }
      return (
        <div className="space-y-3">
          {usage.windows.map((window) => (
            <UsageWindowRow key={window.label} window={window} />
          ))}
        </div>
      );
    case "unauthenticated":
      return (
        <p className="text-xs text-muted-foreground">{config.signInHint}</p>
      );
    case "expired":
      return (
        <p className="text-xs text-muted-foreground">{config.expiredHint}</p>
      );
    case "error":
      return <p className="text-xs text-muted-foreground">{usage.message}</p>;
    default:
      return null;
  }
}

export function UsageLimitsSettingsSection() {
  const usageQuery = useSystemUsageLimits();

  return (
    <SettingsSection
      title="Usage limits"
      description="Your Codex and Claude Code subscription usage."
      action={
        <Button
          variant="outline"
          size="sm"
          disabled={usageQuery.isFetching}
          onClick={() => {
            void usageQuery.refetch();
          }}
        >
          {usageQuery.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
      <div className="divide-y divide-border">
        {PROVIDERS.map((config) => (
          <div key={config.key} className="py-3 first:pt-0 last:pb-0">
            <ProviderUsageBlock
              config={config}
              usage={usageQuery.data?.[config.key]}
              isLoading={usageQuery.isLoading}
              isError={usageQuery.isError}
            />
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
