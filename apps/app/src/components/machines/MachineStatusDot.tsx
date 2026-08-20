import { cn } from "@bb/shared-ui/lib/utils";

/**
 * Connection-status dot for a machine (host): filled success dot when the
 * daemon is connected, hollow ring when offline. Shared by the environment
 * picker's machine menu, Settings → Machines, and project source rows.
 */
export function MachineStatusDot({
  connected,
  className,
}: {
  connected: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        connected ? "bg-success" : "border border-muted-foreground",
        className,
      )}
    />
  );
}
