import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Host, PermissionMode } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { AddMachineDialog } from "@/components/dialogs/AddMachineDialog";
import { ConfirmDeleteDialog } from "@/components/dialogs/ConfirmDeleteDialog";
import { appToast } from "@/components/ui/app-toast";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { MachineRenameDialog } from "@/components/settings/MachineRenameDialog";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import {
  useRemoveHost,
  useRenameHost,
  useRetryHostUpdate,
} from "@/hooks/mutations/host-mutations";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { PersistentHostIconName } from "@/lib/host-display";
import { getSettingsMachineRoutePath } from "@/lib/route-paths";
import { PERMISSION_MODE_OPTIONS } from "@/lib/permission-mode-options";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  formatHostUpdateStatus,
  hostCanRetryUpdate,
} from "@/lib/host-update-status";

/** Fixed column so every machine's limit lands on the same vertical line. */
const MACHINE_LIMIT_COLUMN = "w-36 shrink-0 truncate";

const PERMISSION_MODE_LABELS: Record<PermissionMode, string> =
  Object.fromEntries(
    PERMISSION_MODE_OPTIONS.map((option) => [option.value, option.label]),
  ) as Record<PermissionMode, string>;

const MACHINES_SECTION_DESCRIPTION =
  "Computers that can run your tasks. Pair a machine to run projects and threads on it.";

const PRIMARY_REMOVE_DISABLED_REASON =
  "This machine runs bb and can't be removed.";

const PLATFORM_LABELS: Record<HostPlatform, string | null> = {
  darwin: "macOS",
  linux: "Linux",
  wsl: "WSL",
  unknown: null,
};

function machineMetaLine({
  host,
  platformLabel,
  projectCount,
  now,
}: {
  host: Host;
  platformLabel: string | null;
  projectCount: number;
  now: number;
}): string {
  const parts: string[] = [];
  const updateStatus = formatHostUpdateStatus(host);
  if (updateStatus !== null) {
    parts.push(updateStatus);
  } else if (host.status === "connected") {
    parts.push("Online");
  } else if (host.lastSeenAt !== null) {
    parts.push(
      `Offline · last seen ${formatRelativeTime({ timestamp: host.lastSeenAt, now })}`,
    );
  } else {
    parts.push("Offline");
  }
  if (platformLabel !== null) {
    parts.push(platformLabel);
  }
  parts.push(`${projectCount} ${projectCount === 1 ? "project" : "projects"}`);
  return parts.join(" · ");
}

interface MachineRowProps {
  host: Host;
  isPrimary: boolean;
  platformLabel: string | null;
  projectCount: number;
  now: number;
  onRename: () => void;
  onRemove: () => void;
  onRetryUpdate: () => void;
  retryUpdatePending: boolean;
}

function MachineRow({
  host,
  isPrimary,
  platformLabel,
  projectCount,
  now,
  onRename,
  onRemove,
  onRetryUpdate,
  retryUpdatePending,
}: MachineRowProps) {
  return (
    <SettingsRow className="group relative">
      {/* Stretched link: the whole row opens the machine page, while the
          controls above it keep their own click targets. */}
      <Link
        to={getSettingsMachineRoutePath(host.id)}
        aria-label={`Open ${host.name}`}
        className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Icon
        name={PersistentHostIconName}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <MachineStatusDot connected={host.status === "connected"} />
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {host.name}
          </span>
          {isPrimary ? <SettingsBadge>this machine</SettingsBadge> : null}
        </div>
        <p className="min-w-0 text-xs text-subtle-foreground/75">
          {machineMetaLine({ host, platformLabel, projectCount, now })}
        </p>
      </div>
      {/* Read-only here on purpose: the machine page owns the control, but the
          list still has to answer "which machines are capped?" at a glance. */}
      <span className={cn(MACHINE_LIMIT_COLUMN, "text-sm text-foreground")}>
        {PERMISSION_MODE_LABELS[host.maxPermissionMode]}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative -mr-1 h-7 w-7 shrink-0 data-[state=open]:bg-state-active data-[state=open]:text-foreground"
            aria-label={`${host.name} actions`}
          >
            <Icon name="MoreHorizontal" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
          {hostCanRetryUpdate(host) ? (
            <DropdownMenuItem
              disabled={retryUpdatePending}
              onSelect={onRetryUpdate}
            >
              {retryUpdatePending ? "Retrying update…" : "Retry update"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={isPrimary}
            title={isPrimary ? PRIMARY_REMOVE_DISABLED_REASON : undefined}
            onSelect={onRemove}
          >
            <span className="min-w-0 flex-1">
              Remove machine
              {isPrimary ? (
                <span className="block text-2xs text-subtle-foreground">
                  {PRIMARY_REMOVE_DISABLED_REASON}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsRow>
  );
}

/**
 * Settings → Machines (multi-machine plan §4.3, Mockup C): the live host
 * list with rename/remove management and the add-a-machine pairing flow.
 */
export function MachinesSettingsSection() {
  const systemConfig = useSystemConfig();
  const hostsQuery = useHosts();
  const sidebarNavigationQuery = useSidebarNavigation();
  const renameHost = useRenameHost();
  const removeHost = useRemoveHost();
  const retryHostUpdate = useRetryHostUpdate();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Host | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Host | null>(null);

  const hosts = hostsQuery.data;
  const serverPrimaryHostId = systemConfig.data?.primaryHostId ?? null;
  const primaryHostId = useMemo(
    () => selectPrimaryHost(hosts, serverPrimaryHostId)?.id ?? null,
    [hosts, serverPrimaryHostId],
  );
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

  return (
    <>
      <SettingsSection
        title="Machines"
        description={MACHINES_SECTION_DESCRIPTION}
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
        ) : hosts.length === 0 ? (
          <p className="text-sm text-subtle-foreground">No machines yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border pb-2.5 text-2xs uppercase tracking-wide text-subtle-foreground">
              <span className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">Machine</span>
              <span className={MACHINE_LIMIT_COLUMN}>Permission limit</span>
              <span className="w-6 shrink-0" aria-hidden />
            </div>
            <div className="pt-2.5">
              <SettingsRowList>
                {hosts.map((host) => (
                  <MachineRow
                    key={host.id}
                    host={host}
                    isPrimary={host.id === primaryHostId}
                    platformLabel={
                      host.id === primaryHostId && primaryHostPlatform !== null
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
                      removeHost.reset();
                      setRemoveTarget(host);
                    }}
                    onRetryUpdate={() =>
                      retryHostUpdate.mutate(host.id, {
                        onSuccess: () => {
                          appToast.success(
                            `Update retry requested for ${host.name}`,
                          );
                        },
                      })
                    }
                    retryUpdatePending={
                      retryHostUpdate.isPending &&
                      retryHostUpdate.variables === host.id
                    }
                  />
                ))}
              </SettingsRowList>
            </div>
          </>
        )}
      </SettingsSection>

      <AddMachineDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        serverUrl={systemConfig.data?.serverUrl ?? null}
      />

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

      <ConfirmDeleteDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removeHost.isPending) setRemoveTarget(null);
        }}
      >
        {removeTarget ? (
          <>
            <DialogHeader>
              <DialogTitle>Remove {removeTarget.name}?</DialogTitle>
              <DialogDescription>
                This revokes {removeTarget.name}'s access to this server.
                Project checkouts stay on its disk, but its environments become
                read-only history and it can't run new work until it's paired
                again.
              </DialogDescription>
            </DialogHeader>
            {removeHost.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {getMutationErrorMessage({
                  error: removeHost.error,
                  fallbackMessage: `Couldn't remove ${removeTarget.name}.`,
                })}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="destructive"
                disabled={removeHost.isPending}
                onClick={() =>
                  removeHost.mutate(removeTarget.id, {
                    onSuccess: () => setRemoveTarget(null),
                  })
                }
              >
                Remove machine
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </ConfirmDeleteDialog>
    </>
  );
}
