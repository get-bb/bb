import { cn } from "@bb/shared-ui/lib/utils";
import type { UsageMachine, UsageProvider } from "./usage-schema.js";

export const usageFeedbackMessages = {
  loading: "Loading usage…",
  noSources: "No usage sources available.",
  loadFailed: "Couldn’t load usage.",
  refreshFailed: "Couldn’t refresh usage. Showing the last available update.",
  unavailable: "Usage unavailable.",
} as const;

export function hasReportedUsage(providers: readonly UsageProvider[]): boolean {
  return providers.some((provider) => provider.usage !== null);
}

export function emptyUsageMessage(machine: UsageMachine): string {
  return machine.id.startsWith("source:")
    ? "No accounts report usage yet. Configure accounts in the source plugin’s settings."
    : "No providers report usage limits on this machine.";
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
  retrying = false,
  onRetry,
  className,
}: {
  message: string;
  retrying?: boolean;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-w-0 items-start gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry ? (
        <button
          type="button"
          aria-label="Retry usage refresh"
          disabled={retrying}
          className="shrink-0 rounded-sm px-1 py-0.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
