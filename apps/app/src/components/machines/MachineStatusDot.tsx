import { cn } from "@bb/shared-ui/lib/utils";
import type { MachineStatusTone } from "./machine-status";

export function MachineStatusDot({
  connected,
  tone,
  className,
}: {
  connected?: boolean;
  tone?: MachineStatusTone;
  className?: string;
}) {
  const resolved: MachineStatusTone =
    tone ?? (connected === true ? "online" : "offline");
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        resolved === "online" && "bg-success",
        resolved === "attention" && "bg-attention",
        resolved === "failed" && "bg-destructive",
        resolved === "offline" && "border border-muted-foreground",
        className,
      )}
    />
  );
}
