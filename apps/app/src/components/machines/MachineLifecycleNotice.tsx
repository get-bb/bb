import type { MachineLifecycle } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";

export type MachineLifecycleNoticeState = Pick<MachineLifecycle, "phase"> & {
  message: string | null;
};

export function MachineLifecycleNoticeContent({
  notice,
}: {
  notice: MachineLifecycleNoticeState | null;
}) {
  if (notice === null || notice.message === null) return null;
  return (
    <p
      role="status"
      aria-label="Machine maintenance"
      className={cn(
        "min-w-0 text-xs",
        notice.phase === "suspending"
          ? "text-subtle-foreground"
          : "text-destructive-text",
      )}
    >
      {notice.message}
    </p>
  );
}
