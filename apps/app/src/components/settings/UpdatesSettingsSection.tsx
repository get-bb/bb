import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import type { SystemVersionResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  hasProviderCliAction,
  providerCliJobKey,
  useProviderCliInstallRunner,
  type ProviderCliActionableIssue,
  type ProviderCliIssue,
} from "@/components/provider-cli/provider-cli-install";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { appToast } from "@/components/ui/app-toast";
import { invalidateHostProviderCliStatus } from "@/hooks/cache-owners/provider-cli-status-cache-owner";
import { hydrateSystemVersionCache } from "@/hooks/cache-owners/system-version-cache-owner";
import { useRetryHostUpdate } from "@/hooks/mutations/host-mutations";
import {
  useUpdateInventory,
  type UpdateInventoryMachine,
} from "@/hooks/useUpdateInventory";
import { useDesktopUpdateInfo } from "@/hooks/useDesktopUpdateInfo";
import { formatHostUpdateStatus } from "@/lib/host-update-status";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import { sdk } from "@/lib/sdk";

const CHANGELOG_URL = "https://github.com/ymichael/bb/blob/main/CHANGELOG.md";

function updateCheckErrorDescription(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "The update check did not complete.";
}

function VersionArrow({
  current,
  latest,
}: {
  current: string | null;
  latest: string | null;
}) {
  if (current === null && latest === null) {
    return null;
  }
  if (current === null) {
    return (
      <span className="shrink-0 font-mono text-xs font-semibold text-foreground">
        {latest}
      </span>
    );
  }
  return (
    <span className="shrink-0 font-mono text-xs text-muted-foreground">
      {current}
      {latest !== null && latest !== current ? (
        <>
          <span className="px-1 text-subtle-foreground">→</span>
          <span className="font-semibold text-foreground">{latest}</span>
        </>
      ) : null}
    </span>
  );
}

function RowState({
  tone,
  children,
}: {
  tone: "subtle" | "attention" | "destructive";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "shrink-0 text-xs",
        tone === "subtle" && "text-subtle-foreground",
        tone === "attention" && "text-foreground",
        tone === "destructive" && "text-destructive-text",
      )}
    >
      {children}
    </span>
  );
}

export interface BbAppUpdateRowsProps {
  systemVersion: SystemVersionResponse | undefined;
  desktopInfo: BbDesktopInfo | null;
  onRelaunchDesktop: (() => void) | null;
}

/**
 * The bb app's own row: on desktop the shell auto-downloads and applies on
 * relaunch; on web/npm installs the server can't replace itself, so the row
 * surfaces the upgrade command instead of a fake update button.
 */
export function BbAppUpdateRows({
  systemVersion,
  desktopInfo,
  onRelaunchDesktop,
}: BbAppUpdateRowsProps) {
  if (desktopInfo !== null) {
    const pendingVersion = desktopInfo.pendingVersion ?? desktopInfo.latestVersion;
    return (
      <SettingsRow>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          bb desktop
        </span>
        <VersionArrow
          current={desktopInfo.version}
          latest={desktopInfo.updateAvailable ? pendingVersion : null}
        />
        {desktopInfo.updateDownloaded ? (
          <>
            <RowState tone="attention">Downloaded</RowState>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onRelaunchDesktop?.()}
            >
              Relaunch
            </Button>
          </>
        ) : desktopInfo.updateAvailable ? (
          <RowState tone="attention">Downloading in the background…</RowState>
        ) : (
          <RowState tone="subtle">Up to date</RowState>
        )}
      </SettingsRow>
    );
  }

  if (systemVersion === undefined) {
    return (
      <SettingsRow>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          bb-app
        </span>
        <RowState tone="subtle">Checking…</RowState>
      </SettingsRow>
    );
  }

  return (
    <SettingsRow>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        bb-app
      </span>
      <VersionArrow
        current={systemVersion.currentVersion}
        latest={systemVersion.updateAvailable ? systemVersion.latestVersion : null}
      />
      {systemVersion.isDevelopment ? (
        <RowState tone="subtle">Development mode</RowState>
      ) : systemVersion.updateAvailable ? (
        <>
          <RowState tone="attention">Available</RowState>
          <code className="shrink-0 rounded-sm bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {systemVersion.upgradeCommand}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard
                .writeText(systemVersion.upgradeCommand)
                .then(() => appToast.success("Upgrade command copied"))
                .catch(() => undefined);
            }}
          >
            Copy
          </Button>
        </>
      ) : (
        <RowState tone="subtle">Up to date</RowState>
      )}
    </SettingsRow>
  );
}

export interface MachineUpdatesRowsProps {
  machine: UpdateInventoryMachine;
  runningJobKey: string | null;
  queuedJobKeys: ReadonlySet<string>;
  retryUpdatePending: boolean;
  onStartInstall: (hostId: string, issue: ProviderCliActionableIssue) => void;
  onRetryDaemonUpdate: (hostId: string) => void;
}

function providerRowState({
  issue,
  installed,
}: {
  issue: ProviderCliIssue | null;
  installed: boolean;
}): { label: string; tone: "subtle" | "attention" | "destructive" } {
  if (!installed) {
    return { label: "Not installed", tone: "subtle" };
  }
  if (issue === null) {
    return { label: "Up to date", tone: "subtle" };
  }
  if (issue.status.versionUnsupported) {
    return { label: "Update needed", tone: "destructive" };
  }
  return { label: "Available", tone: "attention" };
}

/** One machine's rows: a host header row, then a row per provider CLI. */
export function MachineUpdatesRows({
  machine,
  runningJobKey,
  queuedJobKeys,
  retryUpdatePending,
  onStartInstall,
  onRetryDaemonUpdate,
}: MachineUpdatesRowsProps) {
  const { host } = machine;
  const issuesByProvider = new Map(
    machine.issues.map((issue) => [issue.provider, issue]),
  );
  const daemonUpdateStatus = formatHostUpdateStatus(host);

  return (
    <>
      <SettingsRow>
        <MachineStatusDot connected={host.status === "connected"} />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {host.name}
        </span>
        {machine.isPrimary ? <SettingsBadge>this machine</SettingsBadge> : null}
        <span className="flex-1" />
        {machine.canRetryDaemonUpdate ? (
          <>
            <RowState tone="destructive">
              {daemonUpdateStatus ?? "Needs update"}
            </RowState>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retryUpdatePending}
              onClick={() => onRetryDaemonUpdate(host.id)}
            >
              {retryUpdatePending ? "Retrying…" : "Retry update"}
            </Button>
          </>
        ) : host.status === "connected" ? (
          <RowState tone="subtle">Follows the server version</RowState>
        ) : (
          <RowState tone="subtle">
            Offline — connect to check for updates
          </RowState>
        )}
      </SettingsRow>
      {host.status !== "connected" ? null : machine.statusError ? (
        <SettingsRow>
          <span className="pl-4 text-xs text-destructive-text">
            Couldn't check provider CLIs on this machine.
          </span>
        </SettingsRow>
      ) : machine.statusPending || machine.providerStatus === null ? (
        <SettingsRow>
          <span className="pl-4 text-xs text-subtle-foreground">
            Checking provider CLIs…
          </span>
        </SettingsRow>
      ) : (
        (["codex", "claudeCode"] as const).map((provider) => {
          const status = machine.providerStatus?.[provider];
          if (status === undefined) {
            return null;
          }
          const issue = issuesByProvider.get(provider) ?? null;
          const state = providerRowState({
            issue,
            installed: status.installed,
          });
          const jobKey = providerCliJobKey(host.id, provider);
          const running = runningJobKey === jobKey;
          const queued = queuedJobKeys.has(jobKey);
          return (
            <SettingsRow key={provider}>
              <span className="min-w-0 flex-1 truncate pl-4 text-sm text-foreground">
                {status.displayName}
              </span>
              <VersionArrow
                current={status.currentVersion}
                latest={issue !== null ? status.latestVersion : null}
              />
              {running ? (
                <RowState tone="attention">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="Spinner" className="size-3 animate-spin" />
                    Running…
                  </span>
                </RowState>
              ) : queued ? (
                <RowState tone="subtle">Queued</RowState>
              ) : (
                <RowState tone={state.tone}>{state.label}</RowState>
              )}
              {issue !== null &&
              hasProviderCliAction(issue) &&
              !running &&
              !queued ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onStartInstall(host.id, issue)}
                >
                  {issue.action.label}
                </Button>
              ) : null}
            </SettingsRow>
          );
        })
      )}
    </>
  );
}

/**
 * Settings → Updates: one consolidated, per-machine view of bb and provider
 * CLI updates. Replaces the stacked update/provider-health toasts (BB-48).
 */
export function UpdatesSettingsSection() {
  const queryClient = useQueryClient();
  const inventory = useUpdateInventory();
  const { desktopApi, desktopInfo } = useDesktopUpdateInfo();
  const retryHostUpdate = useRetryHostUpdate();
  const [isChecking, setIsChecking] = useState(false);
  const { installLogDialog, queuedJobKeys, runningJobKey, startInstall } =
    useProviderCliInstallRunner({
      onStatusUpdated: (hostId) => {
        void invalidateHostProviderCliStatus({ queryClient, hostId });
      },
    });

  const actionableIssues: { hostId: string; issue: ProviderCliActionableIssue }[] =
    inventory.machines.flatMap((machine) =>
      machine.issues
        .filter(hasProviderCliAction)
        .map((issue) => ({ hostId: machine.host.id, issue })),
    );

  async function handleCheckForUpdates(): Promise<void> {
    if (isChecking) {
      return;
    }
    setIsChecking(true);
    try {
      if (desktopApi !== null) {
        await desktopApi.checkForUpdates();
      } else {
        const version = await sdk.system.version({ force: true });
        hydrateSystemVersionCache({ queryClient, version });
      }
      await Promise.all(
        inventory.machines
          .filter((machine) => machine.host.status === "connected")
          .map((machine) =>
            invalidateHostProviderCliStatus({
              queryClient,
              hostId: machine.host.id,
            }),
          ),
      );
    } catch (error: unknown) {
      appToast.error("Update check failed", {
        description: updateCheckErrorDescription(error),
      });
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <>
      <SettingsSection
        title="bb"
        description="The bb app updates here; connected machines follow the server version automatically."
        action={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => openUrlInExternalBrowser(CHANGELOG_URL)}
            >
              What's new
              <Icon name="ExternalLink" className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-busy={isChecking}
              disabled={isChecking}
              onClick={() => {
                void handleCheckForUpdates();
              }}
            >
              <Icon
                name={isChecking ? "Spinner" : "RotateCcw"}
                className={cn("size-3.5", isChecking && "animate-spin")}
              />
              {isChecking ? "Checking" : "Check for updates"}
            </Button>
          </div>
        }
      >
        <SettingsRowList>
          <BbAppUpdateRows
            systemVersion={inventory.systemVersion}
            desktopInfo={desktopInfo}
            onRelaunchDesktop={
              desktopApi === null
                ? null
                : () => {
                    void desktopApi.installUpdate().catch((error: unknown) => {
                      appToast.error("Relaunch failed", {
                        description: updateCheckErrorDescription(error),
                      });
                    });
                  }
            }
          />
        </SettingsRowList>
      </SettingsSection>

      <SettingsSection
        title="Machines"
        description="Provider CLIs installed on each connected machine."
        action={
          <Button
            type="button"
            size="sm"
            disabled={actionableIssues.length === 0}
            onClick={() => {
              for (const { hostId, issue } of actionableIssues) {
                startInstall({ hostId, issue });
              }
            }}
          >
            Update all
            {actionableIssues.length > 0 ? ` (${actionableIssues.length})` : ""}
          </Button>
        }
      >
        {inventory.machines.length === 0 ? (
          <p className="text-sm text-subtle-foreground">
            {inventory.isLoading ? "Loading…" : "No machines yet."}
          </p>
        ) : (
          <SettingsRowList>
            {inventory.machines.map((machine) => (
              <MachineUpdatesRows
                key={machine.host.id}
                machine={machine}
                runningJobKey={runningJobKey}
                queuedJobKeys={queuedJobKeys}
                retryUpdatePending={
                  retryHostUpdate.isPending &&
                  retryHostUpdate.variables === machine.host.id
                }
                onStartInstall={(hostId, issue) =>
                  startInstall({ hostId, issue })
                }
                onRetryDaemonUpdate={(hostId) =>
                  retryHostUpdate.mutate(hostId, {
                    onSuccess: () => {
                      appToast.success(
                        `Update retry requested for ${machine.host.name}`,
                      );
                    },
                  })
                }
              />
            ))}
          </SettingsRowList>
        )}
      </SettingsSection>
      {installLogDialog}
    </>
  );
}
