import { useEffect } from "react";
import type { Host } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { MachineLaunchCommand } from "@/components/dialogs/AddMachineDialog";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { useReconnectHost } from "@/hooks/mutations/host-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export function MachineReconnectDialog({
  target,
  onOpenChange,
}: {
  target: Host | null;
  onOpenChange: (open: boolean) => void;
}) {
  const reconnectHost = useReconnectHost();
  const hostId = target?.id ?? null;
  const { mutate, reset } = reconnectHost;
  useEffect(() => {
    if (hostId === null) {
      reset();
      return;
    }
    mutate(hostId);
  }, [hostId, mutate, reset]);

  const prepared = reconnectHost.data ?? null;
  const reconnected = target !== null && target.status === "connected";
  const errorMessage = reconnectHost.isError
    ? getMutationErrorMessage({
        error: reconnectHost.error,
        fallbackMessage: "Couldn't prepare a reconnect command.",
      })
    : null;

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Reconnect machine</DialogTitle>
          <DialogDescription
            className={
              errorMessage === null ? undefined : "text-destructive-text"
            }
          >
            {errorMessage ??
              `Run this command on ${target?.name ?? "the machine"} to bring it back online. It keeps the machine's projects, environments and history.`}
          </DialogDescription>
        </DialogHeader>
        {errorMessage === null ? null : (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (hostId !== null) mutate(hostId);
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {prepared === null ? null : (
          <MachineLaunchCommand
            key={prepared.command}
            command={prepared.command}
            expiresAt={prepared.expiresAt}
            onRegenerate={() => {
              if (hostId !== null) mutate(hostId);
            }}
          />
        )}
        {errorMessage === null ? (
          <div className="flex items-center gap-2.5 rounded-md bg-muted/40 px-3 py-2.5">
            {reconnected ? (
              <>
                <MachineStatusDot connected />
                <span
                  role="status"
                  className="min-w-0 flex-1 truncate text-sm text-foreground"
                >
                  {target?.name} reconnected
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => onOpenChange(false)}
                >
                  Done
                </Button>
              </>
            ) : (
              <>
                <Icon
                  name="Spinner"
                  className="size-4 shrink-0 animate-spin text-muted-foreground"
                />
                <span role="status" className="text-sm text-muted-foreground">
                  {prepared === null
                    ? "Preparing a reconnect command…"
                    : "Waiting for the machine to reconnect…"}
                </span>
              </>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
