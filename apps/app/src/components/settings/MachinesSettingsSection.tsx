import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Host, PermissionMode } from "@bb/domain";
import type { SystemMachineProvider } from "@bb/server-contract";
import { RETRY_ACTION_ICON } from "@bb/domain/update-state";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceRowDetailChevron,
  targetsResourceAction,
} from "@bb/shared-ui/resource-list";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { AddMachineDialog } from "@/components/dialogs/AddMachineDialog";
import { appToast } from "@/components/ui/app-toast";
import { MachineLifecycleActions } from "@/components/machines/MachineLifecycleActions";
import { MachineRemoveDialog } from "@/components/machines/MachineRemoveDialog";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import {
  machineStatusLabel,
  machineStatusTone,
} from "@/components/machines/machine-status";
import { MachineRenameDialog } from "@/components/settings/MachineRenameDialog";
import { MachineLabel } from "@/components/machines/MachineLabel";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import {
  useRenameHost,
  useResumeHost,
  useRetryHostCleanup,
  useRetryHostUpdate,
  useSuspendHost,
} from "@/hooks/mutations/host-mutations";
import { useHosts } from "@/hooks/queries/host-queries";
import { useSystemMachineProviders } from "@/hooks/queries/machine-provider-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { getSettingsMachineRoutePath } from "@/lib/route-paths";
import { PERMISSION_MODE_OPTIONS } from "@/lib/permission-mode-options";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  formatHostUpdateStatus,
  hostCanRetryUpdate,
} from "@/lib/host-update-status";

const PERMISSION_MODE_PRESENTATION: Record<
  PermissionMode,
  (typeof PERMISSION_MODE_OPTIONS)[number]
> = Object.fromEntries(
  PERMISSION_MODE_OPTIONS.map((option) => [option.value, option]),
) as Record<PermissionMode, (typeof PERMISSION_MODE_OPTIONS)[number]>;

const MACHINES_SECTION_DESCRIPTION =
  "Computers that can run your tasks. Pair a machine to run projects and threads on it.";

const PRIMARY_REMOVE_DISABLED_REASON = "bb's primary machine can't be removed.";

const MACHINE_MENU_ITEM_CLASS = "min-h-9 px-2.5 py-2";

const PLATFORM_LABELS: Record<HostPlatform, string | null> = {
  darwin: "macOS",
  linux: "Linux",
  wsl: "WSL",
  unknown: null,
};

interface MachineRowProps {
  host: Host;
  isPrimary: boolean;
  isThisMachine: boolean;
  showPrimaryBadge: boolean;
  platformLabel: string | null;
  projectCount: number;
  now: number;
  onRename: () => void;
  onRemove: () => void;
  onRetryUpdate: () => void;
  onSuspend: () => void;
  onResume: () => void;
  onRetryCleanup: () => void;
  lifecycleActionPending: boolean;
  retryUpdatePending: boolean;
  machineProvider: SystemMachineProvider | null;
}

export function MachineRowContent({
  host,
  isPrimary,
  isThisMachine,
  showPrimaryBadge,
  platformLabel,
  projectCount,
  now,
  onRename,
  onRemove,
  onRetryUpdate,
  onSuspend,
  onResume,
  onRetryCleanup,
  lifecycleActionPending,
  retryUpdatePending,
  machineProvider,
}: MachineRowProps) {
  const navigate = useNavigate();
  const detailPath = getSettingsMachineRoutePath(host.id);
  const permission = PERMISSION_MODE_PRESENTATION[host.maxPermissionMode];
  const projectLabel = `${projectCount} ${projectCount === 1 ? "project" : "projects"}`;
  const connectionLabel = machineStatusLabel({ host, now });
  const updateStatus = formatHostUpdateStatus(host);
  const removeItem = (
    <DropdownMenuItem
      variant="destructive"
      aria-disabled={isPrimary || undefined}
      className={cn(
        MACHINE_MENU_ITEM_CLASS,
        isPrimary && "cursor-not-allowed focus:bg-transparent",
      )}
      onSelect={(event) => {
        if (isPrimary) {
          event.preventDefault();
          return;
        }
        onRemove();
      }}
    >
      <Icon name="Trash2" aria-hidden />
      <span className="min-w-0 truncate">Remove machine</span>
    </DropdownMenuItem>
  );

  return (
    <SettingsRow>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div
          data-machine-row
          className="group group/machine -mx-2 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-state-hover focus-within:bg-state-hover"
          onClick={(event) => {
            if (targetsResourceAction(event.target)) return;
            navigate(detailPath);
          }}
        >
          <Link
            to={getSettingsMachineRoutePath(host.id)}
            aria-label={`Open ${host.name}`}
            className="flex min-w-0 flex-1 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <MachineLabel
                  host={host}
                  machineProvider={machineProvider}
                  nameClassName="text-sm font-medium text-foreground"
                />
                {isThisMachine ? (
                  <SettingsBadge>this machine</SettingsBadge>
                ) : null}
                {showPrimaryBadge ? (
                  <SettingsBadge>primary</SettingsBadge>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-subtle-foreground/75">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <MachineStatusDot tone={machineStatusTone(host)} />
                  <span className="min-w-0 truncate">{connectionLabel}</span>
                </span>
                {platformLabel === null ? null : (
                  <span className="truncate">{platformLabel}</span>
                )}
                <span className="shrink-0">{projectLabel}</span>
                <span
                  className={cn(
                    "shrink-0",
                    permission.tone === "warning" && "text-warning-text",
                  )}
                >
                  {permission.label}
                </span>
                {updateStatus === null ? null : (
                  <span className="min-w-0 text-warning-text">
                    {updateStatus}
                  </span>
                )}
              </div>
            </div>
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <TooltipProvider delayDuration={250}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 data-[state=open]:bg-state-active data-[state=open]:text-foreground"
                    aria-label={`${host.name} actions`}
                  >
                    <Icon name="MoreHorizontal" className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-max min-w-0">
                  <DropdownMenuItem
                    className={MACHINE_MENU_ITEM_CLASS}
                    onSelect={onRename}
                  >
                    <Icon name="Edit" aria-hidden />
                    <span className="min-w-0 truncate">Rename</span>
                  </DropdownMenuItem>
                  {hostCanRetryUpdate(host) ? (
                    <DropdownMenuItem
                      className={MACHINE_MENU_ITEM_CLASS}
                      disabled={retryUpdatePending}
                      onSelect={onRetryUpdate}
                    >
                      <Icon name={RETRY_ACTION_ICON} aria-hidden />
                      <span className="min-w-0 truncate">
                        {retryUpdatePending
                          ? "Retrying update…"
                          : "Retry update"}
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                  <MachineLifecycleActions
                    host={host}
                    machineProvider={machineProvider}
                    pending={lifecycleActionPending}
                    presentation="menu"
                    onSuspend={onSuspend}
                    onResume={onResume}
                    onRetryCleanup={onRetryCleanup}
                  />
                  {isPrimary ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{removeItem}</TooltipTrigger>
                      <TooltipContent side="left">
                        {PRIMARY_REMOVE_DISABLED_REASON}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    removeItem
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </TooltipProvider>
            <ResourceRowDetailChevron />
          </div>
        </div>
      </div>
    </SettingsRow>
  );
}

export function MachinesSettingsSection() {
  const systemConfig = useSystemConfig();
  const hostsQuery = useHosts({ includeCreating: true });
  const { providers: machineProviders } = useSystemMachineProviders();
  const { localDaemonHostId, platform: localDaemonPlatform } = useHostDaemon();
  const sidebarNavigationQuery = useSidebarNavigation();
  const renameHost = useRenameHost();
  const retryHostUpdate = useRetryHostUpdate();
  const suspendHost = useSuspendHost();
  const resumeHost = useResumeHost();
  const retryHostCleanup = useRetryHostCleanup();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [showAllMachines, setShowAllMachines] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Host | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Host | null>(null);

  const hosts = hostsQuery.data;
  const serverPrimaryHostId = systemConfig.data?.primaryHostId ?? null;
  const projects = sidebarNavigationQuery.data?.projects;
  const projectCountByHostId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects ?? []) {
      const hostIds = new Set(project.sources.map((source) => source.hostId));
      for (const hostId of hostIds) {
        counts.set(hostId, (counts.get(hostId) ?? 0) + 1);
      }
    }
    return counts;
  }, [projects]);

  const now = Date.now();
  const primaryHostPlatform = systemConfig.data?.primaryHostPlatform ?? null;
  const persistentHosts = hosts?.filter((host) => host.type === "persistent");
  const sandboxHosts = hosts?.filter((host) => host.type === "ephemeral");
  const visibleHosts =
    showAllMachines && sandboxHosts !== undefined
      ? [...(persistentHosts ?? []), ...sandboxHosts]
      : (persistentHosts ?? []);
  const showMachineIdentityBadges = (persistentHosts?.length ?? 0) > 1;
  const hasMachineRows =
    persistentHosts !== undefined && persistentHosts.length > 0;
  const machineProviderById = useMemo(
    () =>
      new Map(
        (machineProviders ?? []).map((provider) => [provider.id, provider]),
      ),
    [machineProviders],
  );
  const renderMachineRows = (rows: readonly Host[]) => (
    <SettingsRowList>
      {rows.map((host) => (
        <MachineRowContent
          key={host.id}
          host={host}
          isPrimary={host.id === serverPrimaryHostId}
          isThisMachine={
            showMachineIdentityBadges && host.id === localDaemonHostId
          }
          showPrimaryBadge={
            showMachineIdentityBadges && host.id === serverPrimaryHostId
          }
          platformLabel={
            host.id === localDaemonHostId && localDaemonPlatform !== null
              ? PLATFORM_LABELS[localDaemonPlatform]
              : host.id === serverPrimaryHostId && primaryHostPlatform !== null
                ? PLATFORM_LABELS[primaryHostPlatform]
                : null
          }
          projectCount={projectCountByHostId.get(host.id) ?? 0}
          now={now}
          onRename={() => {
            renameHost.reset();
            setRenameTarget(host);
          }}
          onRemove={() => {
            setRemoveTarget(host);
          }}
          onRetryUpdate={() =>
            retryHostUpdate.mutate(host.id, {
              onSuccess: () => {
                appToast.success(`Update retry requested for ${host.name}`);
              },
            })
          }
          retryUpdatePending={
            retryHostUpdate.isPending && retryHostUpdate.variables === host.id
          }
          onSuspend={() =>
            suspendHost.mutate(host.id, {
              onSuccess: () => appToast.success(`${host.name} suspended`),
            })
          }
          onResume={() =>
            resumeHost.mutate(host.id, {
              onSuccess: () => appToast.success(`${host.name} resumed`),
            })
          }
          onRetryCleanup={() =>
            retryHostCleanup.mutate(host.id, {
              onSuccess: () =>
                appToast.success(`Cleanup retried for ${host.name}`),
            })
          }
          lifecycleActionPending={
            (suspendHost.isPending && suspendHost.variables === host.id) ||
            (resumeHost.isPending && resumeHost.variables === host.id) ||
            (retryHostCleanup.isPending &&
              retryHostCleanup.variables === host.id)
          }
          machineProvider={
            host.machineProviderId === null
              ? null
              : (machineProviderById.get(host.machineProviderId) ?? null)
          }
        />
      ))}
    </SettingsRowList>
  );

  return (
    <>
      <SettingsSection
        title="Machines"
        description={MACHINES_SECTION_DESCRIPTION}
        bodyClassName={hasMachineRows ? "py-2" : undefined}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddDialogOpen(true)}
          >
            <Icon name="Plus" className="size-3.5" />
            Add a machine
          </Button>
        }
      >
        {hosts === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : visibleHosts.length === 0 ? (
          <p className="text-sm text-subtle-foreground">No machines yet.</p>
        ) : (
          renderMachineRows(visibleHosts)
        )}
        {sandboxHosts !== undefined && sandboxHosts.length > 0 ? (
          <button
            type="button"
            aria-expanded={showAllMachines}
            onClick={() => setShowAllMachines((previous) => !previous)}
            className="-ml-1 inline-flex items-center gap-1.5 self-start rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
          >
            <Icon
              name="ChevronDown"
              className={cn(
                "size-3.5 transition-transform",
                showAllMachines && "rotate-180",
              )}
              aria-hidden
            />
            <span>
              {showAllMachines ? "Show fewer machines" : "Show all machines"}
            </span>
          </button>
        ) : null}
      </SettingsSection>

      <AddMachineDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      <MachineRenameDialog
        target={renameTarget}
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
          if (!open && !renameHost.isPending) setRenameTarget(null);
        }}
        onRename={(host, name) =>
          renameHost.mutate(
            { hostId: host.id, name },
            { onSuccess: () => setRenameTarget(null) },
          )
        }
      />

      <MachineRemoveDialog
        target={removeTarget}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      />
    </>
  );
}
