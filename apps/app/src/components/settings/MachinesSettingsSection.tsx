import { useMemo, useState, type FormEvent } from "react";
import type { Host } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
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
import { Input } from "@bb/shared-ui/input";
import { AddMachineDialog } from "@/components/dialogs/AddMachineDialog";
import { ConfirmDeleteDialog } from "@/components/dialogs/ConfirmDeleteDialog";
import { useRenameDialogAutoFocus } from "@/components/dialogs/useRenameDialogAutoFocus.js";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { useRemoveHost, useRenameHost } from "@/hooks/mutations/host-mutations";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { PersistentHostIconName } from "@/lib/host-display";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { formatRelativeTime } from "@/lib/relative-time";
import { formatHostUpdateStatus } from "@/lib/host-update-status";

const MACHINES_SECTION_DESCRIPTION =
  "Computers that can run your tasks. Pair a machine to run projects and threads on it.";

const PRIMARY_REMOVE_DISABLED_REASON =
  "This machine runs bb and can't be removed.";

/** Server-side limit from `updateHostRequestSchema`. */
const HOST_NAME_MAX_LENGTH = 100;

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
}

function MachineRow({
  host,
  isPrimary,
  platformLabel,
  projectCount,
  now,
  onRename,
  onRemove,
}: MachineRowProps) {
  return (
    <SettingsRow>
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
        <p className="text-xs text-subtle-foreground/75">
          {machineMetaLine({ host, platformLabel, projectCount, now })}
        </p>
      </div>
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
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
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

interface MachineRenameDialogProps {
  target: Host | null;
  pending: boolean;
  errorMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onRename: (host: Host, name: string) => void;
}

function MachineRenameDialog({
  target,
  pending,
  errorMessage,
  onOpenChange,
  onRename,
}: MachineRenameDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={handleOpenAutoFocus}>
        {target ? (
          <MachineRenameDialogContent
            key={target.id}
            target={target}
            pending={pending}
            errorMessage={errorMessage}
            onRename={onRename}
            inputRef={inputRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MachineRenameDialogContent({
  target,
  pending,
  errorMessage,
  onRename,
  inputRef,
}: {
  target: Host;
  pending: boolean;
  errorMessage: string | null;
  onRename: (host: Host, name: string) => void;
  inputRef: ReturnType<typeof useRenameDialogAutoFocus>["inputRef"];
}) {
  const [nextName, setNextName] = useState(target.name);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const trimmed = nextName.trim();
    if (trimmed.length === 0) return;
    onRename(target, trimmed);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename machine</DialogTitle>
        <DialogDescription>
          Choose a new name for {target.name}.
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Input
            ref={inputRef}
            aria-label="Machine name"
            value={nextName}
            maxLength={HOST_NAME_MAX_LENGTH}
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => setNextName(event.target.value)}
          />
          {errorMessage !== null ? (
            <p className="text-sm text-destructive">{errorMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="submit"
            disabled={pending || nextName.trim().length === 0}
          >
            Rename machine
          </Button>
        </DialogFooter>
      </form>
    </>
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
              />
            ))}
          </SettingsRowList>
        )}
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
