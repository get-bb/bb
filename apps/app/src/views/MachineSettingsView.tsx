import { MachineLifecycleNoticeContent } from "@/components/machines/MachineLifecycleNotice";
import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Host, PermissionMode } from "@bb/domain";
import type { SystemMachineProvider } from "@bb/server-contract";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Pill } from "@bb/shared-ui/pill";
import { ResourceOverflowMenu } from "@bb/shared-ui/resource-list";
import { MachineLifecycleActions } from "@/components/machines/MachineLifecycleActions";
import {
  MachineRemoveDialog,
  machineRemovalConsequences,
} from "@/components/machines/MachineRemoveDialog";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import {
  machineStatusLabel,
  machineStatusTone,
} from "@/components/machines/machine-status";
import { MachineLabel } from "@/components/machines/MachineLabel";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { appToast } from "@/components/ui/app-toast";
import { MachineRenameDialog } from "@/components/settings/MachineRenameDialog";
import {
  useRenameHost,
  useResumeHost,
  useRetryHostCleanup,
  useRetryHostUpdate,
  useSuspendHost,
  useUpdateHostPermissionCeiling,
} from "@/hooks/mutations/host-mutations";
import { useHosts } from "@/hooks/queries/host-queries";
import { useSystemMachineProviders } from "@/hooks/queries/machine-provider-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  useSystemConfig,
  useSystemProviders,
} from "@/hooks/queries/system-queries";
import { isProviderCliUpdateIssue } from "@/components/provider-cli/provider-cli-install";
import { useUpdateInventory } from "@/hooks/useUpdateInventory";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import {
  formatHostUpdateStatus,
  hostCanRetryUpdate,
} from "@/lib/host-update-status";
import {
  getMutationErrorMessage,
  showMutationErrorToast,
} from "@/lib/mutation-errors";
import { PERMISSION_MODE_OPTIONS } from "@/lib/permission-mode-options";
import { formatRelativeTime } from "@/lib/relative-time";
import { ProviderIconMark } from "@/components/settings/ProviderIconMark";
import { getProviderIconInfo } from "@/lib/provider-icon";
import {
  getSettingsProjectRoutePath,
  getSettingsRoutePath,
} from "@/lib/route-paths";

const PRIMARY_REMOVE_DISABLED_REASON = "bb's primary machine can't be removed.";

const PERMISSION_LIMIT_DESCRIPTION =
  "Highest permission mode any thread on the selected machine may run with. Threads that ask for more resolve down to it, and a provider that supports nothing this low can't run here.";

const PLATFORM_LABELS: Record<HostPlatform, string | null> = {
  darwin: "macOS",
  linux: "Linux",
  wsl: "WSL",
  unknown: null,
};

interface MachineProject {
  id: string;
  name: string;
}

function headerMeta({
  host,
  platformLabel,
  now,
}: {
  host: Host;
  platformLabel: string | null;
  now: number;
}): string {
  const parts: string[] = [machineStatusLabel({ host, now })];
  if (platformLabel !== null) parts.push(platformLabel);
  parts.push(
    `paired ${formatRelativeTime({ timestamp: host.createdAt, now })}`,
  );
  return parts.join(" · ");
}

interface PermissionLimitCardProps {
  disabled: boolean;
  onSelect: (permissionMode: PermissionMode) => void;
  value: PermissionMode;
}

function PermissionLimitCards({
  disabled,
  onSelect,
  value,
}: PermissionLimitCardProps) {
  return (
    <div role="radiogroup" aria-label="Permission limit">
      <SettingsRowList>
        {PERMISSION_MODE_OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <SettingsRow key={option.value} className="items-start">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => {
                  if (!selected) onSelect(option.value);
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  disabled && "opacity-70",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-foreground" : "border-input",
                  )}
                >
                  {selected ? (
                    <span className="size-2 rounded-full bg-foreground" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-foreground">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="mt-0.5 block text-xs leading-snug text-subtle-foreground/75">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            </SettingsRow>
          );
        })}
      </SettingsRowList>
    </div>
  );
}

interface DetailRowProps {
  label: string;
  children: ReactNode;
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <SettingsRow className="flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="shrink-0 text-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 text-left text-subtle-foreground sm:ml-auto sm:justify-end sm:text-right">
        {children}
      </div>
    </SettingsRow>
  );
}

export function MachineSettingsHeader({
  host,
  machineProvider,
  platformLabel,
  now,
  isPrimary,
  isThisMachine,
  showPrimaryBadge,
  lifecycleNotice,
  lifecycleActionPending,
  onSuspend,
  onResume,
  onRetryCleanup,
  onRename,
}: {
  host: Host;
  machineProvider: SystemMachineProvider | null;
  platformLabel: string | null;
  now: number;
  isPrimary: boolean;
  isThisMachine: boolean;
  showPrimaryBadge: boolean;
  lifecycleNotice: ComponentProps<
    typeof MachineLifecycleNoticeContent
  >["notice"];
  lifecycleActionPending: boolean;
  onSuspend: () => void;
  onResume: () => void;
  onRetryCleanup: () => void;
  onRename: () => void;
}) {
  return (
    <div className="space-y-3">
      <Link
        to={getSettingsRoutePath("machines")}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <Icon name="ChevronLeft" className="size-3.5" />
        Machines
      </Link>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 text-sm font-semibold text-foreground">
              <MachineLabel host={host} machineProvider={machineProvider} />
            </h1>
            {isThisMachine ? <SettingsBadge>This machine</SettingsBadge> : null}
            {showPrimaryBadge ? <SettingsBadge>Primary</SettingsBadge> : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <MachineStatusDot tone={machineStatusTone(host)} />
            <p className="min-w-0 text-xs text-subtle-foreground/75">
              {headerMeta({ host, platformLabel, now })}
            </p>
          </div>
          <MachineLifecycleNoticeContent notice={lifecycleNotice} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MachineLifecycleActions
            host={host}
            machineProvider={machineProvider}
            pending={lifecycleActionPending}
            presentation="buttons"
            onSuspend={onSuspend}
            onResume={onResume}
            onRetryCleanup={onRetryCleanup}
          />
          <ResourceOverflowMenu
            label={`${host.name} actions`}
            items={[{ label: "Rename", icon: "Edit", onSelect: onRename }]}
          />
        </div>
      </div>
    </div>
  );
}

export function MachineSettingsView() {
  const { hostId } = useParams<{ hostId: string }>();
  const navigate = useNavigate();
  const hostsQuery = useHosts();
  const { providers: machineProviders } = useSystemMachineProviders();
  const systemConfig = useSystemConfig();
  const { localDaemonHostId, platform: localDaemonPlatform } = useHostDaemon();
  const sidebarNavigationQuery = useSidebarNavigation();
  const updateInventory = useUpdateInventory();
  const renameHost = useRenameHost();
  const retryHostUpdate = useRetryHostUpdate();
  const suspendHost = useSuspendHost();
  const resumeHost = useResumeHost();
  const retryHostCleanup = useRetryHostCleanup();
  const updatePermissionCeiling = useUpdateHostPermissionCeiling();
  const [renameOpen, setRenameOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const hosts = hostsQuery.data;
  const host = hosts?.find((candidate) => candidate.id === hostId) ?? null;
  const lifecycleMessage = host?.lifecycle.message ?? null;
  const lifecycleNotice =
    host === null
      ? null
      : { phase: host.lifecycle.phase, message: lifecycleMessage };
  const primaryHostId = systemConfig.data?.primaryHostId ?? null;
  const isPrimary = host !== null && host.id === primaryHostId;
  const showMachineIdentityBadges = (hosts?.length ?? 0) > 1;
  const isThisMachine =
    showMachineIdentityBadges && host !== null && host.id === localDaemonHostId;
  const machineProvider =
    host?.machineProviderId === null || host?.machineProviderId === undefined
      ? null
      : (machineProviders?.find(
          (provider) => provider.id === host.machineProviderId,
        ) ?? null);

  const projects: MachineProject[] = useMemo(() => {
    const navigation = sidebarNavigationQuery.data?.projects ?? [];
    return navigation
      .filter((project) =>
        project.sources.some((source) => source.hostId === hostId),
      )
      .map((project) => ({ id: project.id, name: project.name }));
  }, [hostId, sidebarNavigationQuery.data]);

  const machine = updateInventory.machines.find(
    (candidate) => candidate.host.id === hostId,
  );
  const updateIssueCount = (machine?.issues ?? []).filter(
    isProviderCliUpdateIssue,
  ).length;
  const providerRoster = useSystemProviders().data;
  const installedProviders = useMemo(() => {
    const status = machine?.providerStatus;
    if (!status) return [];
    return Object.entries(status).flatMap(([providerId, entry]) => {
      if (!entry.installed) return [];
      const provider = providerRoster?.find(
        (candidate) => candidate.id === providerId,
      );
      return [
        {
          ...entry,
          providerId,
          provider,
          ProviderIcon: getProviderIconInfo(
            "agent",
            providerId,
            provider ?? null,
          )?.icon,
        },
      ];
    });
  }, [machine?.providerStatus, providerRoster]);

  const now = Date.now();
  const platformLabel =
    host !== null &&
    host.id === localDaemonHostId &&
    localDaemonPlatform !== null
      ? PLATFORM_LABELS[localDaemonPlatform]
      : isPrimary && systemConfig.data?.primaryHostPlatform
        ? PLATFORM_LABELS[systemConfig.data.primaryHostPlatform]
        : null;

  if (hosts === undefined) {
    return (
      <PageShell contentClassName="pt-4 md:pt-5">
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </PageShell>
    );
  }

  if (host === null) {
    return (
      <PageShell contentClassName="pt-4 md:pt-5">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          <Link
            to={getSettingsRoutePath("machines")}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <Icon name="ChevronLeft" className="size-3.5" />
            Machines
          </Link>
          <p className="text-sm text-muted-foreground">
            Machine is no longer paired.
          </p>
        </div>
      </PageShell>
    );
  }

  const updateStatus = formatHostUpdateStatus(host);

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6 pb-10">
        <MachineSettingsHeader
          host={host}
          machineProvider={machineProvider}
          platformLabel={platformLabel}
          now={now}
          isPrimary={isPrimary}
          isThisMachine={isThisMachine}
          showPrimaryBadge={showMachineIdentityBadges && isPrimary}
          lifecycleNotice={lifecycleNotice}
          lifecycleActionPending={
            suspendHost.isPending ||
            resumeHost.isPending ||
            retryHostCleanup.isPending
          }
          onSuspend={() => suspendHost.mutate(host.id)}
          onResume={() => resumeHost.mutate(host.id)}
          onRetryCleanup={() => retryHostCleanup.mutate(host.id)}
          onRename={() => {
            renameHost.reset();
            setRenameOpen(true);
          }}
        />

        <SettingsSection
          title="Permission limit"
          description={PERMISSION_LIMIT_DESCRIPTION}
        >
          <PermissionLimitCards
            value={host.maxPermissionMode}
            disabled={updatePermissionCeiling.isPending}
            onSelect={(maxPermissionMode) =>
              updatePermissionCeiling.mutate(
                { hostId: host.id, maxPermissionMode },
                {
                  onError: (error) => {
                    showMutationErrorToast({
                      error,
                      fallbackMessage: `Couldn't change the permission limit for ${host.name}.`,
                    });
                  },
                },
              )
            }
          />
        </SettingsSection>

        <SettingsSection title="Provider CLIs">
          <SettingsRowList>
            <DetailRow label="Installed">
              {host.status !== "connected" ? (
                <span>Unavailable while offline</span>
              ) : machine?.statusPending ? (
                <span>Checking…</span>
              ) : machine?.statusError ? (
                <span>Status unavailable</span>
              ) : (
                <>
                  {installedProviders.length > 0 ? (
                    <span className="flex min-w-0 flex-wrap items-center justify-start gap-x-3 gap-y-1 sm:justify-end">
                      {installedProviders.map((entry) => (
                        <span
                          key={entry.providerId}
                          className="inline-flex min-w-0 items-center gap-1.5"
                        >
                          {entry.ProviderIcon ? (
                            <span
                              data-provider-icon={entry.providerId}
                              aria-hidden
                              className="flex size-3.5 shrink-0 items-center justify-center"
                            >
                              {entry.provider === undefined ? (
                                <entry.ProviderIcon className="size-3.5" />
                              ) : (
                                <ProviderIconMark
                                  provider={entry.provider}
                                  icon={entry.ProviderIcon}
                                  className="size-3.5"
                                />
                              )}
                            </span>
                          ) : null}
                          <span>{entry.displayName}</span>
                          {entry.currentVersion ? (
                            <span>{entry.currentVersion}</span>
                          ) : null}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span>None installed</span>
                  )}
                  {updateIssueCount > 0 ? (
                    <Link
                      to={getSettingsRoutePath("updates")}
                      className="shrink-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <Pill
                        variant="outline"
                        size="sm"
                        className="border-attention/50 bg-surface-attention text-warning-text transition-colors hover:border-attention hover:text-foreground"
                      >
                        {updateIssueCount} to fix
                      </Pill>
                    </Link>
                  ) : null}
                </>
              )}
            </DetailRow>
          </SettingsRowList>
        </SettingsSection>

        <SettingsSection title="Machine information">
          <SettingsRowList>
            <DetailRow label="Projects">
              {projects.length === 0 ? (
                <span>None</span>
              ) : (
                <span className="min-w-0 truncate">
                  {projects.map((project, index) => (
                    <span key={project.id}>
                      {index > 0 ? " · " : ""}
                      <Link
                        to={getSettingsProjectRoutePath(project.id)}
                        className="hover:text-foreground"
                      >
                        {project.name}
                      </Link>
                    </span>
                  ))}
                </span>
              )}
            </DetailRow>
            <DetailRow label="Updates">
              <span>{updateStatus ?? "Up to date"}</span>
              {hostCanRetryUpdate(host) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={retryHostUpdate.isPending}
                  onClick={() =>
                    retryHostUpdate.mutate(host.id, {
                      onSuccess: () => {
                        appToast.success(
                          `Update retry requested for ${host.name}`,
                        );
                      },
                    })
                  }
                >
                  {retryHostUpdate.isPending ? "Retrying…" : "Retry update"}
                </Button>
              ) : null}
            </DetailRow>
          </SettingsRowList>
        </SettingsSection>

        <SettingsSection
          title="Danger zone"
          description={
            isPrimary
              ? PRIMARY_REMOVE_DISABLED_REASON
              : `Revokes ${host.name}'s access to this server. ${machineRemovalConsequences(host)}`
          }
        >
          <SettingsRowList>
            <SettingsRow>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isPrimary}
                onClick={() => setRemoveOpen(true)}
              >
                Remove machine
              </Button>
            </SettingsRow>
          </SettingsRowList>
        </SettingsSection>
      </div>

      <MachineRenameDialog
        target={renameOpen ? host : null}
        pending={renameHost.isPending}
        errorMessage={
          renameHost.isError
            ? getMutationErrorMessage({
                error: renameHost.error,
                fallbackMessage: "Couldn't rename the machine.",
              })
            : null
        }
        onOpenChange={(open) => {
          if (!open && !renameHost.isPending) setRenameOpen(false);
        }}
        onRename={(target, name) =>
          renameHost.mutate(
            { hostId: target.id, name },
            { onSuccess: () => setRenameOpen(false) },
          )
        }
      />

      <MachineRemoveDialog
        target={removeOpen ? host : null}
        onOpenChange={setRemoveOpen}
        onRemoved={() => navigate(getSettingsRoutePath("machines"))}
      />
    </PageShell>
  );
}
