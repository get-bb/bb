import { EnvironmentProviderIcon } from "@/components/plugin/EnvironmentProviderIcon";
import { useMemo } from "react";
import type { Host, ProjectSource } from "@bb/domain";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { findLocalPathProjectSourceForHost } from "@bb/domain";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { Button } from "@bb/shared-ui/button";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
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
  OPTION_MENU_CONTENT_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import {
  encodeProviderValue,
  parseEnvironmentValue,
} from "./environment-picker-value";
import { selectPersistentHosts } from "@/hooks/queries/host-queries";
import { providerInputsControlRequired } from "./environment-provider-inputs";

interface SelectedEnvironment {
  modeLabel: string;
  compactModeLabel: string;
  icon: IconName;
}

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
  onSelectProvider?: (
    provider: SystemEnvironmentProvider,
    hostId: string | null,
  ) => void;
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
  modal,
  machines,
  onRequestMachineSetup,
  providers = [],
  projectless = false,
  providersByHostId,
  selectedProviderHostId = null,
  inputsControlProviderIds = NO_INPUTS_CONTROL_PROVIDER_IDS,
  onSelectProvider,
}: EnvironmentPickerUIProps) {
  const availableMachines = useMemo(
    () =>
      machines === null || machines === undefined
        ? null
        : { ...machines, hosts: selectPersistentHosts(machines.hosts) },
    [machines],
  );
  const hostId = host?.id ?? null;
  const hasMultipleMachines = (availableMachines?.hosts.length ?? 0) > 1;
  const environmentProviders = useMemo(
    () =>
      providers.filter(
        (provider) => provider.requires.projectless === projectless,
      ),
    [projectless, providers],
  );
  const isMachineMenu = hasMultipleMachines;
  const hostConnected = host?.status === "connected";
  const hostUnavailableReason = !host
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
        ? environmentProviders.find(
            (provider) => provider.id === parsed.environmentProviderId,
          )
        : undefined,
    [environmentProviders, parsed],
  );
  const selected = useMemo((): SelectedEnvironment => {
    if (selectedProvider !== undefined && hostUnavailableReason === null) {
      const showsHost = selectedMachineName !== null;
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
        compactModeLabel: host ? "Offline" : "No host",
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
    host,
    selectedMachineName,
    selectedProvider,
  ]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={onOpenChange}
      defaultOpen={defaultOpen}
      modal={modal}
    >
      <DropdownMenuTrigger asChild disabled={disabled}>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn(
          OPTION_MENU_CONTENT_CLASS_NAME,
          "max-w-80",
          isLoading && "min-w-52",
        )}
        mobileTitle="Environment"
      >
        {isLoading ? (
          <EnvironmentPickerLoadingRows />
        ) : isMachineMenu && availableMachines ? (
          <MachineGroupedEnvironmentOptions
            machines={availableMachines}
            sources={sources}
            value={value}
            onRequestMachineSetup={onRequestMachineSetup}
            machineProviders={environmentProviders}
            providersByHostId={providersByHostId}
            selectedProviderHostId={selectedProviderHostId}
            inputsControlProviderIds={inputsControlProviderIds}
            onSelectProvider={onSelectProvider}
          />
        ) : (
          <EnvironmentOptionsSection
            hostId={hostId}
            hostName={isLocal ? null : (host?.name ?? null)}
            hostUnavailableReason={hostUnavailableReason}
            value={value}
            machineProviders={scopedProviders(
              environmentProviders,
              providersByHostId,
              hostId,
              { value, selectedProviderHostId },
            )}
            selectedProviderHostId={selectedProviderHostId}
            inputsControlProviderIds={inputsControlProviderIds}
            onSelectProvider={onSelectProvider}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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

interface EnvironmentOptionsSectionProps {
  hostId: string | null;
  hostName: string | null;
  hostUnavailableReason: string | null;
  value: string;
  machineProviders: readonly SystemEnvironmentProvider[];
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
  machineProviders,
  selectedProviderHostId,
  inputsControlProviderIds,
  onSelectProvider,
}: EnvironmentOptionsSectionProps) {
  return (
    <DropdownMenuGroup>
      {hostName ? (
        <DropdownMenuLabel className="whitespace-normal break-words text-muted-foreground">
          {hostName}
        </DropdownMenuLabel>
      ) : null}
      {hostUnavailableReason !== null ? (
        <DropdownMenuItem
          disabled
          className="whitespace-normal break-words text-xs text-muted-foreground"
        >
          {hostUnavailableReason}
        </DropdownMenuItem>
      ) : onSelectProvider !== undefined && hostId !== null ? (
        machineProviders.map((provider) => {
          const disabledReason = providerDisabledReason(
            provider,
            inputsControlProviderIds,
          );
          return (
            <EnvironmentMenuItem
              key={provider.id}
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
    </DropdownMenuGroup>
  );
}

const MACHINE_BADGE_CLASS_NAME =
  "shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground";

interface MachineGroupedEnvironmentOptionsProps {
  machines: EnvironmentPickerMachines;
  sources: readonly ProjectSource[];
  value: string;
  onRequestMachineSetup: ((host: Host) => void) | undefined;
  machineProviders: readonly SystemEnvironmentProvider[];
  providersByHostId: EnvironmentPickerUIProps["providersByHostId"];
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
  machineProviders,
  providersByHostId,
  selectedProviderHostId,
  inputsControlProviderIds,
  onSelectProvider,
}: MachineGroupedEnvironmentOptionsProps) {
  const now = Date.now();
  const orderedHosts = [...machines.hosts].sort(
    (left, right) =>
      Number(left.id !== machines.localDaemonHostId) -
      Number(right.id !== machines.localDaemonHostId),
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
          machineProviders={scopedProviders(
            machineProviders,
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

interface MachineSectionProps {
  host: Host;
  isThisMachine: boolean;
  source: ProjectSource | null;
  now: number;
  value: string;
  onRequestMachineSetup: ((host: Host) => void) | undefined;
  machineProviders: readonly SystemEnvironmentProvider[];
  selectedProviderHostId: string | null;
  inputsControlProviderIds: ReadonlySet<string>;
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
  machineProviders,
  selectedProviderHostId,
  inputsControlProviderIds,
  onSelectProvider,
}: MachineSectionProps) {
  const connected = host.status === "connected";
  const hostProviders = machineProviders;
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="min-w-0 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <MachineStatusDot connected={connected} />
          <span className="min-w-0 truncate">{host.name}</span>
          {isThisMachine ? (
            <span className={MACHINE_BADGE_CLASS_NAME}>this machine</span>
          ) : null}
          {formatHostUpdateStatus(host) !== null ? (
            <span className="ml-auto shrink-0 pl-2 text-2xs text-warning-foreground">
              {formatHostUpdateStatus(host)}
            </span>
          ) : !connected && host.lastSeenAt !== null ? (
            <span className="ml-auto shrink-0 pl-2 text-2xs">
              last seen{" "}
              {formatRelativeTime({ timestamp: host.lastSeenAt, now })}
            </span>
          ) : null}
        </span>
      </DropdownMenuLabel>
      {onSelectProvider !== undefined
        ? hostProviders.map((provider) => {
            const disabledReason = providerDisabledReason(
              provider,
              inputsControlProviderIds,
            );
            return (
              <EnvironmentMenuItem
                key={provider.id}
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
                disabled={!connected || disabledReason !== null}
                onSelect={() => onSelectProvider(provider, host.id)}
              />
            );
          })
        : null}
      {source === null && onRequestMachineSetup && connected ? (
        <EnvironmentMenuItem
          label={`Set up on ${host.name}…`}
          icon="Plus"
          selected={false}
          onSelect={() => onRequestMachineSetup(host)}
        />
      ) : source === null && hostProviders.length === 0 ? (
        <DropdownMenuItem
          disabled
          className="whitespace-normal break-words text-xs text-muted-foreground"
        >
          Not set up for this project
        </DropdownMenuItem>
      ) : null}
    </DropdownMenuGroup>
  );
}

interface EnvironmentMenuItemProps {
  provider?: SystemEnvironmentProvider;
  label: string;
  description?: string;
  icon: IconName;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

function EnvironmentMenuItem({
  provider,
  label,
  description,
  icon,
  selected,
  onSelect,
  disabled,
}: EnvironmentMenuItemProps) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={() => {
        if (disabled) return;
        onSelect();
      }}
      className={cn(
        "flex items-start justify-between gap-3 whitespace-normal",
        LIST_HOVER_TRANSITION,
      )}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2">
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
    </DropdownMenuItem>
  );
}
