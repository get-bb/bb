import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import type {
  SystemAppUpdateResult,
  SystemAppUpdateStatus,
  SystemVersionResponse,
} from "@bb/server-contract";
import {
  RETRY_ACTION_ICON,
  UPDATE_ACTION_ICON,
  UPDATE_STATE_PRESENTATION,
  type UpdateState,
} from "@bb/domain/update-state";
import { Button, type ButtonProps } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import {
  ResourceActionButton,
  ResourceListState,
  ResourceRow,
} from "@bb/shared-ui/resource-list";
import {
  hasProviderCliAction,
  isProviderCliUpdateIssue,
  providerCliEntries,
  useProviderCliInstallRunner,
  type ProviderCliActionableIssue,
  type ProviderCliIssue,
  type ProviderCliStatusEntry,
} from "@/components/provider-cli/provider-cli-install";
import {
  openProviderCliInstallLog,
  PROVIDER_CLI_FAILURE_SUMMARIES,
  providerCliJobKey,
  type ProviderCliInstallFailure,
} from "@/components/provider-cli/provider-cli-install-store";
import {
  checkErrorDescription,
  getAppUpdateCheckSnapshot,
  startAppUpdateCheck,
  subscribeAppUpdateCheck,
} from "@/components/settings/app-update-check-store";
import { WhatsNewSection } from "@/components/settings/WhatsNewSection";
import { openAppUpdateResultDetails } from "@/components/app-update/app-update-details-store";
import {
  formatAppUpdateRevision,
  formatAppUpdateTarget,
  isDesktopOwnedServer,
  pendingAppUpdateResult,
  runningThreadCountFromError,
  runningThreadsWarning,
} from "@/components/app-update/app-update-presentation";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { appToast } from "@/components/ui/app-toast";
import { BbLogo } from "@/components/ui/bb-logo";
import {
  SettingsBadge,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { invalidateHostProviderCliStatus } from "@/hooks/cache-owners/provider-cli-status-cache-owner";
import { hydrateAppUpdateStatus } from "@/hooks/cache-owners/app-update-cache-owner";
import { hydrateSystemVersionCache } from "@/hooks/cache-owners/system-version-cache-owner";
import { useApplyAppUpdate } from "@/hooks/mutations/app-update-mutations";
import { useAppUpdateStatus } from "@/hooks/queries/app-update-queries";
import { useRetryHostUpdate } from "@/hooks/mutations/host-mutations";
import {
  useUpdateInventory,
  type UpdateInventoryMachine,
} from "@/hooks/useUpdateInventory";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useDesktopUpdateInfo } from "@/hooks/useDesktopUpdateInfo";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import {
  hostCanRetryUpdate,
  hostNeedsUpdate,
  hostUpdateIsStalled,
} from "@/lib/host-update-status";
import {
  getSettingsMachineRoutePath,
  getSettingsRoutePath,
} from "@/lib/route-paths";
import { ProviderIcon } from "@/components/plugin/ProviderIcon";
import {
  useSystemConfig,
  useSystemProviders,
} from "@/hooks/queries/system-queries";
import { sdk } from "@/lib/sdk";

const EMPTY_PROVIDER_CLI_FAILURES: ReadonlyMap<
  string,
  ProviderCliInstallFailure
> = new Map();
const BULK_RETRY_THRESHOLD = 1;

export function UpdateActionButton({
  label,
  tooltipLabel,
  icon,
  iconPosition = "start",
  visibleLabel,
  className,
  variant,
  loading = false,
  onClick,
}: {
  label: string;
  tooltipLabel?: string;
  icon: IconName;
  iconPosition?: "start" | "end";
  visibleLabel?: string;
  className?: string;
  variant?: ButtonProps["variant"];
  loading?: boolean;
  onClick?: () => void;
}) {
  if (visibleLabel === undefined) {
    return (
      <ResourceActionButton
        label={label}
        tooltipLabel={tooltipLabel}
        icon={icon}
        loading={loading}
        disabled={loading}
        className={cn(
          "size-7",
          variant === "default" &&
            "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
          className,
        )}
        onClick={() => onClick?.()}
      />
    );
  }
  const isQuiet = variant === undefined || variant === "ghost";
  return (
    <Button
      type="button"
      variant={variant ?? "ghost"}
      size="sm"
      aria-label={label}
      aria-busy={loading}
      className={cn(
        "h-7 gap-1.5 px-2.5 font-normal",
        isQuiet && "text-subtle-foreground hover:text-foreground",
        className,
      )}
      onClick={onClick}
    >
      {iconPosition === "end" ? visibleLabel : null}
      <Icon
        aria-hidden
        name={loading ? "Spinner" : icon}
        className={cn("size-3.5", loading && "animate-spin")}
      />
      {iconPosition === "start" ? visibleLabel : null}
    </Button>
  );
}

const ROW_SPACING = "py-2 first:pt-0 last:pb-0";

function UpdatesRow({
  leading,
  children,
  actions,
}: {
  leading: ReactNode;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div
      className={cn(
        "@container/update-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 text-sm",
        ROW_SPACING,
      )}
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="flex h-5 w-6 shrink-0 items-center justify-center">
          {leading}
        </span>
        {children}
      </span>
      {actions}
    </div>
  );
}

function RowVersions({
  current,
  latest,
}: {
  current: string | null;
  latest: string | null;
}) {
  if (current === null) {
    return null;
  }
  return (
    <span
      data-version-metadata
      className="min-w-0 shrink text-2xs text-muted-foreground"
    >
      {current}
      {latest !== null && latest !== current ? (
        <>
          <span className="px-1">→</span>
          <span className="font-semibold text-version-upgrade">{latest}</span>
        </>
      ) : null}
    </span>
  );
}

function RowName({
  name,
  detail,
  current,
  latest,
}: {
  name: string;
  detail?: ReactNode;
  current: string | null;
  latest: string | null;
}) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="truncate text-sm font-medium text-foreground">
        {name}
      </span>
      {detail}
      {current === null ? null : (
        <span className="min-w-0 basis-full @min-[28rem]/update-row:basis-auto">
          <RowVersions current={current} latest={latest} />
        </span>
      )}
    </span>
  );
}

function stateTextClass(state: UpdateState): string {
  return UPDATE_STATE_PRESENTATION[state].tone === "error"
    ? "font-semibold text-destructive"
    : "font-semibold text-subtle-foreground";
}

function RowStateCaption({
  state,
  children,
}: {
  state: UpdateState;
  children: ReactNode;
}) {
  return (
    <span className={cn("min-w-0 text-2xs break-words", stateTextClass(state))}>
      {children}
    </span>
  );
}

function FailureIndicator({
  reason,
  openLabel,
  openTooltip,
  onOpen,
}: {
  reason: string;
  openLabel?: string;
  openTooltip?: string;
  onOpen?: () => void;
}) {
  const iconClassName =
    "flex size-6 shrink-0 items-center justify-center rounded-sm text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const icon = <Icon aria-hidden name="AlertTriangle" className="size-3.5" />;
  return (
    <span
      data-row-action
      className="-my-1 flex shrink-0 items-center self-center"
    >
      {onOpen === undefined ? null : <span className="sr-only">{reason}</span>}
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            {onOpen === undefined ? (
              <span
                role="img"
                aria-label={reason}
                tabIndex={0}
                className={iconClassName}
              >
                {icon}
              </span>
            ) : (
              <button
                type="button"
                aria-label={openLabel}
                className={cn(
                  iconClassName,
                  "cursor-pointer hover:bg-state-hover",
                )}
                onClick={onOpen}
              >
                {icon}
              </button>
            )}
          </TooltipTrigger>
          <TooltipContent>
            {onOpen === undefined ? reason : openTooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

function RowStateControl({
  state,
  actionIcon,
  actionLabel,
  actionTooltip,
  buttonLeading,
  buttonLabel,
  loading = false,
  live = false,
  onClick,
}: {
  state: UpdateState;
  actionIcon?: IconName;
  actionLabel?: string;
  actionTooltip?: string;
  buttonLeading?: ReactNode;
  buttonLabel?: string;
  loading?: boolean;
  live?: boolean;
  onClick?: () => void;
}) {
  const presentation = UPDATE_STATE_PRESENTATION[state];
  const icon = actionIcon ?? (presentation.icon as IconName | null);
  const spin = loading || presentation.inFlight === true;
  const srLabel = presentation.label;
  const explainOnHover = presentation.inFlight !== true;

  if (onClick !== undefined && buttonLabel !== undefined) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={[srLabel, actionLabel].filter(Boolean).join(" · ")}
          aria-busy={loading}
          disabled={loading}
          className="h-6 shrink-0 gap-1.5 px-2 text-xs"
          onClick={onClick}
        >
          {loading ? (
            <Icon aria-hidden name="Loading" className="size-3 animate-spin" />
          ) : (
            buttonLeading
          )}
          {buttonLabel}
        </Button>
      </span>
    );
  }

  if (onClick !== undefined && icon !== null) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <UpdateActionButton
          label={[srLabel, actionLabel].filter(Boolean).join(" · ")}
          tooltipLabel={actionTooltip ?? actionLabel ?? presentation.label}
          icon={icon}
          loading={loading}
          onClick={onClick}
        />
      </span>
    );
  }

  if (icon === null) {
    return <span className="flex h-7 shrink-0 items-center" />;
  }

  const mark = (
    <span
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
      data-update-state={state}
      className="flex size-7 shrink-0 items-center justify-center"
    >
      <Icon
        aria-hidden
        name={icon}
        className={cn(
          "size-4",
          spin && "animate-spin",
          presentation.tone === "muted" &&
            (state === "up-to-date" ? "text-input" : "text-subtle-foreground"),
          presentation.tone === "error" && "text-destructive",
        )}
      />
      <span className="sr-only">{srLabel}</span>
    </span>
  );

  if (!explainOnHover) {
    return <span className="flex min-w-0 items-center gap-1.5">{mark}</span>;
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>{mark}</TooltipTrigger>
          <TooltipContent>{presentation.label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

function RowActions({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto flex shrink-0 items-center justify-end gap-1">
      {children}
    </span>
  );
}

interface BbAppUpdateRowsProps {
  name?: string;
  systemVersion: SystemVersionResponse | undefined;
  appUpdate?: SystemAppUpdateStatus | undefined;
  applyPending?: boolean;
  desktopInfo: BbDesktopInfo | null;
  isDesktop: boolean;
  onApplyAppUpdate?: (() => void) | null;
  onRetryAppCheck?: (() => void) | null;
  onRelaunchDesktop: (() => void) | null;
  onRetryDesktop: (() => void) | null;
  onShowAppUpdateResult?: ((result: SystemAppUpdateResult) => void) | null;
  isChecking?: boolean;
}

export function BbAppUpdateRows({
  name: rowName = "bb app",
  systemVersion,
  appUpdate,
  applyPending = false,
  desktopInfo,
  isDesktop,
  onApplyAppUpdate = null,
  onRetryAppCheck = null,
  onRelaunchDesktop,
  onRetryDesktop,
  onShowAppUpdateResult = null,
  isChecking = false,
}: BbAppUpdateRowsProps) {
  const settledStatus = isChecking ? (
    <RowStateControl live state="in-progress" />
  ) : (
    <RowStateControl state="up-to-date" />
  );
  const unavailableCheckControl =
    onRetryAppCheck === null ? null : (
      <RowStateControl
        state="latest-unknown"
        buttonLabel="Retry"
        actionLabel="Retry the release check"
        loading={isChecking}
        onClick={onRetryAppCheck}
      />
    );
  const row: BbAppRowRenderer = (name, indicator, caption, description) => (
    <UpdatesRow
      leading={
        <span data-bb-update-role="app" aria-hidden>
          <BbLogo className="size-4" />
        </span>
      }
      actions={<RowActions>{indicator}</RowActions>}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 flex-col gap-1 @min-[28rem]/update-row:flex-row @min-[28rem]/update-row:items-baseline @min-[28rem]/update-row:gap-2">
          {name}
          {caption}
        </span>
        {description === undefined ? null : (
          <span className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </UpdatesRow>
  );
  if (isDesktop && desktopInfo === null) {
    return row(
      <RowName name={rowName} current={null} latest={null} />,
      <RowStateControl live state="in-progress" />,
    );
  }

  if (desktopInfo !== null) {
    const pendingVersion =
      desktopInfo.pendingVersion ?? desktopInfo.latestVersion;
    const latest = desktopInfo.updateAvailable ? pendingVersion : null;
    const name = (
      <RowName name={rowName} current={desktopInfo.version} latest={latest} />
    );

    if (desktopInfo.updateDownloaded) {
      return row(
        name,
        <RowStateControl
          state="restart-required"
          buttonLeading={<BbLogo className="size-3" />}
          buttonLabel="Relaunch"
          actionLabel="Relaunch bb to finish updating"
          onClick={() => onRelaunchDesktop?.()}
        />,
      );
    }
    if (desktopInfo.downloadState === "downloading") {
      return row(name, <RowStateControl live state="in-progress" />);
    }
    if (desktopInfo.downloadState === "failed") {
      return row(
        name,
        <RowStateControl
          state="failed"
          actionIcon={RETRY_ACTION_ICON as IconName}
          actionTooltip="Retry"
          actionLabel="Retry the download"
          onClick={() => onRetryDesktop?.()}
        />,
        <FailureIndicator reason="Download failed" />,
      );
    }
    if (desktopInfo.updateAvailable) {
      return row(name, <RowStateControl state="update-available" />);
    }
    if (desktopInfo.latestVersion === null) {
      const checkDesktop = onRetryAppCheck ?? onRetryDesktop;
      const unchecked = desktopInfo.lastCheckedAt === null;
      return row(
        name,
        checkDesktop === null ? (
          isChecking ? (
            settledStatus
          ) : null
        ) : (
          <RowStateControl
            state="latest-unknown"
            buttonLabel={unchecked ? "Check" : "Retry"}
            actionLabel={
              unchecked
                ? "Check for desktop releases"
                : "Retry the desktop release check"
            }
            loading={isChecking}
            onClick={checkDesktop}
          />
        ),
        undefined,
        isChecking
          ? "Checking for a newer desktop release…"
          : unchecked
            ? "Desktop updates haven't been checked yet."
            : "Couldn't determine the latest desktop release.",
      );
    }
    return row(name, settledStatus);
  }

  if (appUpdate !== undefined && appUpdate.support.kind === "supported") {
    return (
      <InAppUpdateRow
        name={rowName}
        installKind={systemVersion?.installKind ?? null}
        status={appUpdate}
        applyPending={applyPending}
        settledStatus={settledStatus}
        unavailableCheckControl={unavailableCheckControl}
        row={row}
        onApply={onApplyAppUpdate}
        onShowResult={onShowAppUpdateResult}
      />
    );
  }

  if (systemVersion === undefined) {
    return row(
      <RowName name={rowName} current={null} latest={null} />,
      <RowStateControl state="in-progress" />,
    );
  }

  if (systemVersion.installKind === "source") {
    return row(
      <RowName
        name={rowName}
        detail={
          <span className="shrink-0 text-2xs text-muted-foreground">
            Source checkout
          </span>
        }
        current={
          systemVersion.currentCommit === null
            ? `Build ${systemVersion.currentVersion}`
            : systemVersion.currentCommit.slice(0, 7)
        }
        latest={null}
      />,
      null,
    );
  }

  const name = (
    <RowName
      name={rowName}
      detail={
        systemVersion.updateAvailable ? (
          <span className="hidden truncate font-mono text-2xs text-muted-foreground sm:inline">
            {systemVersion.upgradeCommand}
          </span>
        ) : undefined
      }
      current={systemVersion.currentVersion}
      latest={
        systemVersion.updateAvailable ? systemVersion.latestVersion : null
      }
    />
  );

  if (systemVersion.updateAvailable) {
    return row(
      name,
      <RowStateControl
        state="update-available"
        actionIcon="Copy"
        actionLabel="Copy the upgrade command"
        actionTooltip="Copy command"
        onClick={() => {
          void copyToClipboardWithToast(systemVersion.upgradeCommand, {
            successMessage: "Upgrade command copied",
            errorMessage: "Couldn't copy upgrade command",
          });
        }}
      />,
    );
  }

  if (systemVersion.latestVersion === null) {
    return row(
      name,
      unavailableCheckControl,
      undefined,
      isChecking
        ? "Checking npm for a newer release…"
        : "Couldn't check npm for a newer release.",
    );
  }
  return row(name, settledStatus);
}

type BbAppRowRenderer = (
  name: ReactNode,
  indicator: ReactNode,
  caption?: ReactNode,
  description?: ReactNode,
) => ReactNode;

function InAppUpdateRow({
  name: rowName,
  status,
  installKind,
  applyPending,
  settledStatus,
  unavailableCheckControl,
  row,
  onApply,
  onShowResult,
}: {
  name: string;
  status: SystemAppUpdateStatus;
  installKind: SystemVersionResponse["installKind"];
  applyPending: boolean;
  settledStatus: ReactNode;
  unavailableCheckControl: ReactNode;
  row: BbAppRowRenderer;
  onApply: (() => void) | null;
  onShowResult: ((result: SystemAppUpdateResult) => void) | null;
}) {
  const available = status.available;
  const name = (
    <RowName
      name={rowName}
      detail={
        installKind === "source" ? (
          <span className="shrink-0 text-2xs text-muted-foreground">
            Source checkout
          </span>
        ) : undefined
      }
      current={formatAppUpdateRevision(status.current)}
      latest={available === null ? null : formatAppUpdateTarget(available)}
    />
  );
  const activity = status.activity;
  if (activity.phase === "preparing") {
    return row(
      name,
      <RowStateControl live state="in-progress" />,
      <RowStateCaption state="in-progress">{activity.step}</RowStateCaption>,
    );
  }
  if (activity.phase === "restarting") {
    return row(
      name,
      <RowStateControl live state="in-progress" />,
      <RowStateCaption state="in-progress">Restarting</RowStateCaption>,
    );
  }

  const failedResult = pendingAppUpdateResult(status);
  const failure =
    failedResult !== null && failedResult.outcome !== "updated"
      ? failedResult
      : null;
  const updateButton =
    available === null || status.blocked !== null || onApply === null ? null : (
      <RowStateControl
        state={failure === null ? "update-available" : "failed"}
        buttonLabel={failure === null ? "Update" : undefined}
        actionIcon={
          failure === null ? undefined : (RETRY_ACTION_ICON as IconName)
        }
        actionTooltip={failure === null ? undefined : "Retry"}
        actionLabel="Download the update and restart bb"
        loading={applyPending}
        onClick={onApply}
      />
    );
  if (failure !== null) {
    return row(
      name,
      updateButton,
      <FailureIndicator
        reason="Last update failed"
        openLabel="View the failed bb update"
        openTooltip="View details"
        onOpen={onShowResult === null ? undefined : () => onShowResult(failure)}
      />,
    );
  }
  if (status.blocked !== null) {
    return row(
      name,
      status.support.kind === "supported" &&
        status.support.mode === "npm" &&
        status.blocked.reason === "fetch-failed"
        ? unavailableCheckControl
        : null,
      undefined,
      status.blocked.message,
    );
  }
  if (updateButton !== null) {
    return row(name, updateButton);
  }
  return row(
    name,
    available === null ? (
      settledStatus
    ) : (
      <RowStateControl state="update-available" />
    ),
  );
}

interface MachineUpdatesRowsProps {
  machine: UpdateInventoryMachine;
  runningJobKey: string | null;
  queuedJobKeys: ReadonlySet<string>;
  failuresByJobKey?: ReadonlyMap<string, ProviderCliInstallFailure>;
  onStartInstall: (hostId: string, issue: ProviderCliActionableIssue) => void;
  onOpenProvider: (providerId: string) => void;
}

function machineHasRelevantHealthStatus(
  machine: UpdateInventoryMachine,
): boolean {
  return (
    machine.statusError ||
    machine.canRetryDaemonUpdate ||
    machine.host.status !== "connected"
  );
}

function visibleProviderUpdateIssues(
  machine: UpdateInventoryMachine,
): ProviderCliIssue[] {
  if (
    machine.canRetryDaemonUpdate ||
    machine.host.status !== "connected" ||
    machine.statusError ||
    machine.statusPending ||
    machine.providerStatus === null
  ) {
    return [];
  }
  return machine.issues.filter(isProviderCliUpdateIssue);
}

function visibleInstalledProviderEntries(
  machine: UpdateInventoryMachine,
): ProviderCliStatusEntry[] {
  if (
    machine.canRetryDaemonUpdate ||
    machine.host.status !== "connected" ||
    machine.statusError ||
    machine.statusPending ||
    machine.providerStatus === null
  ) {
    return [];
  }
  return providerCliEntries(machine.providerStatus).filter(
    (entry) => entry.status.installed,
  );
}

export function BbDaemonUpdateRow({
  machine,
  now,
  retryUpdatePending,
  onRetryDaemonUpdate,
  onOpenMachine,
}: {
  machine: UpdateInventoryMachine;
  now: number;
  retryUpdatePending: boolean;
  onRetryDaemonUpdate: (hostId: string) => void;
  onOpenMachine: (hostId: string) => void;
}) {
  const { host } = machine;
  const updateStalled =
    machine.canRetryDaemonUpdate && hostUpdateIsStalled(host, now);
  const updating = machine.canRetryDaemonUpdate && !updateStalled;
  const machineIsAhead = hostNeedsUpdate(host) && !hostCanRetryUpdate(host);
  const offline = host.status !== "connected";

  const daemonCaption = machineIsAhead ? (
    <RowStateCaption state="offline">
      Update this app to reconnect
    </RowStateCaption>
  ) : null;

  return (
    <ResourceRow
      className={ROW_SPACING}
      actionsVisibility="always"
      openLabel={`Open ${host.name} settings`}
      onOpen={() => onOpenMachine(host.id)}
      leading={
        <span data-bb-update-role="daemon" aria-hidden>
          <BbLogo className="size-4" />
        </span>
      }
      title="bb daemon"
      titleAside={
        updateStalled ? (
          <FailureIndicator reason="Update didn't finish" />
        ) : null
      }
      state={daemonCaption}
      trailingMeta={null}
      actions={
        updating ? (
          <RowStateControl live state="in-progress" />
        ) : updateStalled ? (
          <RowStateControl
            state="failed"
            actionIcon={RETRY_ACTION_ICON as IconName}
            actionTooltip="Retry"
            actionLabel={`Retry on ${host.name} now`}
            loading={retryUpdatePending}
            onClick={() => onRetryDaemonUpdate(host.id)}
          />
        ) : machineIsAhead ? (
          <RowStateControl state="offline" />
        ) : offline ? (
          <RowStateControl state="offline" />
        ) : null
      }
    />
  );
}

export function ProviderCliCheckRow({
  machine,
  onRecheckClis,
  onOpenMachine,
}: {
  machine: UpdateInventoryMachine;
  onRecheckClis: (hostId: string) => void;
  onOpenMachine: (hostId: string) => void;
}) {
  const { host } = machine;
  return (
    <ResourceRow
      className={ROW_SPACING}
      actionsVisibility="always"
      openLabel={`Open ${host.name} settings`}
      onOpen={() => onOpenMachine(host.id)}
      leading={
        <Icon
          aria-hidden
          name="Terminal"
          className="size-3.5 text-muted-foreground"
        />
      }
      title="Provider CLIs"
      titleAside={<FailureIndicator reason="Couldn't check for updates" />}
      trailingMeta={null}
      actions={
        <RowStateControl
          state="failed"
          actionIcon={RETRY_ACTION_ICON as IconName}
          actionTooltip="Retry"
          actionLabel={`Check ${host.name}'s CLIs again`}
          loading={machine.statusFetching}
          onClick={() => onRecheckClis(host.id)}
        />
      }
    />
  );
}

function providerRowState({
  issue,
  status,
}: {
  issue: ProviderCliIssue | null;
  status: ProviderCliStatusEntry["status"];
}): UpdateState | null {
  if (issue === null) {
    return status.latestVersion === null ? "latest-unknown" : "up-to-date";
  }
  if (issue.action === null) {
    return "update-manually";
  }
  return "update-available";
}

export function MachineUpdatesRows({
  machine,
  runningJobKey,
  queuedJobKeys,
  failuresByJobKey = EMPTY_PROVIDER_CLI_FAILURES,
  onStartInstall,
  onOpenProvider,
}: MachineUpdatesRowsProps) {
  const { host } = machine;
  const providerRoster = useSystemProviders().data;
  const providerEntries = visibleInstalledProviderEntries(machine);
  const issuesByProvider = new Map(
    visibleProviderUpdateIssues(machine).map((issue) => [
      issue.provider,
      issue,
    ]),
  );

  if (providerEntries.length === 0) {
    return null;
  }

  const rows = providerEntries.map(({ provider, status }) => {
    const issue = issuesByProvider.get(provider) ?? null;
    const state = providerRowState({ issue, status });
    const jobKey = providerCliJobKey(host.id, provider);
    const running = runningJobKey === jobKey;
    const queued = queuedJobKeys.has(jobKey);
    const storedFailure = failuresByJobKey.get(jobKey) ?? null;
    const failure =
      issue !== null && storedFailure?.issueFingerprint === issue.fingerprint
        ? storedFailure
        : null;
    const actionable =
      issue !== null && hasProviderCliAction(issue) && !running && !queued;
    const providerId = provider;
    const providerInfo = providerRoster?.find(
      (candidate) => candidate.id === providerId,
    );
    return (
      <ResourceRow
        key={provider}
        className={ROW_SPACING}
        actionsVisibility="always"
        openLabel={`Open ${status.displayName} settings`}
        onOpen={() => onOpenProvider(providerId)}
        leading={
          <span
            data-provider-icon={providerId}
            aria-hidden
            className="flex size-3.5 shrink-0 items-center justify-center"
          >
            <ProviderIcon
              providerKind="agent"
              provider={providerInfo ?? { id: providerId }}
              className="size-3.5 text-muted-foreground"
            />
          </span>
        }
        title={status.displayName}
        titleMeta={
          <RowVersions
            current={status.currentVersion}
            latest={issue !== null ? status.latestVersion : null}
          />
        }
        titleAside={
          failure === null ? null : (
            <FailureIndicator
              reason={PROVIDER_CLI_FAILURE_SUMMARIES[failure.kind]}
              openLabel={`View ${status.displayName} update log`}
              openTooltip="View log"
              onOpen={() => openProviderCliInstallLog(failure.logDialogState)}
            />
          )
        }
        trailingMeta={null}
        actions={
          running ? (
            <RowStateControl live state="in-progress" />
          ) : queued ? (
            <RowStateControl live state="in-progress" />
          ) : failure !== null ? (
            actionable ? (
              <RowStateControl
                state="failed"
                actionIcon={RETRY_ACTION_ICON as IconName}
                actionLabel={`Retry ${status.displayName} on ${host.name}`}
                actionTooltip="Retry"
                onClick={() => onStartInstall(host.id, issue)}
              />
            ) : null
          ) : state === null ? null : (
            <RowStateControl
              state={state}
              actionLabel={
                actionable
                  ? `${issue.action.label} ${status.displayName} on ${host.name}`
                  : undefined
              }
              actionTooltip={actionable ? issue.action.label : undefined}
              onClick={
                actionable ? () => onStartInstall(host.id, issue) : undefined
              }
            />
          )
        }
      />
    );
  });

  return <>{rows}</>;
}

export function MachineUpdatesSection({
  machine,
  isThisMachine,
  showServerBadge,
  children,
}: {
  machine: UpdateInventoryMachine;
  isThisMachine: boolean;
  showServerBadge: boolean;
  children: ReactNode;
}) {
  return (
    <div data-updates-machine={machine.host.id}>
      <div data-updates-domain="machine">
        <SettingsSection
          title={
            <span className="flex min-w-0 items-center gap-2">
              <Icon
                name="Laptop"
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="truncate">{machine.host.name}</span>
              {isThisMachine ? (
                <SettingsBadge>This machine</SettingsBadge>
              ) : null}
              {showServerBadge ? <SettingsBadge>Server</SettingsBadge> : null}
            </span>
          }
        >
          <SettingsRowList>{children}</SettingsRowList>
        </SettingsSection>
      </div>
    </div>
  );
}

export function MachineUpdatesFleetSection({
  action,
  children,
}: {
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsSection
      action={action}
      bodyClassName="border-0 bg-transparent p-0"
      description="Manage bb and provider CLI updates across all machines."
      title="Machine updates"
    >
      <div className="space-y-6 pt-1.5">{children}</div>
    </SettingsSection>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function UpdatesSettingsSection() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const inventory = useUpdateInventory();
  const { localDaemonHostId } = useHostDaemon();
  const serverPrimaryHostId = useSystemConfig().data?.primaryHostId ?? null;
  const { desktopApi, desktopInfo, isDesktop } = useDesktopUpdateInfo();
  const retryHostUpdate = useRetryHostUpdate();
  const isChecking = useSyncExternalStore(
    subscribeAppUpdateCheck,
    getAppUpdateCheckSnapshot,
  );
  const now = useNow(30_000);
  const { failuresByJobKey, queuedJobKeys, runningJobKey, startInstall } =
    useProviderCliInstallRunner();
  const appUpdateStatus = useAppUpdateStatus();
  const applyAppUpdate = useApplyAppUpdate();
  const [confirmingAppUpdateThreads, setConfirmingAppUpdateThreads] = useState<
    number | null
  >(null);
  const appUpdate = appUpdateStatus.data;

  function startAppUpdate(): void {
    const runningThreadCount = appUpdate?.runningThreadCount ?? 0;
    if (runningThreadCount > 0) {
      setConfirmingAppUpdateThreads(runningThreadCount);
      return;
    }
    applyAppUpdate.mutate(
      { confirmInterruptingThreads: false },
      {
        onError: (error) => {
          const count = runningThreadCountFromError(error);
          if (count !== null) setConfirmingAppUpdateThreads(count);
        },
      },
    );
  }

  const visibleProviderIssues: {
    hostId: string;
    issue: ProviderCliIssue;
  }[] = inventory.machines.flatMap((machine) =>
    visibleProviderUpdateIssues(machine).map((issue) => ({
      hostId: machine.host.id,
      issue,
    })),
  );
  const actionableIssues = visibleProviderIssues
    .filter(
      (
        entry,
      ): entry is {
        hostId: string;
        issue: ProviderCliActionableIssue;
      } => hasProviderCliAction(entry.issue),
    )
    .filter(({ hostId, issue }) => {
      const jobKey = providerCliJobKey(hostId, issue.provider);
      return runningJobKey !== jobKey && !queuedJobKeys.has(jobKey);
    });

  const connectedHostIds = inventory.machines
    .filter((machine) => machine.host.status === "connected")
    .map((machine) => machine.host.id);

  function handleCheckForUpdates(): void {
    startAppUpdateCheck(async () => {
      const [appCheck, appUpdateCheck] = await Promise.allSettled([
        desktopApi !== null
          ? desktopApi.checkForUpdates().then(() => null)
          : sdk.system.version({ force: true }),
        sdk.system.appUpdate({ force: true }),
      ]);
      if (appUpdateCheck.status === "fulfilled") {
        hydrateAppUpdateStatus({ queryClient, status: appUpdateCheck.value });
      }
      if (appCheck.status === "rejected") {
        throw appCheck.reason;
      }
      if (appCheck.value !== null) {
        hydrateSystemVersionCache({ queryClient, version: appCheck.value });
      }
      await Promise.all(
        connectedHostIds.map((hostId) =>
          invalidateHostProviderCliStatus({ queryClient, hostId }),
        ),
      );
    });
  }

  const hostsSettled = !inventory.isLoading;
  const checkedOnLoad = useRef(false);
  useEffect(() => {
    if (checkedOnLoad.current || !hostsSettled) {
      return;
    }
    checkedOnLoad.current = true;
    handleCheckForUpdates();
    // oxlint-disable-next-line react/exhaustive-deps
  }, [hostsSettled]);

  const appUpdateVisible =
    desktopInfo?.updateAvailable === true ||
    inventory.systemVersion?.updateAvailable === true ||
    inventory.appUpdateAvailable ||
    (appUpdate?.support.kind === "supported" &&
      (appUpdate.available !== null ||
        appUpdate.activity.phase !== "idle" ||
        pendingAppUpdateResult(appUpdate) !== null));
  const relevantFleetMachines = inventory.machines.filter(
    machineHasRelevantHealthStatus,
  );
  const stalledMachines = relevantFleetMachines.filter(
    (machine) =>
      machine.canRetryDaemonUpdate && hostUpdateIsStalled(machine.host, now),
  );
  const appMachine =
    inventory.machines.find((machine) => machine.isPrimary) ??
    inventory.machines[0] ??
    null;
  const serverRunsSeparately =
    isDesktop && appUpdate !== undefined && !isDesktopOwnedServer(appUpdate);
  const desktopClientHostId =
    serverRunsSeparately &&
    localDaemonHostId !== null &&
    inventory.machines.some((machine) => machine.host.id === localDaemonHostId)
      ? localDaemonHostId
      : null;
  const visibleMachines = inventory.machines.filter(
    (machine) =>
      machine.host.id === appMachine?.host.id ||
      machine.host.id === desktopClientHostId ||
      machineHasRelevantHealthStatus(machine) ||
      visibleInstalledProviderEntries(machine).length > 0,
  );
  const hasUpdateWork =
    appUpdateVisible ||
    visibleProviderIssues.length > 0 ||
    stalledMachines.length > 0;
  const fleetIsHealthy = relevantFleetMachines.length === 0;
  const showFallbackBbStatus =
    !hasUpdateWork && !fleetIsHealthy && isDesktop && desktopInfo === null;

  const relaunchDesktop =
    desktopApi === null || showFallbackBbStatus
      ? null
      : () => {
          void desktopApi.installUpdate().catch((error) => {
            appToast.error("Relaunch failed", {
              description: checkErrorDescription(error),
            });
          });
        };
  const retryDesktop =
    desktopApi === null || showFallbackBbStatus
      ? null
      : () => {
          void desktopApi.checkForUpdates().catch((error) => {
            appToast.error("Update retry failed", {
              description: checkErrorDescription(error),
            });
          });
        };
  const appRow = (
    <BbAppUpdateRows
      systemVersion={inventory.systemVersion}
      appUpdate={desktopInfo === null ? appUpdate : undefined}
      applyPending={applyAppUpdate.isPending}
      desktopInfo={desktopInfo}
      isDesktop={isDesktop}
      isChecking={isChecking}
      onApplyAppUpdate={startAppUpdate}
      onRetryAppCheck={handleCheckForUpdates}
      onShowAppUpdateResult={openAppUpdateResultDetails}
      onRelaunchDesktop={relaunchDesktop}
      onRetryDesktop={retryDesktop}
    />
  );
  const serverAppRow = (
    <BbAppUpdateRows
      name="bb server"
      systemVersion={inventory.systemVersion}
      appUpdate={appUpdate}
      applyPending={applyAppUpdate.isPending}
      desktopInfo={null}
      isDesktop={false}
      isChecking={isChecking}
      onApplyAppUpdate={startAppUpdate}
      onRetryAppCheck={handleCheckForUpdates}
      onShowAppUpdateResult={openAppUpdateResultDetails}
      onRelaunchDesktop={null}
      onRetryDesktop={null}
    />
  );
  const desktopClientRow = (
    <BbAppUpdateRows
      name="bb desktop"
      systemVersion={undefined}
      desktopInfo={desktopInfo}
      isDesktop={isDesktop}
      isChecking={isChecking}
      onRetryAppCheck={handleCheckForUpdates}
      onRelaunchDesktop={relaunchDesktop}
      onRetryDesktop={retryDesktop}
    />
  );

  function retryDaemonUpdate(hostId: string): void {
    retryHostUpdate.mutate(hostId, {
      onSuccess: () => {
        const machine = inventory.machines.find(
          (candidate) => candidate.host.id === hostId,
        );
        appToast.success(
          `Retrying the update on ${machine?.host.name ?? "the requested machine"}`,
        );
      },
    });
  }

  function retryAllStalledDaemonUpdates(): void {
    for (const machine of stalledMachines) {
      retryHostUpdate.mutate(machine.host.id);
    }
    appToast.success(
      `Retrying the update on ${stalledMachines.length} machines`,
    );
  }

  const updateAllButton =
    actionableIssues.length > 1 ? (
      <UpdateActionButton
        label={`Update all ${actionableIssues.length} CLI tools`}
        tooltipLabel="Update all"
        icon={UPDATE_ACTION_ICON}
        visibleLabel="Update all"
        variant="default"
        onClick={() => {
          for (const { hostId, issue } of actionableIssues) {
            startInstall({ hostId, issue });
          }
        }}
      />
    ) : null;
  const retryAllButton =
    stalledMachines.length > BULK_RETRY_THRESHOLD ? (
      <UpdateActionButton
        label={`Update all ${stalledMachines.length} machines now`}
        visibleLabel="Retry all"
        icon="RotateCcw"
        iconPosition="end"
        variant="default"
        className="font-medium"
        onClick={retryAllStalledDaemonUpdates}
      />
    ) : null;
  const bulkActions =
    retryAllButton !== null || updateAllButton !== null ? (
      <div
        role="toolbar"
        aria-label="Bulk update actions"
        className="flex flex-wrap items-center justify-end gap-2"
      >
        {retryAllButton}
        {updateAllButton}
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      <WhatsNewSection
        key={inventory.systemVersion?.currentVersion ?? "unknown"}
        installedVersion={inventory.systemVersion?.currentVersion ?? null}
        availableVersion={
          inventory.systemVersion?.updateAvailable === true
            ? inventory.systemVersion.latestVersion
            : null
        }
      />

      <MachineUpdatesFleetSection action={bulkActions}>
        {serverRunsSeparately && desktopClientHostId === null ? (
          <div data-updates-device="desktop">
            <SettingsSection
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <Icon
                    name="Laptop"
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="truncate">This device</span>
                </span>
              }
            >
              <SettingsRowList>{desktopClientRow}</SettingsRowList>
            </SettingsSection>
          </div>
        ) : null}
        {visibleMachines.length === 0 ? (
          <ResourceListState state="empty" message="No machines available." />
        ) : (
          visibleMachines.map((machine) => {
            const ownsApp = machine.host.id === appMachine?.host.id;
            const showDaemon =
              machine.canRetryDaemonUpdate ||
              machine.host.status !== "connected";
            return (
              <MachineUpdatesSection
                key={machine.host.id}
                machine={machine}
                isThisMachine={
                  inventory.machines.length > 1 &&
                  machine.host.id === localDaemonHostId
                }
                showServerBadge={machine.host.id === serverPrimaryHostId}
              >
                {ownsApp
                  ? serverRunsSeparately
                    ? serverAppRow
                    : appRow
                  : null}
                {machine.host.id === desktopClientHostId
                  ? desktopClientRow
                  : null}
                {showDaemon ? (
                  <BbDaemonUpdateRow
                    machine={machine}
                    now={now}
                    retryUpdatePending={
                      retryHostUpdate.isPending &&
                      retryHostUpdate.variables === machine.host.id
                    }
                    onRetryDaemonUpdate={retryDaemonUpdate}
                    onOpenMachine={(hostId) =>
                      navigate(getSettingsMachineRoutePath(hostId))
                    }
                  />
                ) : null}
                {machine.statusError ? (
                  <ProviderCliCheckRow
                    machine={machine}
                    onRecheckClis={(hostId) => {
                      void invalidateHostProviderCliStatus({
                        queryClient,
                        hostId,
                      });
                    }}
                    onOpenMachine={(hostId) =>
                      navigate(getSettingsMachineRoutePath(hostId))
                    }
                  />
                ) : null}
                <MachineUpdatesRows
                  machine={machine}
                  runningJobKey={runningJobKey}
                  queuedJobKeys={queuedJobKeys}
                  failuresByJobKey={failuresByJobKey}
                  onStartInstall={(hostId, issue) =>
                    startInstall({ hostId, issue })
                  }
                  onOpenProvider={() =>
                    navigate(getSettingsRoutePath("providers"))
                  }
                />
              </MachineUpdatesSection>
            );
          })
        )}
      </MachineUpdatesFleetSection>
      <ConfirmDeleteDialog
        open={confirmingAppUpdateThreads !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmingAppUpdateThreads(null);
        }}
      >
        <ConfirmDeleteDialogContent
          title="Update bb now?"
          description={runningThreadsWarning(confirmingAppUpdateThreads ?? 0)}
          confirmLabel="Update and restart"
          pending={applyAppUpdate.isPending}
          onCancel={() => setConfirmingAppUpdateThreads(null)}
          onConfirm={() => {
            applyAppUpdate.mutate(
              { confirmInterruptingThreads: true },
              { onSettled: () => setConfirmingAppUpdateThreads(null) },
            );
          }}
        />
      </ConfirmDeleteDialog>
    </div>
  );
}
