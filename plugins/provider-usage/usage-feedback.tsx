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
  className,
}: {
  message: string;
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
    </div>
  );
}
