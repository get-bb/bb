import { EnvironmentProviderIcon } from "@/components/plugin/EnvironmentProviderIcon";
import { useMemo } from "react";
import type { Host, ProjectSource } from "@bb/domain";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { findLocalPathProjectSourceForHost } from "@bb/domain";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { Button } from "@bb/shared-ui/button";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { selectHosts } from "@/hooks/queries/host-queries";
import { providerInputsControlRequired } from "./environment-provider-inputs";
import { MACHINE_BADGE_CLASS_NAME, orderLocalHostFirst } from "./MachinePicker";
import { PickerLoadingRows } from "./PickerLoadingRows";

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
  modal = false,
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
        : {
            ...machines,
            hosts: selectHosts(machines.hosts, "persistent"),
          },
    [machines],
  );
  const availableHost = host?.type === "ephemeral" ? null : host;
  const hostId = availableHost?.id ?? null;
  const hasMultipleMachines = (availableMachines?.hosts.length ?? 0) > 1;
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
          <PickerLoadingRows
            label="Loading environments"
            rowDataAttribute="data-environment-loading-row"
          />
        ) : isMachineMenu && availableMachines ? (
          <MachineGroupedEnvironmentOptions
            machines={availableMachines}
            sources={sources}
            value={value}
            onRequestMachineSetup={onRequestMachineSetup}
            environmentProviders={environmentProviders}
            providersByHostId={providersByHostId}
            selectedProviderHostId={selectedProviderHostId}
            inputsControlProviderIds={inputsControlProviderIds}
            onSelectProvider={onSelectProvider}
          />
        ) : (
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
            onSelectProvider={onSelectProvider}
          />
        )}
        {!isLoading &&
        onSelectProvider &&
        hostlessProviders.length > 0 &&
        environmentProviders.length > 0 ? (
          <DropdownMenuSeparator />
        ) : null}
        {!isLoading && onSelectProvider
          ? hostlessProviders.map((provider) => (
              <EnvironmentMenuItem
                key={provider.id}
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
            ))
          : null}
      </DropdownMenuContent>
    </DropdownMenu>
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
        environmentProviders.map((provider) => {
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
  const orderedHosts = orderLocalHostFirst(
    machines.hosts,
    machines.localDaemonHostId,
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
  onSelectProvider,
}: MachineSectionProps) {
  const connected = host.status === "connected";
  const hostProviders = environmentProviders;
  const selectable = connected && host.lifecycle.phase === "active";
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
                disabled={!selectable || disabledReason !== null}
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
