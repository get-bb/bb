import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { useHosts } from "@/hooks/queries/host-queries";
import type { TerminalFixedPanelTarget } from "@/lib/fixed-panel-tabs-state";

interface PluginPageTerminalTargetDialogProps {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (target: TerminalFixedPanelTarget) => void;
}

/**
 * A generic plugin page has no thread or environment to infer a terminal from.
 * Keep that policy in BB: the user explicitly chooses a connected machine and
 * the panel creates a host-scoped shell there.
 */
export function PluginPageTerminalTargetDialog({
  open,
  pending,
  onOpenChange,
  onSelect,
}: PluginPageTerminalTargetDialogProps) {
  const hostsQuery = useHosts({ enabled: open });
  const hosts = hostsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start terminal</DialogTitle>
          <DialogDescription>
            Choose the machine where BB should start the shell.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-1">
          {hostsQuery.isLoading ? (
            <p className="py-4 text-sm text-muted-foreground">
              Loading machines…
            </p>
          ) : hosts.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No machines are available.
            </p>
          ) : (
            hosts.map((host) => {
              const connected = host.status === "connected";
              return (
                <Button
                  key={host.id}
                  type="button"
                  variant="ghost"
                  disabled={!connected || pending}
                  className="h-auto min-w-0 justify-start gap-2 px-3 py-2.5"
                  onClick={() =>
                    onSelect({
                      kind: "host_path",
                      hostId: host.id,
                      cwd: null,
                    })
                  }
                >
                  <MachineStatusDot connected={connected} />
                  <Icon name="Laptop" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {host.name}
                  </span>
                  {!connected ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Offline
                    </span>
                  ) : null}
                </Button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
