import type { Host } from "@bb/domain";
import type { SystemMachineProvider } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { DropdownMenuItem } from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";

interface MachineLifecycleActionsProps {
  host: Host;
  machineProvider: SystemMachineProvider | null;
  pending: boolean;
  presentation: "buttons" | "menu";
  onSuspend: () => void;
  onResume: () => void;
  onRetryCleanup: () => void;
}

export function MachineLifecycleActions({
  host,
  machineProvider,
  pending,
  presentation,
  onSuspend,
  onResume,
  onRetryCleanup,
}: MachineLifecycleActionsProps) {
  let action: {
    icon: IconName;
    label: string;
    onSelect: () => void;
  } | null = null;

  if (machineProvider?.supportsSuspend && host.lifecycle.phase === "active") {
    action = { icon: "Pause", label: "Suspend", onSelect: onSuspend };
  } else if (
    machineProvider?.supportsSuspend &&
    host.lifecycle.phase === "suspended"
  ) {
    action = { icon: "Play", label: "Resume", onSelect: onResume };
  } else if (
    host.lifecycle.phase === "removing" &&
    host.lifecycle.teardown?.status === "failed"
  ) {
    action = {
      icon: "RotateCcw",
      label: "Retry cleanup",
      onSelect: onRetryCleanup,
    };
  }

  if (action === null) return null;

  if (presentation === "menu") {
    return (
      <DropdownMenuItem
        className="min-h-9 px-2.5 py-2"
        disabled={pending}
        onSelect={action.onSelect}
      >
        <Icon name={action.icon} aria-hidden />
        <span className="min-w-0 truncate">{action.label}</span>
      </DropdownMenuItem>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={action.onSelect}
    >
      <Icon name={action.icon} className="size-3.5" aria-hidden />
      {action.label}
    </Button>
  );
}
