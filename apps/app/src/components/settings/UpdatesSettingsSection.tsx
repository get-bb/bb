import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import type { SystemVersionResponse } from "@bb/server-contract";
import { Button, type ButtonProps } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  hasProviderCliAction,
  useProviderCliInstallRunner,
  type ProviderCliActionableIssue,
  type ProviderCliIssue,
} from "@/components/provider-cli/provider-cli-install";
import { providerCliJobKey } from "@/components/provider-cli/provider-cli-install-store";
import {
  getAppUpdateCheckSnapshot,
  startAppUpdateCheck,
  subscribeAppUpdateCheck,
} from "@/components/settings/app-update-check-store";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { SettingsBadge } from "@/components/ui/settings-section";
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
import { formatRelativeTime } from "@/lib/relative-time";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import { sdk } from "@/lib/sdk";

const CHANGELOG_URL = "https://github.com/get-bb/bb/blob/main/CHANGELOG.md";

/**
 * The rows and the machine bands above them share one text edge: names start
 * at `pl-7` (28px), and the status dot sits centred on `left-3.5` (14px) —
 * the same column the child rows' hairline spine runs down. The dot therefore
 * caps the spine instead of pushing the machine name out of alignment.
 */
const GUTTER_TEXT = "pl-7";
const GUTTER_MARK = "absolute left-3.5 top-0 flex h-8 w-0 items-center";

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

export interface UpdatesSectionProps {
  title: string;
  /** Right-hand slot: the freshness stamp and any section-wide action. */
  action?: ReactNode;
  /** Quiet line below the card, for the one caveat worth stating. */
  footnote?: string;
  children: ReactNode;
}

/**
 * A settings section whose card is flush — rows run edge to edge so their
 * separators and machine bands are full-bleed. Deliberately not
 * `SettingsSection`, whose padded card would inset every row.
 */
export function UpdatesSection({
  title,
  action,
  footnote,
  children,
}: UpdatesSectionProps) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={titleId} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        {action !== undefined ? (
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {action}
          </div>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </div>
      {footnote !== undefined ? (
        <p className="text-xs text-subtle-foreground">{footnote}</p>
      ) : null}
    </section>
  );
}

/** Groups rows so the first one drops its top separator. */
export function UpdatesRowList({ children }: { children: ReactNode }) {
  return (
    <div className="[&>*:first-child]:border-t-0 [&>*:first-child>*:first-child]:border-t-0">
      {children}
    </div>
  );
}

type RowTone = "default" | "attention" | "destructive";

function UpdatesRow({
  tone = "default",
  indent = false,
  children,
}: {
  tone?: RowTone;
  indent?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border/70 py-2 pr-3 text-sm",
        indent ? GUTTER_TEXT : "pl-3",
        tone === "attention" && "bg-surface-attention",
        tone === "destructive" && "bg-surface-destructive",
      )}
    >
      {indent ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-3.5 w-px -translate-x-1/2 bg-border/85"
        />
      ) : null}
      {children}
    </div>
  );
}

/**
 * Name and version read as one phrase ("Codex 0.146.0") instead of being split
 * across a wide gutter; the right edge belongs to state and actions only.
 */
function RowName({
  name,
  current,
  latest,
}: {
  name: string;
  current: string | null;
  latest: string | null;
}) {
  return (
    <span className="flex min-w-40 flex-1 items-baseline gap-2">
      <span className="truncate font-medium text-foreground">{name}</span>
      {/* No current version means nothing is installed here; showing `latest`
          alone would read as the version you have. The row's label says it. */}
      {current === null ? null : (
        <span className="shrink-0 font-mono text-xs text-readback-foreground">
          {current}
          {latest !== null && latest !== current ? (
            <>
              <span className="px-1 text-subtle-foreground">→</span>
              <span className="font-semibold text-foreground">{latest}</span>
            </>
          ) : null}
        </span>
      )}
    </span>
  );
}

/**
 * The right-hand slot. A healthy row passes nothing: "Up to date" repeated
 * down a column carried no information, so the settled state is now the
 * absence of a label and only exceptions speak.
 */
function RowStatus({
  tone = "subtle",
  live = false,
  children,
}: {
  tone?: "subtle" | "attention" | "destructive";
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
      className={cn(
        "text-xs",
        tone === "subtle" && "text-subtle-foreground",
        tone === "attention" && "text-warning-text",
        tone === "destructive" && "text-destructive-text",
      )}
    >
      {children}
    </span>
  );
}

function RowActions({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">{children}</span>
  );
}

export interface BbAppUpdateRowsProps {
  systemVersion: SystemVersionResponse | undefined;
  desktopInfo: BbDesktopInfo | null;
  isDesktop: boolean;
  onRelaunchDesktop: (() => void) | null;
  onRetryDesktop: (() => void) | null;
}

/**
 * The bb app's own row: on desktop the shell auto-downloads and applies on
 * relaunch; on web/npm installs the server can't replace itself, so the row
 * surfaces the upgrade command instead of a fake update button.
 */
export function BbAppUpdateRows({
  systemVersion,
  desktopInfo,
  isDesktop,
  onRelaunchDesktop,
  onRetryDesktop,
}: BbAppUpdateRowsProps) {
  if (isDesktop && desktopInfo === null) {
    return (
      <UpdatesRow>
        <RowName name="bb desktop" current={null} latest={null} />
        <RowActions>
          <RowStatus live>Checking…</RowStatus>
        </RowActions>
      </UpdatesRow>
    );
  }

  if (desktopInfo !== null) {
    const pendingVersion =
      desktopInfo.pendingVersion ?? desktopInfo.latestVersion;
    const latest = desktopInfo.updateAvailable ? pendingVersion : null;
    const name = (
      <RowName
        name="bb desktop"
        current={desktopInfo.version}
        latest={latest}
      />
    );

    if (desktopInfo.updateDownloaded) {
      return (
        <UpdatesRow tone="attention">
          {name}
          <RowActions>
            <RowStatus tone="attention">Downloaded</RowStatus>
            <RowButton onClick={() => onRelaunchDesktop?.()}>
              Relaunch
            </RowButton>
          </RowActions>
        </UpdatesRow>
      );
    }
    if (desktopInfo.downloadState === "downloading") {
      return (
        <UpdatesRow tone="attention">
          {name}
          <RowActions>
            <RowStatus live tone="attention">
              Downloading in the background…
            </RowStatus>
          </RowActions>
        </UpdatesRow>
      );
    }
    if (desktopInfo.downloadState === "failed") {
      return (
        <UpdatesRow tone="destructive">
          {name}
          <RowActions>
            <RowStatus tone="destructive">Download failed</RowStatus>
            <RowButton onClick={() => onRetryDesktop?.()}>Retry</RowButton>
          </RowActions>
        </UpdatesRow>
      );
    }
    if (desktopInfo.updateAvailable) {
      return (
        <UpdatesRow tone="attention">
          {name}
          <RowActions>
            <RowStatus tone="attention">Available</RowStatus>
          </RowActions>
        </UpdatesRow>
      );
    }
    return <UpdatesRow>{name}</UpdatesRow>;
  }

  if (systemVersion === undefined) {
    return (
      <UpdatesRow>
        <RowName name="bb-app" current={null} latest={null} />
        <RowActions>
          <RowStatus>Checking…</RowStatus>
        </RowActions>
      </UpdatesRow>
    );
  }

  const name = (
    <RowName
      name="bb-app"
      current={systemVersion.currentVersion}
      latest={
        systemVersion.updateAvailable ? systemVersion.latestVersion : null
      }
    />
  );

  if (systemVersion.isDevelopment) {
    return (
      <UpdatesRow>
        {name}
        <RowActions>
          <RowStatus>Development mode</RowStatus>
        </RowActions>
      </UpdatesRow>
    );
  }

  if (systemVersion.updateAvailable) {
    return (
      <UpdatesRow tone="attention">
        {name}
        <RowActions>
          <RowStatus tone="attention">Available</RowStatus>
          {/* The command sits with the button that copies it, rather than
              crowding the app name on the left. */}
          <code className="hidden rounded-sm bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-muted-foreground sm:inline">
            {systemVersion.upgradeCommand}
          </code>
          <RowButton
            onClick={() => {
              void navigator.clipboard
                .writeText(systemVersion.upgradeCommand)
                .then(() => appToast.success("Upgrade command copied"))
                .catch(() => {
                  appToast.error("Couldn't copy upgrade command");
                });
            }}
          >
            Copy
          </RowButton>
        </RowActions>
      </UpdatesRow>
    );
  }

  return <UpdatesRow>{name}</UpdatesRow>;
}

export interface MachineUpdatesRowsProps {
  machine: UpdateInventoryMachine;
  runningJobKey: string | null;
  queuedJobKeys: ReadonlySet<string>;
  retryUpdatePending: boolean;
  onStartInstall: (hostId: string, issue: ProviderCliActionableIssue) => void;
  onRetryDaemonUpdate: (hostId: string) => void;
}

interface ProviderRowState {
  label: string;
  rowTone: RowTone;
  statusTone: "subtle" | "attention" | "destructive";
}

function providerRowState({
  issue,
  installed,
}: {
  issue: ProviderCliIssue | null;
  installed: boolean;
}): ProviderRowState | null {
  if (!installed) {
    return { label: "Not installed", rowTone: "default", statusTone: "subtle" };
  }
  // Up to date: the version alone says it. No label, no tint.
  if (issue === null) {
    return null;
  }
  if (issue.action === null) {
    return {
      label: "Update manually",
      rowTone: issue.status.versionUnsupported ? "destructive" : "attention",
      statusTone: issue.status.versionUnsupported ? "destructive" : "attention",
    };
  }
  if (issue.status.versionUnsupported) {
    return {
      label: "Update needed",
      rowTone: "destructive",
      statusTone: "destructive",
    };
  }
  return { label: "Available", rowTone: "attention", statusTone: "attention" };
}

/** The band that heads a machine's rows. */
function MachineBand({
  connected,
  name,
  headingId,
  statusLabel,
  badge,
  detail,
  tone = "default",
  children,
}: {
  connected: boolean;
  name: string;
  headingId: string;
  statusLabel: string;
  badge?: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "destructive";
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-between gap-3 border-t text-sm",
        GUTTER_TEXT,
        "pr-3",
        tone === "destructive"
          ? "border-surface-destructive-border bg-surface-destructive"
          : "border-border/70 bg-surface-recessed",
        children === undefined ? "h-8" : "py-2",
      )}
    >
      <span aria-hidden className={GUTTER_MARK}>
        <MachineStatusDot
          connected={connected}
          className={cn(
            "-translate-x-1/2",
            // A stranded daemon is offline *and* broken; the shared hollow
            // ring alone reads as merely idle.
            tone === "destructive" && "border-destructive bg-destructive",
          )}
        />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <h3
            id={headingId}
            className="truncate text-xs font-semibold text-foreground"
          >
            {name}
            <span className="sr-only">, {statusLabel}</span>
          </h3>
          {badge}
        </span>
        {children}
      </span>
      {detail !== undefined ? <span className="shrink-0">{detail}</span> : null}
    </div>
  );
}

/** One machine's rows: a header band, then a row per provider CLI. */
export function MachineUpdatesRows({
  machine,
  runningJobKey,
  queuedJobKeys,
  retryUpdatePending,
  onStartInstall,
  onRetryDaemonUpdate,
}: MachineUpdatesRowsProps) {
  const { host } = machine;
  const headingId = useId();
  const issuesByProvider = new Map(
    machine.issues.map((issue) => [issue.provider, issue]),
  );

  /*
   * A protocol-rejected daemon is disconnected, so this machine has no
   * provider rows at all — the band has to carry the whole story on its own,
   * which is why it is the one header allowed to run multi-line. The raw
   * protocol numbers stay, demoted below the plain-language cause.
   */
  if (machine.canRetryDaemonUpdate) {
    const daemonStatus = formatHostUpdateStatus(host);
    return (
      <div role="group" aria-labelledby={headingId}>
        <MachineBand
          connected={false}
          tone="destructive"
          name={host.name}
          headingId={headingId}
          statusLabel="Agent update required"
          badge={
            machine.isPrimary ? (
              <SettingsBadge>this machine</SettingsBadge>
            ) : null
          }
          detail={
            <RowButton
              aria-busy={retryUpdatePending}
              disabled={retryUpdatePending}
              onClick={() => onRetryDaemonUpdate(host.id)}
            >
              {retryUpdatePending ? "Retrying…" : "Retry update"}
            </RowButton>
          }
        >
          <span className="text-xs text-destructive-text">
            Can't connect — its bb agent is out of date
          </span>
          <span className="text-2xs text-subtle-foreground">
            Usually it updates itself.
          </span>
          {daemonStatus === null ? null : (
            <span className="text-2xs text-subtle-foreground">
              {daemonStatus}
            </span>
          )}
        </MachineBand>
      </div>
    );
  }

  return (
    <div role="group" aria-labelledby={headingId}>
      <MachineBand
        connected={host.status === "connected"}
        name={host.name}
        headingId={headingId}
        statusLabel={host.status === "connected" ? "Connected" : "Offline"}
        badge={
          machine.isPrimary ? <SettingsBadge>this machine</SettingsBadge> : null
        }
        detail={
          host.status === "connected" ? undefined : (
            <RowStatus>Offline — connect to check for updates</RowStatus>
          )
        }
      />
      {host.status !== "connected" ? null : machine.statusError ? (
        <UpdatesRow indent>
          <RowStatus tone="destructive">
            Couldn't check provider CLIs on this machine.
          </RowStatus>
        </UpdatesRow>
      ) : machine.statusPending || machine.providerStatus === null ? (
        <UpdatesRow indent>
          <RowStatus live>Checking provider CLIs…</RowStatus>
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
          const actionable =
            issue !== null &&
            hasProviderCliAction(issue) &&
            !running &&
            !queued;
          return (
            <UpdatesRow
              key={provider}
              indent
              tone={
                running || queued ? "default" : (state?.rowTone ?? "default")
              }
            >
              <RowName
                name={status.displayName}
                current={status.currentVersion}
                latest={issue !== null ? status.latestVersion : null}
              />
              <RowActions>
                {running ? (
                  <RowStatus live tone="attention">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="Spinner" className="size-3 animate-spin" />
                      Running…
                    </span>
                  </RowStatus>
                ) : queued ? (
                  <RowStatus live>Queued</RowStatus>
                ) : state === null ? null : (
                  <RowStatus tone={state.statusTone}>{state.label}</RowStatus>
                )}
                {actionable ? (
                  <RowButton onClick={() => onStartInstall(host.id, issue)}>
                    {issue.action.label}
                  </RowButton>
                ) : null}
              </RowActions>
            </UpdatesRow>
          );
        })
      )}
    </div>
  );
}

/** Re-renders the relative "checked" stamp so it can't sit on a stale minute. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Settings → Updates: one consolidated, per-machine view of bb and provider
 * CLI updates. Replaces the stacked update/provider-health toasts (BB-48).
 */
export function UpdatesSettingsSection() {
  const queryClient = useQueryClient();
  const inventory = useUpdateInventory();
  const { desktopApi, desktopInfo, isDesktop } = useDesktopUpdateInfo();
  const retryHostUpdate = useRetryHostUpdate();
  const isChecking = useSyncExternalStore(
    subscribeAppUpdateCheck,
    getAppUpdateCheckSnapshot,
  );
  const now = useNow(30_000);
  const { queuedJobKeys, runningJobKey, startInstall } =
    useProviderCliInstallRunner();

  const allActionableIssues: {
    hostId: string;
    issue: ProviderCliActionableIssue;
  }[] = inventory.machines.flatMap((machine) =>
    machine.issues
      .filter(hasProviderCliAction)
      .map((issue) => ({ hostId: machine.host.id, issue })),
  );
  const actionableIssues = allActionableIssues.filter(({ hostId, issue }) => {
    const jobKey = providerCliJobKey(hostId, issue.provider);
    return runningJobKey !== jobKey && !queuedJobKeys.has(jobKey);
  });
  const manualIssueCount = inventory.machines.reduce(
    (count, machine) =>
      count +
      machine.issues.filter(
        (issue) => issue.status.installed && !hasProviderCliAction(issue),
      ).length,
    0,
  );

  const strandedMachines = inventory.machines.filter(
    (machine) => machine.canRetryDaemonUpdate,
  ).length;
  const checkingMachines = inventory.machines.filter(
    (machine) =>
      machine.host.status === "connected" &&
      !machine.statusError &&
      (machine.statusPending || machine.providerStatus === null),
  ).length;
  const uncheckedMachines = inventory.machines.filter(
    (machine) =>
      !machine.canRetryDaemonUpdate &&
      (machine.host.status !== "connected" || machine.statusError),
  ).length;
  const activeInstallCount =
    (runningJobKey === null ? 0 : 1) + queuedJobKeys.size;

  // Snapshot the hosts at click time: the check runs in a module-level store
  // so it survives navigating away, and must not read React state afterwards.
  const connectedHostIds = inventory.machines
    .filter((machine) => machine.host.status === "connected")
    .map((machine) => machine.host.id);

  function handleCheckForUpdates(): void {
    startAppUpdateCheck(async () => {
      if (desktopApi !== null) {
        await desktopApi.checkForUpdates();
      } else {
        const version = await sdk.system.version({ force: true });
        hydrateSystemVersionCache({ queryClient, version });
      }
      await Promise.all(
        connectedHostIds.map((hostId) =>
          invalidateHostProviderCliStatus({ queryClient, hostId }),
        ),
      );
    });
  }

  /*
   * "Up to date" is only credible next to a time, so the stamp — not the
   * button — is what the section header leads with; checking is a quiet icon
   * beside it.
   */
  const checkedLabel =
    inventory.lastCheckedAt === null
      ? null
      : `Checked ${formatRelativeTime({ timestamp: inventory.lastCheckedAt, now })}`;

  const machineSummary =
    inventory.machines.length === 0
      ? null
      : strandedMachines > 0
        ? `${strandedMachines} ${strandedMachines === 1 ? "machine" : "machines"} can't connect`
        : uncheckedMachines > 0
          ? `${uncheckedMachines} ${uncheckedMachines === 1 ? "machine was" : "machines were"} not checked`
          : checkingMachines > 0
            ? `Checking ${checkingMachines} ${checkingMachines === 1 ? "machine" : "machines"}…`
            : activeInstallCount > 0
              ? `${activeInstallCount} ${activeInstallCount === 1 ? "update" : "updates"} in progress`
              : manualIssueCount > 0
                ? `${manualIssueCount} ${manualIssueCount === 1 ? "update needs" : "updates need"} manual action`
                : actionableIssues.length === 0
                  ? `${inventory.machines.length} ${inventory.machines.length === 1 ? "machine" : "machines"}, all in sync`
                  : null;

  return (
    <>
      <UpdatesSection
        title="bb"
        footnote="Connected machines follow the server version automatically."
        action={
          <>
            {isChecking || checkedLabel !== null ? (
              <span
                role="status"
                aria-atomic="true"
                aria-live="polite"
                className="text-xs text-subtle-foreground"
              >
                {isChecking ? "Checking…" : checkedLabel}
              </span>
            ) : null}
            <RowButton
              variant="ghost"
              aria-label="Check for updates"
              aria-busy={isChecking}
              disabled={isChecking}
              className="px-1.5 text-muted-foreground hover:text-foreground"
              onClick={handleCheckForUpdates}
            >
              <Icon
                aria-hidden
                name={isChecking ? "Spinner" : "RotateCcw"}
                className={cn("size-3.5", isChecking && "animate-spin")}
              />
            </RowButton>
            <RowButton
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => openUrlInExternalBrowser(CHANGELOG_URL)}
            >
              What's new
            </RowButton>
          </>
        }
      >
        <UpdatesRowList>
          <BbAppUpdateRows
            systemVersion={inventory.systemVersion}
            desktopInfo={desktopInfo}
            isDesktop={isDesktop}
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
            onRetryDesktop={
              desktopApi === null
                ? null
                : () => {
                    void desktopApi
                      .checkForUpdates()
                      .catch((error: unknown) => {
                        appToast.error("Update retry failed", {
                          description: updateCheckErrorDescription(error),
                        });
                      });
                  }
            }
          />
        </UpdatesRowList>
      </UpdatesSection>

      <UpdatesSection
        title="Machines"
        action={
          machineSummary === null &&
          actionableIssues.length === 0 ? undefined : (
            <>
              {machineSummary === null ? null : (
                <span
                  role="status"
                  aria-live="polite"
                  className="text-xs text-subtle-foreground"
                >
                  {machineSummary}
                </span>
              )}
              {actionableIssues.length > 0 ? (
                <RowButton
                  onClick={() => {
                    for (const { hostId, issue } of actionableIssues) {
                      startInstall({ hostId, issue });
                    }
                  }}
                >
                  Update all ({actionableIssues.length})
                </RowButton>
              ) : null}
            </>
          )
        }
      >
        {inventory.machines.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-subtle-foreground">
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
      </UpdatesSection>
    </>
  );
}
