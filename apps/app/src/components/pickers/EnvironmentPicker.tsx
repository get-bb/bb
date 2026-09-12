import { EnvironmentProviderIcon } from "@/components/plugin/EnvironmentProviderIcon";
import { useMemo, useRef, useState } from "react";
import type { Host, ProjectSource } from "@bb/domain";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { findLocalPathProjectSourceForHost } from "@bb/domain";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { Button } from "@bb/shared-ui/button";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@bb/shared-ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { REUSE_ENVIRONMENT_ICON_NAME } from "@/lib/environment-workspace-display";
import { formatRelativeTime } from "@/lib/relative-time";
import { formatHostUpdateStatus } from "@/lib/host-update-status";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import {
  encodeProviderValue,
  parseEnvironmentValue,
} from "./environment-picker-value";
import { selectHosts } from "@/hooks/queries/host-queries";
import { providerInputsControlRequired } from "./environment-provider-inputs";
import { MachineLabel } from "@/components/machines/MachineLabel";
import { searchMachineHosts } from "./machine-picker-search";
import { useResetPickerScroll } from "./useResetPickerScroll";

interface SelectedEnvironment {
  modeLabel: string;
  compactModeLabel: string;
  icon: IconName;
}

const MACHINE_CONTEXTUAL_MENU_MIN_OPTIONS = 3;

export interface EnvironmentPickerMachines {
  hosts: readonly Host[];
  localDaemonHostId: string | null;
  primaryHostId: string | null;
}

export interface EnvironmentPickerUIProps {
  value: string;
  sources: readonly ProjectSource[];
  host: Host | null;
  isLocal: boolean;
  muted?: boolean;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  modal?: boolean;
  machines?: EnvironmentPickerMachines | null;
  onRequestMachineSetup?: (host: Host) => void;
  providers?: readonly SystemEnvironmentProvider[];
  projectless?: boolean;
  providersByHostId?: ReadonlyMap<
    string,
    readonly SystemEnvironmentProvider[] | undefined
  >;
  selectedProviderHostId?: string | null;
  inputsControlProviderIds?: ReadonlySet<string>;
  multiMachinePickerEnabled?: boolean;
  onSelectProvider?: (
    provider: SystemEnvironmentProvider,
    hostId: string | null,
  ) => void;
  onSelectHost?: (hostId: string) => void;
}

export const PROVIDER_INPUTS_CONTROL_MISSING_REASON =
  "Needs its plugin's control";

const NO_INPUTS_CONTROL_PROVIDER_IDS: ReadonlySet<string> = new Set();

function providerValueSelected(
  value: string,
  provider: SystemEnvironmentProvider,
): boolean {
  return value === encodeProviderValue(provider.id);
}

function providerDisabledReason(
  provider: SystemEnvironmentProvider,
  inputsControlProviderIds: ReadonlySet<string>,
): string | null {
  if (provider.availability?.status === "unavailable") {
    return provider.availability.message;
  }
  if (
    !inputsControlProviderIds.has(provider.id) &&
    providerInputsControlRequired(provider)
  ) {
    return PROVIDER_INPUTS_CONTROL_MISSING_REASON;
  }
  return null;
}

function providerDescription(
  provider: SystemEnvironmentProvider,
  inputsControlProviderIds: ReadonlySet<string>,
): string | undefined {
  if (provider.availability?.status === "setup-required") {
    return provider.availability.message;
  }
  return (
    providerDisabledReason(provider, inputsControlProviderIds) ?? undefined
  );
}

function scopedProviders(
  providers: readonly SystemEnvironmentProvider[],
  providersByHostId: EnvironmentPickerUIProps["providersByHostId"],
  hostId: string | null,
  selection: { value: string; selectedProviderHostId: string | null },
): readonly SystemEnvironmentProvider[] {
  const hostProviders =
    hostId === null || providersByHostId === undefined
      ? providers
      : mergeHostProviders(providers, providersByHostId.get(hostId) ?? []);
  return hostProviders.filter(
    (provider) =>
      provider.availability?.status !== "unavailable" ||
      (providerValueSelected(selection.value, provider) &&
        selection.selectedProviderHostId === hostId),
  );
}

function mergeHostProviders(
  providers: readonly SystemEnvironmentProvider[],
  resolved: readonly SystemEnvironmentProvider[],
): readonly SystemEnvironmentProvider[] {
  const hostProviders = new Map(
    resolved.map((provider) => [provider.id, provider]),
  );
  return providers.flatMap((provider) => {
    const hostProvider = hostProviders.get(provider.id);
    return hostProvider === undefined ? [] : [hostProvider];
  });
}
export function EnvironmentPickerUI({
  value,
  sources,
  host,
  isLocal,
  muted,
  disabled = false,
  isLoading = false,
  className,
  open,
  onOpenChange,
  defaultOpen,
  modal = false,
  machines,
  onRequestMachineSetup,
  providers = [],
  projectless = false,
  providersByHostId,
  selectedProviderHostId = null,
  inputsControlProviderIds = NO_INPUTS_CONTROL_PROVIDER_IDS,
  multiMachinePickerEnabled = false,
  onSelectProvider,
  onSelectHost,
}: EnvironmentPickerUIProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    defaultOpen ?? false,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [previewHostId, setPreviewHostId] = useState<string | null>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useResetPickerScroll<HTMLDivElement>(searchQuery);
  const availableMachines = useMemo(
    () =>
      machines === null || machines === undefined
        ? null
        : {
            ...machines,
            hosts: selectHosts(machines.hosts, "persistent"),
          },
    [machines],
  );
  const availableHost = host?.type === "ephemeral" ? null : host;
  const hostId = availableHost?.id ?? null;
  const hasMultipleMachines = (availableMachines?.hosts.length ?? 0) > 1;
  const showSearch =
    multiMachinePickerEnabled &&
    hasMultipleMachines &&
    (availableMachines?.hosts.length ?? 0) >=
      MACHINE_CONTEXTUAL_MENU_MIN_OPTIONS;
  const environmentProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          !provider.machineProviderId &&
          provider.requires.projectless === projectless,
      ),
    [projectless, providers],
  );
  const isMachineMenu = hasMultipleMachines;
  const hostConnected = availableHost?.status === "connected";
  const hostUnavailableReason = !availableHost
    ? "No host connected"
    : !hostConnected
      ? "Host is offline"
      : null;
  const parsed = useMemo(() => parseEnvironmentValue(value), [value]);

  const selectedMachineName = useMemo(() => {
    if (!hasMultipleMachines || !availableMachines) return null;
    const machineHostId =
      parsed?.type === "provider" ? selectedProviderHostId : null;
    if (machineHostId === null) return null;
    return (
      availableMachines.hosts.find(
        (machineHost) => machineHost.id === machineHostId,
      )?.name ?? null
    );
  }, [hasMultipleMachines, parsed, availableMachines, selectedProviderHostId]);

  const selectedProvider = useMemo(
    () =>
      parsed?.type === "provider"
        ? providers.find(
            (provider) => provider.id === parsed.environmentProviderId,
          )
        : undefined,
    [providers, parsed],
  );
  const hostlessProviders = providers.filter(
    (provider) =>
      provider.machineProviderId &&
      provider.requires.projectless === projectless,
  );
  const selected = useMemo((): SelectedEnvironment => {
    if (
      selectedProvider !== undefined &&
      (selectedProvider.machineProviderId || hostUnavailableReason === null)
    ) {
      const showsHost =
        !selectedProvider.machineProviderId && selectedMachineName !== null;
      return {
        modeLabel: showsHost
          ? `${selectedMachineName} · ${selectedProvider.displayName}`
          : selectedProvider.displayName,
        compactModeLabel: selectedProvider.displayName,
        icon: pluginIconName(selectedProvider.icon),
      };
    }
    if (hostUnavailableReason !== null) {
      return {
        modeLabel: selectedMachineName
          ? `${selectedMachineName} · ${hostUnavailableReason}`
          : hostUnavailableReason,
        compactModeLabel: availableHost ? "Offline" : "No host",
        icon: "AlertTriangle" as const,
      };
    }
    if (parsed?.type === "reuse") {
      return {
        modeLabel: "Reuse",
        compactModeLabel: "Reuse",
        icon: REUSE_ENVIRONMENT_ICON_NAME,
      };
    }
    return {
      modeLabel: "Environment",
      compactModeLabel: "Env",
      icon: "Laptop" as const,
    };
  }, [
    parsed,
    hostUnavailableReason,
    availableHost,
    selectedMachineName,
    selectedProvider,
  ]);
  const pickerOpen = open ?? uncontrolledOpen;
  const handleOpenChange = (nextOpen: boolean) => {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen) {
      setSearchQuery("");
      setPreviewHostId(null);
    }
  };
  const selectProvider = (
    provider: SystemEnvironmentProvider,
    providerHostId: string | null,
  ) => {
    onSelectProvider?.(provider, providerHostId);
    handleOpenChange(false);
  };
  const requestMachineSetup = (machineHost: Host) => {
    onRequestMachineSetup?.(machineHost);
    handleOpenChange(false);
  };

  return (
    <Popover open={pickerOpen} onOpenChange={handleOpenChange} modal={modal}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Environment"
          aria-busy={isLoading}
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
            {selectedProvider === undefined ? (
              <Icon
                name={isLoading ? "Spinner" : selected.icon}
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                  isLoading && "animate-spin",
                )}
              />
            ) : (
              <EnvironmentProviderIcon
                provider={selectedProvider}
                className={COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS}
              />
            )}
            {isLoading ? (
              <>
                <span className="sr-only">Loading environments</span>
                <Skeleton
                  aria-hidden
                  data-environment-loading-placeholder="trigger"
                  className="h-3 w-20 shrink-0 rounded-sm"
                />
              </>
            ) : (
              <>
                <span className="min-w-0 truncate" data-promptbox-full-label="">
                  {selected.modeLabel}
                </span>
                <span
                  className="min-w-0 truncate"
                  data-promptbox-compact-label=""
                  data-promptbox-hide-tiny=""
                >
                  {selected.compactModeLabel}
                </span>
              </>
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
        aria-label="Environment"
        mobileTitle="Environment"
        autoFocusRef={
          isLoading ? undefined : showSearch ? searchInputRef : commandRef
        }
        className={cn(
          "flex max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-0.5rem))] w-80 flex-col overflow-hidden p-0 max-md:min-h-0 max-md:w-full max-md:flex-1",
          isLoading && "min-w-52",
        )}
      >
        {isLoading ? (
          <EnvironmentPickerLoadingRows />
        ) : (
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
              ref={showSearch ? undefined : listRef}
              className={cn(
                "min-h-0 max-h-none flex-1 overscroll-contain",
                showSearch && "flex flex-col overflow-hidden",
              )}
            >
              {isMachineMenu && availableMachines ? (
                showSearch ? (
                  <MachineContextualEnvironmentOptions
                    machines={availableMachines}
                    sources={sources}
                    selectedHostId={
                      parsed?.type === "provider"
                        ? selectedProviderHostId
                        : hostId
                    }
                    previewHostId={previewHostId}
                    value={value}
                    searchQuery={searchQuery}
                    environmentProviders={environmentProviders}
                    hostlessProviders={hostlessProviders}
                    providersByHostId={providersByHostId}
                    selectedProviderHostId={selectedProviderHostId}
                    inputsControlProviderIds={inputsControlProviderIds}
                    onPreviewHostChange={setPreviewHostId}
                    onSelectHost={onSelectHost}
                    onRequestMachineSetup={
                      onRequestMachineSetup ? requestMachineSetup : undefined
                    }
                    onSelectProvider={
                      onSelectProvider ? selectProvider : undefined
                    }
                  />
                ) : (
                  <>
                    <MachineGroupedEnvironmentOptions
                      machines={availableMachines}
                      sources={sources}
                      value={value}
                      onRequestMachineSetup={
                        onRequestMachineSetup ? requestMachineSetup : undefined
                      }
                      environmentProviders={environmentProviders}
                      providersByHostId={providersByHostId}
                      selectedProviderHostId={selectedProviderHostId}
                      inputsControlProviderIds={inputsControlProviderIds}
                      onSelectProvider={
                        onSelectProvider ? selectProvider : undefined
                      }
                    />
                    <HostlessEnvironmentOptions
                      providers={hostlessProviders}
                      value={value}
                      inputsControlProviderIds={inputsControlProviderIds}
                      onSelectProvider={
                        onSelectProvider ? selectProvider : undefined
                      }
                      separated={environmentProviders.length > 0}
                    />
                  </>
                )
              ) : (
                <>
                  <EnvironmentOptionsSection
                    hostId={hostId}
                    hostName={isLocal ? null : (availableHost?.name ?? null)}
                    hostUnavailableReason={hostUnavailableReason}
                    value={value}
                    environmentProviders={scopedProviders(
                      environmentProviders,
                      providersByHostId,
                      hostId,
                      { value, selectedProviderHostId },
                    )}
                    selectedProviderHostId={selectedProviderHostId}
                    inputsControlProviderIds={inputsControlProviderIds}
                    onSelectProvider={
                      onSelectProvider ? selectProvider : undefined
                    }
                  />
                  <HostlessEnvironmentOptions
                    providers={hostlessProviders}
                    value={value}
                    inputsControlProviderIds={inputsControlProviderIds}
                    onSelectProvider={
                      onSelectProvider ? selectProvider : undefined
                    }
                    separated={environmentProviders.length > 0}
                  />
                </>
              )}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

const ENVIRONMENT_LOADING_ROW_WIDTHS = [
  "w-20",
  "w-28",
  "w-24",
  "w-32",
] as const;

function EnvironmentPickerLoadingRows() {
  const isCompactViewport = useIsCompactViewport();

  return (
    <div role="status" aria-label="Loading environments" className="pb-1">
      <span className="sr-only">Loading environments</span>
      {ENVIRONMENT_LOADING_ROW_WIDTHS.map((widthClassName) => (
        <div
          key={widthClassName}
          data-environment-loading-row=""
          aria-hidden
          className={cn(
            "flex items-center rounded-sm px-2",
            isCompactViewport ? "py-2" : "py-[0.3125rem]",
          )}
        >
          <Skeleton
            className={cn("h-3 max-w-[75%] rounded-sm", widthClassName)}
          />
        </div>
      ))}
    </div>
  );
}

interface HostlessEnvironmentOptionsProps {
  providers: readonly SystemEnvironmentProvider[];
  value: string;
  inputsControlProviderIds: ReadonlySet<string>;
  onSelectProvider:
    | ((provider: SystemEnvironmentProvider, hostId: string | null) => void)
    | undefined;
  separated: boolean;
  heading?: string;
}

function HostlessEnvironmentOptions({
  providers,
  value,
  inputsControlProviderIds,
  onSelectProvider,
  separated,
  heading,
}: HostlessEnvironmentOptionsProps) {
  if (onSelectProvider === undefined || providers.length === 0) return null;

  return (
    <>
      {separated ? <CommandSeparator className="mx-0 shrink-0" /> : null}
      <CommandGroup heading={heading} className="shrink-0">
        {providers.map((provider) => (
          <EnvironmentMenuItem
            key={provider.id}
            value={`provider:any:${provider.id}`}
            label={provider.displayName}
            description={providerDescription(
              provider,
              inputsControlProviderIds,
            )}
            icon={pluginIconName(provider.icon)}
            provider={provider}
            selected={providerValueSelected(value, provider)}
            disabled={
              providerDisabledReason(provider, inputsControlProviderIds) !==
              null
            }
            onSelect={() => onSelectProvider(provider, null)}
          />
        ))}
      </CommandGroup>
    </>
  );
}

interface EnvironmentOptionsSectionProps {
  hostId: string | null;
  hostName: string | null;
  hostUnavailableReason: string | null;
  value: string;
  environmentProviders: readonly SystemEnvironmentProvider[];
  selectedProviderHostId: string | null;
  inputsControlProviderIds: ReadonlySet<string>;
  onSelectProvider:
    | ((provider: SystemEnvironmentProvider, hostId: string | null) => void)
    | undefined;
}

function EnvironmentOptionsSection({
  hostId,
  hostName,
  hostUnavailableReason,
  value,
  environmentProviders,
  selectedProviderHostId,
  inputsControlProviderIds,
  onSelectProvider,
}: EnvironmentOptionsSectionProps) {
  return (
    <CommandGroup heading={hostName ?? undefined}>
      {hostUnavailableReason !== null ? (
        <CommandItem
          value="host-unavailable"
          disabled
          className="whitespace-normal break-words text-xs text-muted-foreground"
        >
          {hostUnavailableReason}
        </CommandItem>
      ) : onSelectProvider !== undefined && hostId !== null ? (
        environmentProviders.map((provider) => {
          const disabledReason = providerDisabledReason(
            provider,
            inputsControlProviderIds,
          );
          return (
            <EnvironmentMenuItem
              key={provider.id}
              value={`provider:${hostId}:${provider.id}`}
              label={provider.displayName}
              description={providerDescription(
                provider,
                inputsControlProviderIds,
              )}
              icon={pluginIconName(provider.icon)}
              provider={provider}
              selected={
                providerValueSelected(value, provider) &&
                selectedProviderHostId === hostId
              }
              disabled={disabledReason !== null}
              onSelect={() => onSelectProvider(provider, hostId)}
            />
          );
        })
      ) : null}
    </CommandGroup>
  );
}

const MACHINE_BADGE_CLASS_NAME =
  "shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground";

interface MachineGroupedEnvironmentOptionsProps {
  machines: EnvironmentPickerMachines;
  sources: readonly ProjectSource[];
  value: string;
  onRequestMachineSetup: ((host: Host) => void) | undefined;
  environmentProviders: readonly SystemEnvironmentProvider[];
  providersByHostId?: EnvironmentPickerUIProps["providersByHostId"];
  selectedProviderHostId: string | null;
  inputsControlProviderIds: ReadonlySet<string>;
  onSelectProvider:
    | ((provider: SystemEnvironmentProvider, hostId: string | null) => void)
    | undefined;
}

function MachineGroupedEnvironmentOptions({
  machines,
  sources,
  value,
  onRequestMachineSetup,
  environmentProviders,
  providersByHostId,
  selectedProviderHostId,
  inputsControlProviderIds,
  onSelectProvider,
}: MachineGroupedEnvironmentOptionsProps) {
  const now = Date.now();
  const orderedHosts = useMemo(
    () =>
      [...machines.hosts].sort(
        (left, right) =>
          Number(left.id !== machines.localDaemonHostId) -
          Number(right.id !== machines.localDaemonHostId),
      ),
    [machines.hosts, machines.localDaemonHostId],
  );
  return (
    <>
      {orderedHosts.map((machineHost) => (
        <MachineSection
          key={machineHost.id}
          host={machineHost}
          isThisMachine={machineHost.id === machines.localDaemonHostId}
          source={
            findLocalPathProjectSourceForHost(sources, machineHost.id) ?? null
          }
          now={now}
          value={value}
          onRequestMachineSetup={onRequestMachineSetup}
          environmentProviders={scopedProviders(
            environmentProviders,
            providersByHostId,
            machineHost.id,
            { value, selectedProviderHostId },
          )}
          selectedProviderHostId={selectedProviderHostId}
          inputsControlProviderIds={inputsControlProviderIds}
          onSelectProvider={onSelectProvider}
        />
      ))}
    </>
  );
}

interface MachineContextualEnvironmentOptionsProps extends MachineGroupedEnvironmentOptionsProps {
  hostlessProviders: readonly SystemEnvironmentProvider[];
  selectedHostId: string | null;
  previewHostId: string | null;
  searchQuery: string;
  onPreviewHostChange: (hostId: string) => void;
  onSelectHost: ((hostId: string) => void) | undefined;
}

function MachineContextualEnvironmentOptions({
  machines,
  sources,
  selectedHostId,
  previewHostId,
  value,
  searchQuery,
  environmentProviders,
  hostlessProviders,
  providersByHostId,
  selectedProviderHostId,
  inputsControlProviderIds,
  onPreviewHostChange,
  onSelectHost,
  onRequestMachineSetup,
  onSelectProvider,
}: MachineContextualEnvironmentOptionsProps) {
  const machineListRef = useResetPickerScroll<HTMLDivElement>(searchQuery);
  const now = Date.now();
  const orderedHosts = useMemo(
    () =>
      [...machines.hosts].sort(
        (left, right) =>
          Number(left.id !== machines.localDaemonHostId) -
          Number(right.id !== machines.localDaemonHostId),
      ),
    [machines.hosts, machines.localDaemonHostId],
  );
  const filteredHosts = useMemo(
    () => searchMachineHosts(orderedHosts, searchQuery),
    [orderedHosts, searchQuery],
  );
  const selectedHostlessProvider = hostlessProviders.find((provider) =>
    providerValueSelected(value, provider),
  );
  const activeHost =
    orderedHosts.find((machineHost) => machineHost.id === previewHostId) ??
    orderedHosts.find((machineHost) => machineHost.id === selectedHostId) ??
    (selectedHostlessProvider === undefined
      ? (orderedHosts.find(
          (machineHost) => machineHost.id === machines.localDaemonHostId,
        ) ??
        orderedHosts.find(
          (machineHost) => machineHost.id === machines.primaryHostId,
        ) ??
        orderedHosts[0])
      : undefined);

  return (
    <>
      <div
        ref={machineListRef}
        data-machine-picker-list=""
        className="max-h-48 min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <CommandGroup heading="Machines">
          {filteredHosts.map((machineHost) => (
            <MachineChoiceItem
              key={machineHost.id}
              host={machineHost}
              isThisMachine={machineHost.id === machines.localDaemonHostId}
              active={machineHost.id === activeHost?.id}
              onSelect={() => {
                onPreviewHostChange(machineHost.id);
                onSelectHost?.(machineHost.id);
              }}
            />
          ))}
          {filteredHosts.length === 0 ? (
            <div className="px-2 py-[0.3125rem] text-xs text-muted-foreground max-md:py-2">
              No machines found
            </div>
          ) : null}
          {onSelectProvider
            ? hostlessProviders.map((provider) => (
                <EnvironmentMenuItem
                  key={provider.id}
                  value={`provider:any:${provider.id}`}
                  label={provider.displayName}
                  description={providerDescription(
                    provider,
                    inputsControlProviderIds,
                  )}
                  icon={pluginIconName(provider.icon)}
                  provider={provider}
                  alignIconWithMachine
                  selected={
                    activeHost === undefined &&
                    providerValueSelected(value, provider)
                  }
                  disabled={
                    providerDisabledReason(
                      provider,
                      inputsControlProviderIds,
                    ) !== null
                  }
                  onSelect={() => onSelectProvider(provider, null)}
                />
              ))
            : null}
        </CommandGroup>
      </div>
      {activeHost ? (
        <>
          <CommandSeparator className="mx-0 shrink-0" />
          <div className="shrink-0">
            <MachineSection
              host={activeHost}
              isThisMachine={activeHost.id === machines.localDaemonHostId}
              source={
                findLocalPathProjectSourceForHost(sources, activeHost.id) ??
                null
              }
              now={now}
              value={value}
              contextual
              onRequestMachineSetup={onRequestMachineSetup}
              environmentProviders={scopedProviders(
                environmentProviders,
                providersByHostId,
                activeHost.id,
                { value, selectedProviderHostId },
              )}
              selectedProviderHostId={selectedProviderHostId}
              inputsControlProviderIds={inputsControlProviderIds}
              onSelectProvider={onSelectProvider}
            />
          </div>
        </>
      ) : null}
    </>
  );
}

interface MachineChoiceItemProps {
  host: Host;
  isThisMachine: boolean;
  active: boolean;
  onSelect: () => void;
}

function MachineChoiceItem({
  host,
  isThisMachine,
  active,
  onSelect,
}: MachineChoiceItemProps) {
  return (
    <CommandItem
      value={`machine:${host.id}`}
      aria-label={host.name}
      aria-current={active ? "true" : undefined}
      onSelect={onSelect}
      className={cn(
        "flex items-center gap-2 py-[0.3125rem] text-xs max-md:py-2",
        LIST_HOVER_TRANSITION,
        active && "font-medium text-foreground",
      )}
    >
      <MachineStatusDot connected={host.status === "connected"} />
      <MachineLabel
        host={host}
        className="flex-1"
        iconClassName="size-3"
        nameClassName="text-xs"
      />
      {isThisMachine ? (
        <span className={MACHINE_BADGE_CLASS_NAME}>this machine</span>
      ) : null}
      <Icon
        name="Check"
        className={cn(
          COARSE_POINTER_ICON_SIZE_CLASS,
          "shrink-0",
          active ? "opacity-100" : "opacity-0",
        )}
      />
    </CommandItem>
  );
}

interface MachineSectionProps {
  host: Host;
  isThisMachine: boolean;
  source: ProjectSource | null;
  now: number;
  value: string;
  onRequestMachineSetup: ((host: Host) => void) | undefined;
  environmentProviders: readonly SystemEnvironmentProvider[];
  selectedProviderHostId: string | null;
  inputsControlProviderIds: ReadonlySet<string>;
  contextual?: boolean;
  onSelectProvider:
    | ((provider: SystemEnvironmentProvider, hostId: string | null) => void)
    | undefined;
}

function MachineSection({
  host,
  isThisMachine,
  source,
  now,
  value,
  onRequestMachineSetup,
  environmentProviders,
  selectedProviderHostId,
  inputsControlProviderIds,
  contextual = false,
  onSelectProvider,
}: MachineSectionProps) {
  const connected = host.status === "connected";
  const hostProviders = environmentProviders;
  const selectable = connected && host.lifecycle.phase === "active";
  const updateStatus = formatHostUpdateStatus(host);
  const statusLabel =
    updateStatus ??
    (!connected && host.lastSeenAt !== null
      ? `last seen ${formatRelativeTime({ timestamp: host.lastSeenAt, now })}`
      : null);
  return (
    <CommandGroup
      heading={
        <span className="flex items-center gap-1.5">
          {contextual ? null : <MachineStatusDot connected={connected} />}
          <span className="min-w-0 truncate">
            {contextual ? `On ${host.name}` : host.name}
          </span>
          {!contextual && isThisMachine ? (
            <span className={MACHINE_BADGE_CLASS_NAME}>this machine</span>
          ) : null}
          {statusLabel ? (
            <span
              className={cn(
                "ml-auto shrink-0 pl-2 text-2xs",
                updateStatus && "text-warning-foreground",
              )}
            >
              {statusLabel}
            </span>
          ) : null}
        </span>
      }
    >
      {onSelectProvider !== undefined
        ? hostProviders.map((provider) => {
            const disabledReason = providerDisabledReason(
              provider,
              inputsControlProviderIds,
            );
            return (
              <EnvironmentMenuItem
                key={provider.id}
                value={`provider:${host.id}:${provider.id}`}
                label={provider.displayName}
                description={
                  connected
                    ? providerDescription(provider, inputsControlProviderIds)
                    : undefined
                }
                icon={pluginIconName(provider.icon)}
                provider={provider}
                selected={
                  providerValueSelected(value, provider) &&
                  selectedProviderHostId === host.id
                }
                disabled={!selectable || disabledReason !== null}
                onSelect={() => onSelectProvider(provider, host.id)}
              />
            );
          })
        : null}
      {source === null && onRequestMachineSetup && connected ? (
        <EnvironmentMenuItem
          value={`setup:${host.id}`}
          label={`Set up on ${host.name}…`}
          icon="Plus"
          selected={false}
          onSelect={() => onRequestMachineSetup(host)}
        />
      ) : source === null && hostProviders.length === 0 ? (
        <CommandItem
          value={`not-set-up:${host.id}`}
          disabled
          className="whitespace-normal break-words text-xs text-muted-foreground"
        >
          Not set up for this project
        </CommandItem>
      ) : null}
    </CommandGroup>
  );
}

interface EnvironmentMenuItemProps {
  value: string;
  provider?: SystemEnvironmentProvider;
  label: string;
  description?: string;
  icon: IconName;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  alignIconWithMachine?: boolean;
}

function EnvironmentMenuItem({
  value,
  provider,
  label,
  description,
  icon,
  selected,
  onSelect,
  disabled,
  alignIconWithMachine = false,
}: EnvironmentMenuItemProps) {
  return (
    <CommandItem
      value={value}
      disabled={disabled}
      aria-current={selected ? "true" : undefined}
      onSelect={() => {
        if (disabled) return;
        onSelect();
      }}
      className={cn(
        "flex items-start justify-between gap-3 whitespace-normal",
        "py-[0.3125rem] text-xs max-md:py-2",
        LIST_HOVER_TRANSITION,
      )}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2">
        {alignIconWithMachine ? (
          <span
            aria-hidden
            data-machine-status-spacer=""
            className="size-1.5 shrink-0"
          />
        ) : null}
        {provider === undefined ? (
          <Icon
            name={icon}
            className={cn(
              "mt-px max-md:pointer-coarse:mt-0",
              "text-muted-foreground",
              COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
            )}
          />
        ) : (
          <EnvironmentProviderIcon
            provider={provider}
            className={cn(
              "mt-px max-md:pointer-coarse:mt-0 text-muted-foreground",
              COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
            )}
          />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="whitespace-normal break-words text-xs">{label}</span>
          {description ? (
            <span className="mt-0.5 whitespace-normal break-words text-xs leading-snug text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
      </span>
      <Icon
        name="Check"
        className={cn(
          COARSE_POINTER_ICON_SIZE_CLASS,
          "shrink-0",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
    </CommandItem>
  );
}
