import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
// Route views render icons outside the shell's core set. Importing the
// extended registry here ships it as a static dependency of this route chunk,
// so those icons never flash blank waiting for an on-demand load.
import "@bb/shared-ui/icon-extended";
import type { Host, PermissionMode } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "@bb/shared-ui/dialog";
import { DialogDescription } from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { ConfirmDeleteDialog } from "@/components/dialogs/ConfirmDeleteDialog";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  SettingsBadge,
  SettingsSection,
} from "@/components/ui/settings-section";
import { appToast } from "@/components/ui/app-toast";
import { MachineRenameDialog } from "@/components/settings/MachineRenameDialog";
import {
  useRemoveHost,
  useRenameHost,
  useRetryHostUpdate,
  useUpdateHostPermissionCeiling,
} from "@/hooks/mutations/host-mutations";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateInventory } from "@/hooks/useUpdateInventory";
import {
  formatHostUpdateStatus,
  hostCanRetryUpdate,
} from "@/lib/host-update-status";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { PERMISSION_MODE_OPTIONS } from "@/lib/permission-mode-options";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  getProjectSettingsRoutePath,
  getSettingsRoutePath,
} from "@/lib/route-paths";

const PRIMARY_REMOVE_DISABLED_REASON =
  "This machine runs bb and can't be removed.";

const PERMISSION_LIMIT_DESCRIPTION =
  "Highest permission mode any thread on this machine may run with. Threads that ask for more resolve down to it, and a provider that supports nothing this low can't run here.";

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
  const parts: string[] = [];
  if (host.status === "connected") {
    parts.push("Online");
  } else if (host.lastSeenAt !== null) {
    parts.push(
      `Offline · last seen ${formatRelativeTime({ timestamp: host.lastSeenAt, now })}`,
    );
  } else {
    parts.push("Offline");
  }
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

/**
 * Radio cards rather than a picker: this page has room for each mode's
 * description, which is the whole reason the limit lives here.
 */
function PermissionLimitCards({
  disabled,
  onSelect,
  value,
}: PermissionLimitCardProps) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Permission limit">
      {PERMISSION_MODE_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => {
              if (!selected) onSelect(option.value);
            }}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-lg border px-3.5 py-3 text-left transition-colors",
              selected
                ? "border-foreground/40 bg-state-hover"
                : "border-border hover:bg-state-hover",
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
                <span className="mt-0.5 block text-xs leading-snug text-subtle-foreground/85">
                  {option.description}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface DetailRowProps {
  label: string;
  children: ReactNode;
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm first:pt-0 last:pb-0">
      <span className="text-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2 text-right text-subtle-foreground">
        {children}
      </div>
    </div>
  );
}

export function MachineSettingsView() {
  const { hostId } = useParams<{ hostId: string }>();
  const navigate = useNavigate();
  const hostsQuery = useHosts();
  const systemConfig = useSystemConfig();
  const sidebarNavigationQuery = useSidebarNavigation();
  const updateInventory = useUpdateInventory();
  const renameHost = useRenameHost();
  const removeHost = useRemoveHost();
  const retryHostUpdate = useRetryHostUpdate();
  const updatePermissionCeiling = useUpdateHostPermissionCeiling();
  const [renameOpen, setRenameOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const hosts = hostsQuery.data;
  const host = hosts?.find((candidate) => candidate.id === hostId) ?? null;
  const primaryHostId =
    selectPrimaryHost(hosts, systemConfig.data?.primaryHostId ?? null)?.id ??
    null;
  const isPrimary = host !== null && host.id === primaryHostId;

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
  const providerSummary = useMemo(() => {
    const status = machine?.providerStatus;
    if (!status) return null;
    return Object.values(status)
      .filter((entry) => entry.installed)
      .map((entry) =>
        entry.currentVersion
          ? `${entry.displayName} ${entry.currentVersion}`
          : entry.displayName,
      )
      .join(" · ");
  }, [machine?.providerStatus]);

  const now = Date.now();
  const platformLabel =
    isPrimary && systemConfig.data?.primaryHostPlatform
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
            This machine is no longer paired.
          </p>
        </div>
      </PageShell>
    );
  }

  const updateStatus = formatHostUpdateStatus(host);

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6 pb-10">
        <div className="space-y-3">
          <Link
            to={getSettingsRoutePath("machines")}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <Icon name="ChevronLeft" className="size-3.5" />
            Machines
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <MachineStatusDot connected={host.status === "connected"} />
                <h1 className="min-w-0 truncate text-xl font-semibold text-foreground">
                  {host.name}
                </h1>
                {isPrimary ? <SettingsBadge>this machine</SettingsBadge> : null}
              </div>
              <p className="mt-1 text-xs text-subtle-foreground/75">
                {headerMeta({ host, platformLabel, now })}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                renameHost.reset();
                setRenameOpen(true);
              }}
            >
              Rename
            </Button>
          </div>
        </div>

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
                    appToast.error(
                      getMutationErrorMessage({
                        error,
                        fallbackMessage: `Couldn't change the permission limit for ${host.name}.`,
                      }),
                    );
                  },
                },
              )
            }
          />
        </SettingsSection>

        <SettingsSection title="This machine">
          <div className="divide-y divide-border">
            <DetailRow label="Projects">
              {projects.length === 0 ? (
                <span>None</span>
              ) : (
                <span className="min-w-0 truncate">
                  {projects.map((project, index) => (
                    <span key={project.id}>
                      {index > 0 ? " · " : ""}
                      <Link
                        to={getProjectSettingsRoutePath(project.id)}
                        className="hover:text-foreground"
                      >
                        {project.name}
                      </Link>
                    </span>
                  ))}
                </span>
              )}
            </DetailRow>
            <DetailRow label="Provider CLIs">
              {host.status !== "connected" ? (
                <span>Unavailable while offline</span>
              ) : machine?.statusPending ? (
                <span>Checking…</span>
              ) : machine?.statusError ? (
                <span>Status unavailable</span>
              ) : (
                <>
                  <span className="min-w-0 truncate">
                    {providerSummary && providerSummary.length > 0
                      ? providerSummary
                      : "None installed"}
                  </span>
                  {machine && machine.issues.length > 0 ? (
                    <Link
                      to={getSettingsRoutePath("updates")}
                      className="shrink-0 text-warning-text hover:text-foreground"
                    >
                      {machine.issues.length} to fix
                    </Link>
                  ) : null}
                </>
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
          </div>
        </SettingsSection>

        <SettingsSection
          title="Danger zone"
          description={
            isPrimary
              ? PRIMARY_REMOVE_DISABLED_REASON
              : `Revokes ${host.name}'s access to this server. Project checkouts stay on its disk.`
          }
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPrimary}
            className="text-destructive-text hover:text-destructive-text"
            onClick={() => {
              removeHost.reset();
              setRemoveOpen(true);
            }}
          >
            Remove machine
          </Button>
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

      <ConfirmDeleteDialog
        open={removeOpen}
        onOpenChange={(open) => {
          if (!open && !removeHost.isPending) setRemoveOpen(false);
        }}
      >
        <DialogHeader>
          <DialogTitle>Remove {host.name}?</DialogTitle>
          <DialogDescription>
            This revokes {host.name}'s access to this server. Project checkouts
            stay on its disk, but its environments become read-only history and
            it can't run new work until it's paired again.
          </DialogDescription>
        </DialogHeader>
        {removeHost.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {getMutationErrorMessage({
              error: removeHost.error,
              fallbackMessage: `Couldn't remove ${host.name}.`,
            })}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="destructive"
            disabled={removeHost.isPending}
            onClick={() =>
              removeHost.mutate(host.id, {
                onSuccess: () => {
                  setRemoveOpen(false);
                  navigate(getSettingsRoutePath("machines"));
                },
              })
            }
          >
            Remove machine
          </Button>
        </DialogFooter>
      </ConfirmDeleteDialog>
    </PageShell>
  );
}
