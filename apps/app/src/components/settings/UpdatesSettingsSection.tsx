import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import type { SystemVersionResponse } from "@bb/server-contract";
import { Button, type ButtonProps } from "@bb/shared-ui/button";
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

function RowButton({ className, ...props }: ButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("h-6 px-2 text-xs", className)}
      {...props}
    />
  );
}

/**
 * A card whose rows are a shared 4-column grid (name / version / state /
 * action) via subgrid, so the columns line up across every row.
 */
export function UpdatesRowList({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4">
      {children}
    </div>
  );
}

function UpdatesRow({ children }: { children: ReactNode }) {
  return (
    <div className="col-span-4 grid grid-cols-subgrid items-center border-t border-border py-2.5 text-sm first:border-t-0 first:pt-0 last:pb-0">
      {children}
    </div>
  );
}

function NameCell({
  indent,
  children,
}: {
  indent?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 truncate text-foreground",
        indent && "pl-4",
      )}
    >
      {children}
    </span>
  );
}

function VersionCell({
  current,
  latest,
}: {
  current: string | null;
  latest: string | null;
}) {
  if (current === null && latest === null) {
    return <span />;
  }
  if (current === null) {
    return (
      <span className="justify-self-end font-mono text-xs font-semibold text-foreground">
        {latest}
      </span>
    );
  }
  return (
    <span className="justify-self-end font-mono text-xs text-muted-foreground">
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

function StateCell({
  tone,
  children,
}: {
  tone: "subtle" | "attention" | "destructive";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-xs",
        tone === "subtle" && "text-subtle-foreground",
        tone === "attention" && "text-foreground",
        tone === "destructive" && "text-destructive-text",
      )}
    >
      {children}
    </span>
  );
}

function ActionCell({ children }: { children?: ReactNode }) {
  return (
    <span className="flex min-w-14 justify-end">{children ?? null}</span>
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
    const pendingVersion =
      desktopInfo.pendingVersion ?? desktopInfo.latestVersion;
    return (
      <UpdatesRow>
        <NameCell>
          <span className="truncate font-medium">bb desktop</span>
        </NameCell>
        <VersionCell
          current={desktopInfo.version}
          latest={desktopInfo.updateAvailable ? pendingVersion : null}
        />
        {desktopInfo.updateDownloaded ? (
          <>
            <StateCell tone="attention">Downloaded</StateCell>
            <ActionCell>
              <RowButton onClick={() => onRelaunchDesktop?.()}>
                Relaunch
              </RowButton>
            </ActionCell>
          </>
        ) : desktopInfo.updateAvailable ? (
          <>
            <StateCell tone="attention">Downloading in the background…</StateCell>
            <ActionCell />
          </>
        ) : (
          <>
            <StateCell tone="subtle">Up to date</StateCell>
            <ActionCell />
          </>
        )}
      </UpdatesRow>
    );
  }

  if (systemVersion === undefined) {
    return (
      <UpdatesRow>
        <NameCell>
          <span className="truncate font-medium">bb-app</span>
        </NameCell>
        <span />
        <StateCell tone="subtle">Checking…</StateCell>
        <ActionCell />
      </UpdatesRow>
    );
  }

  return (
    <UpdatesRow>
      <NameCell>
        <span className="truncate font-medium">bb-app</span>
        {systemVersion.updateAvailable ? (
          <code className="ml-1.5 shrink-0 rounded-sm bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {systemVersion.upgradeCommand}
          </code>
        ) : null}
      </NameCell>
      <VersionCell
        current={systemVersion.currentVersion}
        latest={
          systemVersion.updateAvailable ? systemVersion.latestVersion : null
        }
      />
      {systemVersion.isDevelopment ? (
        <>
          <StateCell tone="subtle">Development mode</StateCell>
          <ActionCell />
        </>
      ) : systemVersion.updateAvailable ? (
        <>
          <StateCell tone="attention">Available</StateCell>
          <ActionCell>
            <RowButton
              onClick={() => {
                void navigator.clipboard
                  .writeText(systemVersion.upgradeCommand)
                  .then(() => appToast.success("Upgrade command copied"))
                  .catch(() => undefined);
              }}
            >
              Copy
            </RowButton>
          </ActionCell>
        </>
      ) : (
        <>
          <StateCell tone="subtle">Up to date</StateCell>
          <ActionCell />
        </>
      )}
    </UpdatesRow>
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
      <UpdatesRow>
        <NameCell>
          <MachineStatusDot connected={host.status === "connected"} />
          <span className="truncate font-medium">{host.name}</span>
          {machine.isPrimary ? (
            <SettingsBadge>this machine</SettingsBadge>
          ) : null}
        </NameCell>
        <span />
        {machine.canRetryDaemonUpdate ? (
          <>
            <StateCell tone="destructive">
              {daemonUpdateStatus ?? "Needs update"}
            </StateCell>
            <ActionCell>
              <RowButton
                disabled={retryUpdatePending}
                onClick={() => onRetryDaemonUpdate(host.id)}
              >
                {retryUpdatePending ? "Retrying…" : "Retry update"}
              </RowButton>
            </ActionCell>
          </>
        ) : host.status === "connected" ? (
          <>
            <StateCell tone="subtle">In sync</StateCell>
            <ActionCell />
          </>
        ) : (
          <>
            <StateCell tone="subtle">
              Offline — connect to check for updates
            </StateCell>
            <ActionCell />
          </>
        )}
      </UpdatesRow>
      {host.status !== "connected" ? null : machine.statusError ? (
        <UpdatesRow>
          <span className="col-span-3 pl-4 text-xs text-destructive-text">
            Couldn't check provider CLIs on this machine.
          </span>
          <ActionCell />
        </UpdatesRow>
      ) : machine.statusPending || machine.providerStatus === null ? (
        <UpdatesRow>
          <span className="col-span-3 pl-4 text-xs text-subtle-foreground">
            Checking provider CLIs…
          </span>
          <ActionCell />
        </UpdatesRow>
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
            <UpdatesRow key={provider}>
              <NameCell indent>
                <span className="truncate">{status.displayName}</span>
              </NameCell>
              <VersionCell
                current={status.currentVersion}
                latest={issue !== null ? status.latestVersion : null}
              />
              {running ? (
                <StateCell tone="attention">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="Spinner" className="size-3 animate-spin" />
                    Running…
                  </span>
                </StateCell>
              ) : queued ? (
                <StateCell tone="subtle">Queued</StateCell>
              ) : (
                <StateCell tone={state.tone}>{state.label}</StateCell>
              )}
              <ActionCell>
                {issue !== null &&
                hasProviderCliAction(issue) &&
                !running &&
                !queued ? (
                  <RowButton onClick={() => onStartInstall(host.id, issue)}>
                    {issue.action.label}
                  </RowButton>
                ) : null}
              </ActionCell>
            </UpdatesRow>
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

  const actionableIssues: {
    hostId: string;
    issue: ProviderCliActionableIssue;
  }[] = inventory.machines.flatMap((machine) =>
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
          <div className="flex items-center gap-1">
            <RowButton onClick={() => openUrlInExternalBrowser(CHANGELOG_URL)}>
              What's new
              <Icon name="ExternalLink" className="size-3.5" />
            </RowButton>
            <RowButton
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
            </RowButton>
          </div>
        }
      >
        <UpdatesRowList>
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
        </UpdatesRowList>
      </SettingsSection>

      <SettingsSection
        title="Machines"
        description="Provider CLIs installed on each connected machine."
        action={
          <RowButton
            disabled={actionableIssues.length === 0}
            onClick={() => {
              for (const { hostId, issue } of actionableIssues) {
                startInstall({ hostId, issue });
              }
            }}
          >
            Update all
            {actionableIssues.length > 0 ? ` (${actionableIssues.length})` : ""}
          </RowButton>
        }
      >
        {inventory.machines.length === 0 ? (
          <p className="text-sm text-subtle-foreground">
            {inventory.isLoading ? "Loading…" : "No machines yet."}
          </p>
        ) : (
          <UpdatesRowList>
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
          </UpdatesRowList>
        )}
      </SettingsSection>
      {installLogDialog}
    </>
  );
}
