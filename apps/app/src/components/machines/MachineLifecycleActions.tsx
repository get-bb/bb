import type { Host } from "@bb/domain";
import type { SystemMachineProvider } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";

export interface MachineLifecycleAction {
  icon: IconName;
  label: string;
  kind: "suspend" | "resume" | "retry-cleanup";
}

export function machineLifecycleAction(
  host: Host,
  machineProvider: SystemMachineProvider | null,
): MachineLifecycleAction | null {
  if (machineProvider?.supportsSuspend && host.lifecycle.phase === "active")
    return { icon: "Pause", label: "Suspend", kind: "suspend" };
  if (machineProvider?.supportsSuspend && host.lifecycle.phase === "suspended")
    return { icon: "Play", label: "Resume", kind: "resume" };
  if (
    host.lifecycle.phase === "removing" &&
    host.lifecycle.teardown?.status === "failed"
  )
    return { icon: "RotateCcw", label: "Retry cleanup", kind: "retry-cleanup" };
  return null;
}

interface MachineLifecycleActionsProps {
  host: Host;
  machineProvider: SystemMachineProvider | null;
  pending: boolean;
  onSuspend: () => void;
  onResume: () => void;
  onRetryCleanup: () => void;
}

export function MachineLifecycleActions({
  host,
  machineProvider,
  pending,
  onSuspend,
  onResume,
  onRetryCleanup,
}: MachineLifecycleActionsProps) {
  const action = machineLifecycleAction(host, machineProvider);
  if (action === null) return null;
  const onSelect =
    action.kind === "suspend"
      ? onSuspend
      : action.kind === "resume"
        ? onResume
        : onRetryCleanup;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={onSelect}
    >
      <Icon name={action.icon} className="size-3.5" aria-hidden />
      {action.label}
    </Button>
  );
}
