import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { UsageMachine, UsageProvider } from "./usage-schema.js";

export const usageFeedbackMessages = {
  loading: "Loading usage…",
  noSources: "No usage sources available.",
  noSourcesEnabled:
    "No usage source is enabled. Enable a plugin that publishes usage limits, such as Codex, Claude Code, or Account Pooler.",
  noProviderUsage:
    "No provider on this machine reports usage limits. Providers that never publish usage are omitted from this list.",
  loadFailed: "Couldn’t load usage.",
  refreshFailed: "Couldn’t refresh usage. Showing the last available update.",
  unavailable: "Usage unavailable.",
} as const;

export function hasReportedUsage(providers: readonly UsageProvider[]): boolean {
  return providers.some((provider) => provider.usage !== null);
}

export function emptyUsageMessage(
  machine: UsageMachine,
  hasUsageSources: boolean,
): string {
  if (machine.id.startsWith("source:")) {
    return "No accounts report usage yet. Configure accounts in the source plugin’s settings.";
  }
  return hasUsageSources
    ? usageFeedbackMessages.noProviderUsage
    : usageFeedbackMessages.noSourcesEnabled;
}

export function offlineUsageMessage(
  machine: UsageMachine,
  hasUsage: boolean,
): string {
  return hasUsage
    ? `${machine.displayName} is offline. Showing the last available update.`
    : `${machine.displayName} is offline. Usage will refresh when it reconnects.`;
}

export function UsageFeedback({
  message,
  loading = false,
  className,
}: {
  message: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-w-0 items-start text-xs text-muted-foreground",
        !loading && "gap-2 rounded-md bg-muted/60 px-2.5 py-2",
        className,
      )}
    >
      {loading ? null : (
        <Icon
          name="Info"
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0"
        />
      )}
      <span className="min-w-0 flex-1">{message}</span>
    </div>
  );
}
