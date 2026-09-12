import { useMemo, useRef, useState } from "react";
import type { Host } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@bb/shared-ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { selectHosts, selectPrimaryHost } from "@/hooks/queries/host-queries";
import { formatRelativeTime } from "@/lib/relative-time";
import { cn } from "@bb/shared-ui/lib/utils";
import { formatHostUpdateStatus } from "@/lib/host-update-status";
import {
  MachineLabel,
  type MachineLabelHost,
} from "@/components/machines/MachineLabel";
import type { MachineProviderPresentation } from "@/components/plugin/MachineProviderIcon";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import {
  MACHINE_SEARCH_MIN_OPTIONS,
  searchMachineHosts,
} from "./machine-picker-search";
import { useResetPickerScroll } from "./useResetPickerScroll";

const MACHINE_BADGE_CLASS_NAME =
  "shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground";

interface MachinePickerUIProps {
  hosts: readonly Host[];
  localDaemonHostId: string | null;
  primaryHostId: string | null;
  selectedHostId: string | null;
  onChange: (hostId: string) => void;
  muted?: boolean;
  disabled?: boolean;
  className?: string;
  modal?: boolean;
  machineProviders?: readonly MachineProviderPresentation[];
  multiMachinePickerEnabled?: boolean;
}

export function MachinePickerUI({
  hosts,
  localDaemonHostId,
  primaryHostId,
  selectedHostId,
  onChange,
  muted,
  disabled = false,
  className,
  modal = true,
  machineProviders = [],
  multiMachinePickerEnabled = false,
}: MachinePickerUIProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const commandRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useResetPickerScroll<HTMLDivElement>(searchQuery);
  const availableHosts = useMemo(() => selectHosts(hosts, "all"), [hosts]);
  const selectedHost = useMemo(
    () =>
      availableHosts.find((host) => host.id === selectedHostId) ??
      selectPrimaryHost(availableHosts, primaryHostId),
    [availableHosts, primaryHostId, selectedHostId],
  );
  const orderedHosts = useMemo(
    () =>
      [...availableHosts].sort(
        (left, right) =>
          Number(left.id !== localDaemonHostId) -
          Number(right.id !== localDaemonHostId),
      ),
    [availableHosts, localDaemonHostId],
  );
  const showSearch =
    multiMachinePickerEnabled &&
    availableHosts.length > MACHINE_SEARCH_MIN_OPTIONS;
  const filteredHosts = useMemo(
    () =>
      showSearch ? searchMachineHosts(orderedHosts, searchQuery) : orderedHosts,
    [orderedHosts, searchQuery, showSearch],
  );
  const now = Date.now();
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery("");
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={modal}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Machine"
          disabled={disabled}
          data-promptbox-shrinkable-control=""
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
            {selectedHost == null ? (
              <span className="min-w-0 truncate">Machine</span>
            ) : (
              <MachineLabel
                host={selectedHost}
                machineProvider={findMachineProvider(
                  selectedHost,
                  machineProviders,
                )}
                iconClassName={COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS}
              />
            )}
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
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Machine"
        mobileTitle="Machine"
        autoFocusRef={showSearch ? searchInputRef : commandRef}
        className="flex max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-0.5rem))] w-72 flex-col overflow-hidden p-0 max-md:min-h-0 max-md:w-full max-md:flex-1"
      >
        <Command
          ref={commandRef}
          label="Search machines"
          shouldFilter={false}
          className="min-h-0"
        >
          {showSearch ? (
            <CommandInput
              ref={searchInputRef}
              aria-label="Search machines"
              placeholder="Search machines"
              value={searchQuery}
              onValueChange={setSearchQuery}
              className="h-8 text-xs"
            />
          ) : null}
          <CommandList
            ref={listRef}
            className="min-h-0 max-h-none flex-1 overscroll-contain"
          >
            <CommandGroup>
              {filteredHosts.map((host) => {
                const connected = host.status === "connected";
                return (
                  <CommandItem
                    key={host.id}
                    value={host.id}
                    disabled={!connected}
                    aria-current={
                      host.id === selectedHost?.id ? "true" : undefined
                    }
                    onSelect={() => {
                      if (!connected) return;
                      onChange(host.id);
                      handleOpenChange(false);
                    }}
                    className={cn(
                      "flex items-center justify-between gap-3 py-[0.3125rem] text-xs max-md:py-2",
                      LIST_HOVER_TRANSITION,
                    )}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <MachineStatusDot connected={connected} />
                      <MachineLabel
                        host={host}
                        machineProvider={findMachineProvider(
                          host,
                          machineProviders,
                        )}
                        iconClassName="size-3"
                        nameClassName="text-xs"
                      />
                      {host.id === localDaemonHostId ? (
                        <span className={MACHINE_BADGE_CLASS_NAME}>
                          this machine
                        </span>
                      ) : null}
                    </span>
                    {formatHostUpdateStatus(host) !== null ? (
                      <span className="shrink-0 text-2xs text-warning-foreground">
                        {formatHostUpdateStatus(host)}
                      </span>
                    ) : !connected && host.lastSeenAt !== null ? (
                      <span className="shrink-0 text-2xs text-muted-foreground">
                        last seen{" "}
                        {formatRelativeTime({
                          timestamp: host.lastSeenAt,
                          now,
                        })}
                      </span>
                    ) : null}
                    <Icon
                      name="Check"
                      className={cn(
                        COARSE_POINTER_ICON_SIZE_CLASS,
                        "shrink-0",
                        host.id === selectedHost?.id
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
              {showSearch && filteredHosts.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground max-md:py-2">
                  No machines found
                </div>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function findMachineProvider(
  host: MachineLabelHost,
  machineProviders: readonly MachineProviderPresentation[],
): MachineProviderPresentation | null {
  if (host.machineProviderId === null) return null;
  return (
    machineProviders.find(
      (provider) => provider.id === host.machineProviderId,
    ) ?? null
  );
}
