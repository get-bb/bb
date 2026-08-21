import { useMemo } from "react";
import type { Host } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { selectPrimaryHost } from "@/hooks/queries/host-queries";
import { formatRelativeTime } from "@/lib/relative-time";
import { cn } from "@bb/shared-ui/lib/utils";
import { formatHostUpdateStatus } from "@/lib/host-update-status";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MENU_CONTENT_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";

const MACHINE_BADGE_CLASS_NAME =
  "shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground";

interface MachinePickerUIProps {
  /** All hosts known to the server, in server order. */
  hosts: readonly Host[];
  /** Host id of the daemon running on this browser's machine, if reachable —
   * its row gets the "this machine" badge and leads the menu. */
  localDaemonHostId: string | null;
  /** Server-resolved primary host id from `/system/config`; null while it
   * loads or before any host has enrolled. */
  primaryHostId: string | null;
  /** Selected host id; an unknown or null id falls back to the primary host. */
  selectedHostId: string | null;
  onChange: (hostId: string) => void;
  /** Render with the dim, hover-to-foreground treatment used inside the prompt box. */
  muted?: boolean;
  disabled?: boolean;
  className?: string;
  /** Whether the menu blocks page interaction. Defaults to Radix's true; pass false in stories/tests. */
  modal?: boolean;
}

/**
 * Machine chip for projectless threads (>1 host):
 * picks which machine's personal workspace the thread runs in. There are no
 * worktree/checkout options — the mode is implicit, so the chip is just the
 * machine name.
 */
export function MachinePickerUI({
  hosts,
  localDaemonHostId,
  primaryHostId,
  selectedHostId,
  onChange,
  muted,
  disabled = false,
  className,
  modal,
}: MachinePickerUIProps) {
  const selectedHost = useMemo(
    () =>
      hosts.find((host) => host.id === selectedHostId) ??
      selectPrimaryHost(hosts, primaryHostId),
    [hosts, primaryHostId, selectedHostId],
  );
  // This machine leads; the rest keep server order (stable sort).
  const orderedHosts = useMemo(
    () =>
      [...hosts].sort(
        (left, right) =>
          Number(left.id !== localDaemonHostId) -
          Number(right.id !== localDaemonHostId),
      ),
    [hosts, localDaemonHostId],
  );
  const now = Date.now();

  return (
    <DropdownMenu modal={modal}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Machine"
          disabled={disabled}
          data-promptbox-icon-only-control=""
          className={cn(
            OPTION_BASE_CLASS_NAME,
            !disabled && OPTION_INTERACTIVE_CLASS_NAME,
            !disabled && LIST_HOVER_TRANSITION,
            muted && OPTION_MUTED_CLASS_NAME,
            disabled && "cursor-default disabled:opacity-100",
            className,
          )}
        >
          <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME}>
            <Icon
              name="Laptop"
              className={COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS}
            />
            <span className="min-w-0 truncate">
              {selectedHost?.name ?? "Machine"}
            </span>
          </span>
          {disabled ? null : (
            <Icon
              name="ChevronDown"
              className={cn(
                "shrink-0 text-muted-foreground",
                COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
              )}
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn(OPTION_MENU_CONTENT_CLASS_NAME, "max-w-80")}
        mobileTitle="Machine"
      >
        {orderedHosts.map((host) => {
          const connected = host.status === "connected";
          return (
            <DropdownMenuItem
              key={host.id}
              disabled={!connected}
              onSelect={() => {
                if (!connected) return;
                onChange(host.id);
              }}
              className={cn(
                "flex items-center justify-between gap-3",
                LIST_HOVER_TRANSITION,
              )}
            >
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <MachineStatusDot connected={connected} />
                <span className="min-w-0 truncate text-xs">{host.name}</span>
                {host.id === localDaemonHostId ? (
                  <span className={MACHINE_BADGE_CLASS_NAME}>this machine</span>
                ) : null}
              </span>
              {formatHostUpdateStatus(host) !== null ? (
                <span className="shrink-0 text-2xs text-warning-foreground">
                  {formatHostUpdateStatus(host)}
                </span>
              ) : !connected && host.lastSeenAt !== null ? (
                <span className="shrink-0 text-2xs text-muted-foreground">
                  last seen{" "}
                  {formatRelativeTime({ timestamp: host.lastSeenAt, now })}
                </span>
              ) : null}
              <Icon
                name="Check"
                className={cn(
                  COARSE_POINTER_ICON_SIZE_CLASS,
                  "shrink-0",
                  host.id === selectedHost?.id ? "opacity-100" : "opacity-0",
                )}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
