import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Host, PermissionMode } from "@bb/domain";
import type { SystemMachineProvider } from "@bb/server-contract";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceOverflowMenu,
  ResourceRowDetailChevron,
  targetsResourceAction,
} from "@bb/shared-ui/resource-list";
import { AddMachineDialog } from "@/components/dialogs/AddMachineDialog";
import { appToast } from "@/components/ui/app-toast";
import { machineActions } from "@/components/machines/machine-actions";
import { MachineReconnectDialog } from "@/components/machines/MachineReconnectDialog";
import { MachineRemoveDialog } from "@/components/machines/MachineRemoveDialog";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { MoveServerDialog } from "@/components/machines/MoveServerDialog";
import {
  machineStatusLabel,
  machineStatusTone,
} from "@/components/machines/machine-status";
import { canMoveServerHere } from "@/components/machines/server-move";
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
import { useServerMoveStatus } from "@/hooks/queries/server-move-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { getSettingsMachineRoutePath } from "@/lib/route-paths";
import { PERMISSION_MODE_OPTIONS } from "@/lib/permission-mode-options";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { formatHostUpdateStatus } from "@/lib/host-update-status";

const PERMISSION_MODE_PRESENTATION: Record<
  PermissionMode,
  (typeof PERMISSION_MODE_OPTIONS)[number]
> = Object.fromEntries(
  PERMISSION_MODE_OPTIONS.map((option) => [option.value, option]),
) as Record<PermissionMode, (typeof PERMISSION_MODE_OPTIONS)[number]>;

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
  showServerBadge: boolean;
  platformLabel: string | null;
  projectCount: number;
  now: number;
  onRename: () => void;
  onRemove: () => void;
  onReconnect: () => void;
  onRetryUpdate: () => void;
  onSuspend: () => void;
  onResume: () => void;
  onRetryCleanup: () => void;
  canMoveServerHere: boolean;
  onMoveServerHere: () => void;
  serverMoveEnabled: boolean;
  lifecycleActionPending: boolean;
  retryUpdatePending: boolean;
  machineProvider: SystemMachineProvider | null;
}

export function MachineRowContent({
  host,
  isPrimary,
  isThisMachine,
  showServerBadge,
  platformLabel,
  projectCount,
  now,
  onRename,
  onRemove,
  onReconnect,
  onRetryUpdate,
  onSuspend,
  onResume,
  onRetryCleanup,
  canMoveServerHere,
  onMoveServerHere,
  serverMoveEnabled,
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

  return (
    <SettingsRow>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div
          data-machine-row
          className="group group/machine -mx-2 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-state-hover focus-within:bg-state-hover"
          onClick={(event) => {
            if (targetsResourceAction(event)) return;
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
                {showServerBadge ? <SettingsBadge>server</SettingsBadge> : null}
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
            <ResourceOverflowMenu
              label={`${host.name} actions`}
              items={machineActions({
                host,
                machineProvider,
                isPrimary,
                canMoveServerHere,
                serverMoveEnabled,
                lifecycleActionPending,
                retryUpdatePending,
                onRename,
                onReconnect,
                onRetryUpdate,
                onSuspend,
                onResume,
                onRetryCleanup,
                onMoveServerHere,
                onRemove,
              })}
            />
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
  const serverMoveStatus = useServerMoveStatus();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [showAllMachines, setShowAllMachines] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Host | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Host | null>(null);
  const [reconnectTargetId, setReconnectTargetId] = useState<string | null>(
    null,
  );
  const [moveServerTarget, setMoveServerTarget] = useState<Host | null>(null);

  const hosts = hostsQuery.data;
  const serverPrimaryHostId = systemConfig.data?.primaryHostId ?? null;
  const serverMoveEnabled = systemConfig.data?.experiments.serverMove ?? false;
  const serverMove = serverMoveStatus.data?.move ?? null;
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
  const showThisMachineBadge = (persistentHosts?.length ?? 0) > 1;
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
          isThisMachine={showThisMachineBadge && host.id === localDaemonHostId}
          showServerBadge={host.id === serverPrimaryHostId}
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
          onReconnect={() => {
            setReconnectTargetId(host.id);
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
          canMoveServerHere={
            systemConfig.data !== undefined &&
            canMoveServerHere({
              host,
              primaryHostId: serverPrimaryHostId,
              move: serverMove,
              serverMoveEnabled,
            })
          }
          onMoveServerHere={() => setMoveServerTarget(host)}
          serverMoveEnabled={serverMoveEnabled}
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
        bodyClassName="space-y-3 border-0 bg-transparent p-0"
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
        <div
          role="note"
          aria-label="About the bb server"
          className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3"
        >
          <Icon
            name="Info"
            className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
            aria-hidden
          />
          <div className="min-w-0 space-y-1 text-xs leading-relaxed text-subtle-foreground">
            <p className="font-medium text-foreground">How machines connect</p>
            <p>
              All your machines connect to one central bb server, where your
              threads and settings are stored. Choose a machine that can stay
              awake and online to run the server.
            </p>
            {serverMoveEnabled ? (
              <p>
                To change which machine runs the server, open the ⋯ menu on
                another machine below and choose{" "}
                <span className="font-medium text-foreground">
                  Move server here
                </span>
                .
              </p>
            ) : null}
          </div>
        </div>
        <div
          className={cn(
            "rounded-lg border border-border bg-card px-4 py-3.5",
            hasMachineRows && "py-2",
          )}
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
        </div>
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

      <MachineReconnectDialog
        target={hosts?.find((host) => host.id === reconnectTargetId) ?? null}
        onOpenChange={(open) => {
          if (!open) setReconnectTargetId(null);
        }}
      />

      <MachineRemoveDialog
        target={removeTarget}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      />

      <MoveServerDialog
        target={moveServerTarget}
        onOpenChange={(open) => {
          if (!open) setMoveServerTarget(null);
        }}
      />
    </>
  );
}
