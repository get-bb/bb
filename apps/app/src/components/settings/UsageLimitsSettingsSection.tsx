import type {
  ProviderUsage,
  ProviderUsageWindow,
} from "@bb/host-daemon-contract";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { SettingsSection } from "@/components/ui/settings-section";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    expiredHint: "Your Codex session expired. Run `codex`, then reload usage.",
  },
  {
    key: "claudeCode",
    name: "Claude Code",
    signInHint: "Run `claude` to sign in and see your usage.",
    expiredHint:
      "Your Claude session expired. Run `claude`, then reload usage.",
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
        <span className="text-xs text-foreground">{window.label}</span>
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

export interface UsageLimitsSettingsSectionContentProps {
  usage: {
    codex?: ProviderUsage;
    claudeCode?: ProviderUsage;
  };
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  onRefresh: () => void;
}

function ProviderUsageBlock({
  config,
  usage,
  isLoading,
  isError,
}: ProviderUsageBlockProps) {
  const planLabel = usage?.status === "ok" ? usage.planLabel : null;

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-normal text-foreground">{config.name}</h3>
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
        connected, then reload usage.
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
        <div className="space-y-3.5">
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

export function UsageLimitsSettingsSectionContent({
  usage,
  isLoading,
  isError,
  isFetching,
  onRefresh,
}: UsageLimitsSettingsSectionContentProps) {
  return (
    <SettingsSection
      title="Usage limits"
      description="Your Codex and Claude Code subscription usage."
      action={
        <Tooltip delayDuration={300} disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              disabled={isFetching}
              onClick={onRefresh}
              title={undefined}
              aria-label={
                isFetching
                  ? "Reloading usage data"
                  : "Reload usage data"
              }
            >
              <Icon
                name="RotateCcw"
                className={cn("size-3.5", isFetching && "animate-spin")}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Reload usage data</TooltipContent>
        </Tooltip>
      }
    >
      <div className="divide-y divide-border">
        {PROVIDERS.map((config) => (
          <div key={config.key} className="py-3.5 first:pt-0 last:pb-0">
            <ProviderUsageBlock
              config={config}
              usage={usage[config.key]}
              isLoading={isLoading}
              isError={isError}
            />
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

export function UsageLimitsSettingsSection() {
  const usageQuery = useSystemUsageLimits();

  return (
    <UsageLimitsSettingsSectionContent
      usage={usageQuery.data ?? {}}
      isLoading={usageQuery.isLoading}
      isError={usageQuery.isError}
      isFetching={usageQuery.isFetching}
      onRefresh={() => {
        void usageQuery.refetch();
      }}
    />
  );
}
