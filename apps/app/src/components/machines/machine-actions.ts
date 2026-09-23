import type { Host } from "@bb/domain";
import type { SystemMachineProvider } from "@bb/server-contract";
import { RETRY_ACTION_ICON } from "@bb/domain/update-state";
import type { ResourceOverflowMenuItem } from "@bb/shared-ui/resource-list";
import { serverMachineRemoveDisabledReason } from "@/components/machines/MachineRemoveDialog";
import { machineLifecycleAction } from "@/components/machines/MachineLifecycleActions";
import { canReconnectMachine } from "@/components/machines/machine-status";
import { hostCanRetryUpdate } from "@/lib/host-update-status";

export type MachineActionId =
  | "rename"
  | "reconnect"
  | "retry-update"
  | "lifecycle"
  | "move-server"
  | "remove";

export type MachineAction = Extract<
  ResourceOverflowMenuItem,
  { onSelect: () => void }
> & { id: MachineActionId };

export interface MachineActionsArgs {
  host: Host;
  machineProvider: SystemMachineProvider | null;
  isPrimary: boolean;
  canMoveServerHere: boolean;
  serverMoveEnabled?: boolean;
  lifecycleActionPending?: boolean;
  retryUpdatePending?: boolean;
  onRename: () => void;
  onReconnect: () => void;
  onRetryUpdate?: () => void;
  onSuspend?: () => void;
  onResume?: () => void;
  onRetryCleanup?: () => void;
  onMoveServerHere: () => void;
  onRemove?: () => void;
}

export function machineActions(args: MachineActionsArgs): MachineAction[] {
  const actions: MachineAction[] = [
    { id: "rename", label: "Rename", icon: "Edit", onSelect: args.onRename },
  ];

  if (canReconnectMachine(args.host))
    actions.push({
      id: "reconnect",
      label: "Reconnect machine",
      icon: "Plug02",
      onSelect: args.onReconnect,
    });

  const onRetryUpdate = args.onRetryUpdate;
  if (onRetryUpdate !== undefined && hostCanRetryUpdate(args.host))
    actions.push({
      id: "retry-update",
      label:
        (args.retryUpdatePending ?? false)
          ? "Retrying update…"
          : "Retry update",
      icon: RETRY_ACTION_ICON,
      disabled: args.retryUpdatePending ?? false,
      onSelect: onRetryUpdate,
    });

  const lifecycle = machineLifecycleAction(args.host, args.machineProvider);
  const onLifecycle =
    lifecycle === null
      ? undefined
      : lifecycle.kind === "suspend"
        ? args.onSuspend
        : lifecycle.kind === "resume"
          ? args.onResume
          : args.onRetryCleanup;
  if (lifecycle !== null && onLifecycle !== undefined)
    actions.push({
      id: "lifecycle",
      label: lifecycle.label,
      icon: lifecycle.icon,
      disabled: args.lifecycleActionPending ?? false,
      onSelect: onLifecycle,
    });

  if (args.canMoveServerHere)
    actions.push({
      id: "move-server",
      label: "Move server here",
      icon: "MoveTo",
      onSelect: args.onMoveServerHere,
    });

  const onRemove = args.onRemove;
  if (onRemove !== undefined)
    actions.push({
      id: "remove",
      label: "Remove machine",
      icon: "Trash2",
      tone: "destructive",
      ...(args.isPrimary
        ? {
            disabled: true,
            disabledReason: serverMachineRemoveDisabledReason(
              args.serverMoveEnabled ?? false,
            ),
          }
        : {}),
      onSelect: onRemove,
    });

  return actions;
}
