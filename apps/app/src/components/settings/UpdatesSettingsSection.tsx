import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import type { ProviderInfo } from "@bb/domain";
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
import { usePrefersReducedMotion } from "@bb/shared-ui/hooks/use-media-query";
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
import {
  fetchLatestChangelogEntry,
  LATEST_CHANGELOG_ENTRY,
  RELEASE_META,
  type ChangelogBlock,
} from "@/components/settings/changelog-preview";
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
} from "@bb/shared-ui/confirm-delete-dialog";
import { appToast } from "@/components/ui/app-toast";
import { BbLogo } from "@/components/ui/bb-logo";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { SettingsSection } from "@/components/ui/settings-section";
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
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import { ProviderIcon } from "@/components/plugin/ProviderIcon";
import {
  useSystemConfig,
  useSystemProviders,
} from "@/hooks/queries/system-queries";
import { sdk } from "@/lib/sdk";
import { rawStringLocalStorage } from "@/lib/browser-storage";

const CHANGELOG_URL = "https://getbb.app/changelog";
const CHANGELOG_STALE_TIME_MS = 5 * 60_000;
const CHANGELOG_DISMISSED_VERSION_STORAGE_KEY =
  "bb.settings.updates.dismissed-changelog-version";
const CHANGELOG_DISMISS_CONFIRMATION_MS = 2_000;
const CHANGELOG_DISMISS_EXIT_MS = 180;

interface ChangelogDismissal {
  phase: "confirming" | "exiting";
  version: string;
}

function isNewerChangelogVersion(
  candidate: string,
  dismissed: string,
): boolean {
  const versionPattern = /^\d+(?:\.\d+)*$/;
  if (!versionPattern.test(candidate) || !versionPattern.test(dismissed)) {
    return candidate !== dismissed;
  }
  const candidateParts = candidate.split(".").map(Number);
  const dismissedParts = dismissed.split(".").map(Number);
  const partCount = Math.max(candidateParts.length, dismissedParts.length);
  for (let index = 0; index < partCount; index += 1) {
    const candidatePart = candidateParts[index] ?? 0;
    const dismissedPart = dismissedParts[index] ?? 0;
    if (candidatePart !== dismissedPart) {
      return candidatePart > dismissedPart;
    }
  }
  return false;
}

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
    <div className="@container/update-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3.5 text-sm">
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
      <span className="w-16 shrink-0 truncate text-sm font-medium text-foreground">
        {name}
      </span>
      {current === null ? null : (
        <span className="min-w-0 basis-full @min-[28rem]/update-row:basis-auto">
          <RowVersions current={current} latest={latest} />
        </span>
      )}
      {detail}
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
    <span className="ml-auto flex h-5 shrink-0 items-center justify-end gap-1">
      {children}
    </span>
  );
}

const CHANGELOG_INLINE_COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="mt-4 h-auto w-full rounded-lg"
    />
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
      onClick={(event) => {
        event.preventDefault();
        if (href !== undefined) {
          openUrlInExternalBrowser(href);
        }
      }}
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
      {children}
    </code>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
};

function ChangelogInline({ text }: { text: string }) {
  return (
    <ReactMarkdown components={CHANGELOG_INLINE_COMPONENTS} skipHtml>
      {text}
    </ReactMarkdown>
  );
}

function ChangelogBlocks({
  blocks,
  lede = false,
}: {
  blocks: ChangelogBlock[];
  lede?: boolean;
}) {
  return blocks.map((block, index) =>
    block.kind === "list" ? (
      <ul key={index} className="mt-2.5 space-y-1.5">
        {block.items.map((item) => (
          <li
            key={item}
            className="relative pl-4 text-sm leading-normal text-muted-foreground before:absolute before:left-0 before:top-2 before:size-1 before:rounded-sm before:bg-border"
          >
            <ChangelogInline text={item} />
          </li>
        ))}
      </ul>
    ) : (
      <p
        key={index}
        className={cn(
          "mt-2.5 text-sm leading-relaxed text-muted-foreground first:mt-0",
          lede && "text-foreground/80",
        )}
      >
        <ChangelogInline text={block.text} />
      </p>
    ),
  );
}

export function ChangelogPreviewCard() {
  const changelogQuery = useQuery({
    queryKey: ["updates", "changelog", "latest"],
    queryFn: ({ signal }) => fetchLatestChangelogEntry(fetch, signal),
    placeholderData: LATEST_CHANGELOG_ENTRY ?? undefined,
    retry: false,
    staleTime: CHANGELOG_STALE_TIME_MS,
  });
  const entry = changelogQuery.data ?? LATEST_CHANGELOG_ENTRY;
  const [dismissedVersion, setDismissedVersion] = useState(() =>
    rawStringLocalStorage.getItem(CHANGELOG_DISMISSED_VERSION_STORAGE_KEY, ""),
  );
  const [dismissal, setDismissal] = useState<ChangelogDismissal | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const releaseBodyRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const syncFade = (node: HTMLDivElement | null) => {
    if (node === null) {
      return;
    }
    setMoreBelow(node.scrollTop + node.clientHeight < node.scrollHeight - 1);
  };
  useEffect(() => {
    syncFade(releaseBodyRef.current);
  }, [entry]);
  useEffect(() => {
    if (dismissal?.phase !== "confirming") {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setDismissal((current) =>
        current?.version === dismissal.version
          ? { ...current, phase: "exiting" }
          : current,
      );
    }, CHANGELOG_DISMISS_CONFIRMATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [dismissal]);
  useEffect(() => {
    if (dismissal?.phase !== "exiting") {
      return;
    }
    const dismissedEntryVersion = dismissal.version;
    const timeoutId = window.setTimeout(
      () => {
        setDismissedVersion(dismissedEntryVersion);
        setDismissal((current) =>
          current?.version === dismissedEntryVersion ? null : current,
        );
      },
      prefersReducedMotion ? 0 : CHANGELOG_DISMISS_EXIT_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [dismissal, prefersReducedMotion]);
  if (entry === null) {
    return null;
  }
  if (
    dismissedVersion.length > 0 &&
    (changelogQuery.dataUpdatedAt === 0 ||
      !isNewerChangelogVersion(entry.version, dismissedVersion))
  ) {
    return null;
  }
  const releaseMeta = RELEASE_META[entry.version];
  const dismissalPhase =
    dismissal?.version === entry.version ? dismissal.phase : "visible";
  const releaseVisible = dismissalPhase === "visible";
  return (
    <div
      data-updates-domain="changelog"
      data-changelog-dismiss-phase={dismissalPhase}
      className={cn(
        "grid transition-[grid-template-rows,margin,opacity,transform] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none [&>section]:min-h-0 [&>section]:overflow-hidden",
        dismissalPhase === "exiting"
          ? "-mb-6 grid-rows-[0fr] -translate-y-1 opacity-0"
          : "grid-rows-[1fr] translate-y-0 opacity-100",
      )}
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div
          data-changelog-release-panel
          aria-hidden={!releaseVisible}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            releaseVisible
              ? "grid-rows-[1fr] opacity-100"
              : "pointer-events-none grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <article data-changelog-preview className="min-w-0 p-4 sm:p-5">
              <div
                data-changelog-header
                className="flex min-w-0 items-center justify-between gap-4"
              >
                <h2 className="min-w-0">
                  <span
                    data-changelog-label
                    className="inline-flex rounded-sm border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium leading-none text-muted-foreground"
                  >
                    What's new
                  </span>
                </h2>
                {releaseVisible ? (
                  <Tooltip delayDuration={300} disableHoverableContent>
                    <TooltipTrigger asChild>
                      <Button
                        data-changelog-dismiss
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        aria-label={`Dismiss bb ${entry.version} changelog preview`}
                        onClick={() => {
                          rawStringLocalStorage.setItem(
                            CHANGELOG_DISMISSED_VERSION_STORAGE_KEY,
                            entry.version,
                          );
                          setDismissal({
                            phase: "confirming",
                            version: entry.version,
                          });
                        }}
                      >
                        <Icon aria-hidden name="X" className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Dismiss</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
              {releaseMeta === undefined ? null : (
                <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    data-changelog-version={entry.version}
                    className="inline-flex rounded-full border border-border bg-muted/30 px-2.5 py-1 font-mono text-xs font-semibold leading-none tracking-tight text-foreground"
                  >
                    {entry.version}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {releaseMeta.date}
                  </span>
                </div>
              )}

              <div
                className={cn(
                  "relative min-w-0",
                  releaseMeta === undefined ? "mt-4" : "mt-3",
                )}
              >
                <div
                  ref={releaseBodyRef}
                  data-changelog-release-scroll
                  onScroll={(event) => syncFade(event.currentTarget)}
                  className="max-h-56 overflow-y-auto pr-3"
                >
                  <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground">
                    {releaseMeta?.headline ?? entry.version}
                  </h3>
                  {entry.lede.length === 0 ? null : (
                    <div className="mt-2">
                      <ChangelogBlocks blocks={entry.lede} lede />
                    </div>
                  )}
                  {entry.sections.map((section) => (
                    <div key={section.title} className="mt-4">
                      <h4 className="text-sm font-semibold leading-snug text-foreground">
                        {section.title}
                      </h4>
                      <ChangelogBlocks blocks={section.blocks} />
                    </div>
                  ))}
                </div>
                {moreBelow ? <OverflowFade placement="below" inset /> : null}
              </div>
            </article>
            <div
              data-changelog-footer
              className="flex items-center justify-end border-t border-foreground bg-foreground px-4 py-2.5 text-background sm:px-5"
            >
              <button
                type="button"
                disabled={!releaseVisible}
                aria-label={`Open the full bb ${entry.version} changelog`}
                onClick={() =>
                  openUrlInExternalBrowser(
                    `${CHANGELOG_URL}#${entry.version.replaceAll(".", "-")}`,
                  )
                }
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-xs font-semibold text-background underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-background"
              >
                Full changelog
                <Icon aria-hidden name="ExternalLink" className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
        <div
          data-changelog-dismiss-confirmation
          role="status"
          aria-live="polite"
          aria-hidden={releaseVisible}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            releaseVisible
              ? "pointer-events-none grid-rows-[0fr] opacity-0"
              : "grid-rows-[1fr] opacity-100",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="p-4 text-center sm:p-5">
              <div className="mx-auto max-w-sm">
                <div className="flex items-center justify-center gap-2">
                  <Icon
                    aria-hidden
                    name="CircleCheck"
                    className="size-4 text-muted-foreground"
                  />
                  <span className="inline-flex rounded-full border border-border bg-muted/30 px-2.5 py-1 font-mono text-xs font-semibold leading-none tracking-tight text-foreground">
                    {entry.version}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold leading-snug tracking-tight text-foreground">
                  You're all caught up
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  We'll show the next bb release here.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
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
  name: rowName = "Server",
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
          <BbLogo className="size-4 -translate-y-px" />
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

function machineHasRelevantHealthStatus(
  machine: UpdateInventoryMachine,
): boolean {
  return (
    machine.statusError ||
    machine.canRetryDaemonUpdate ||
    machine.host.status !== "connected"
  );
}

function providerStatusIsVisible(machine: UpdateInventoryMachine): boolean {
  return !(
    machine.canRetryDaemonUpdate ||
    machine.host.status !== "connected" ||
    machine.statusError ||
    machine.statusPending ||
    machine.providerStatus === null
  );
}

function visibleProviderUpdateIssues(
  machine: UpdateInventoryMachine,
): ProviderCliIssue[] {
  if (!providerStatusIsVisible(machine)) {
    return [];
  }
  return machine.issues.filter(isProviderCliUpdateIssue);
}

function visibleInstalledProviderEntries(
  machine: UpdateInventoryMachine,
): ProviderCliStatusEntry[] {
  if (!providerStatusIsVisible(machine) || machine.providerStatus === null) {
    return [];
  }
  return providerCliEntries(machine.providerStatus).filter(
    (entry) => entry.status.installed,
  );
}

type MachineDaemonState = "updating" | "stalled" | "ahead" | "offline";

function machineDaemonState(
  machine: UpdateInventoryMachine,
  now: number,
): MachineDaemonState | null {
  const { host } = machine;
  if (machine.canRetryDaemonUpdate) {
    return hostUpdateIsStalled(host, now) ? "stalled" : "updating";
  }
  if (hostNeedsUpdate(host) && !hostCanRetryUpdate(host)) {
    return "ahead";
  }
  return host.status === "connected" ? null : "offline";
}

function machineNeedsAttention(
  machine: UpdateInventoryMachine,
  now: number,
): boolean {
  const daemon = machineDaemonState(machine, now);
  return (
    (daemon !== null && daemon !== "offline") ||
    machine.statusError ||
    visibleProviderUpdateIssues(machine).length > 0
  );
}

interface ProviderCliJobState {
  runningJobKey: string | null;
  queuedJobKeys: ReadonlySet<string>;
  failuresByJobKey: ReadonlyMap<string, ProviderCliInstallFailure>;
}

interface MachineProviderItem {
  provider: ProviderCliStatusEntry["provider"];
  status: ProviderCliStatusEntry["status"];
  issue: ProviderCliIssue | null;
  activity: "running" | "queued" | null;
  failure: ProviderCliInstallFailure | null;
}

function machineProviderItems(
  machine: UpdateInventoryMachine,
  jobs: ProviderCliJobState,
): MachineProviderItem[] {
  const issuesByProvider = new Map(
    visibleProviderUpdateIssues(machine).map((issue) => [
      issue.provider,
      issue,
    ]),
  );
  return visibleInstalledProviderEntries(machine).map(
    ({ provider, status }) => {
      const issue = issuesByProvider.get(provider) ?? null;
      const jobKey = providerCliJobKey(machine.host.id, provider);
      const storedFailure = jobs.failuresByJobKey.get(jobKey) ?? null;
      return {
        provider,
        status,
        issue,
        activity:
          jobs.runningJobKey === jobKey
            ? "running"
            : jobs.queuedJobKeys.has(jobKey)
              ? "queued"
              : null,
        failure:
          issue !== null &&
          storedFailure?.issueFingerprint === issue.fingerprint
            ? storedFailure
            : null,
      };
    },
  );
}

function itemIsStartable(
  item: MachineProviderItem,
): item is MachineProviderItem & {
  issue: ProviderCliActionableIssue;
} {
  return (
    item.issue !== null &&
    hasProviderCliAction(item.issue) &&
    item.activity === null
  );
}

const UPDATER_NAMES: Record<string, string> = {
  brew: "Homebrew",
  bun: "Bun",
  mise: "mise",
  npm: "npm",
  pnpm: "pnpm",
};

export function providerCliUpdaterName(
  status: ProviderCliStatusEntry["status"],
): string | null {
  const command = status.installAction?.command.trim().split(/\s+/u)[0];
  if (command === undefined || command.length === 0) {
    return null;
  }
  const executable = (command.split(/[\\/]/u).pop() ?? command).replace(
    /\.(?:exe|cmd|bat)$/iu,
    "",
  );
  if (executable === status.executableName) {
    return "Built-in updater";
  }
  return UPDATER_NAMES[executable] ?? executable;
}

function providerItemState(item: MachineProviderItem): UpdateState {
  if (item.issue === null) {
    return item.status.latestVersion === null ? "latest-unknown" : "up-to-date";
  }
  return item.issue.action === null ? "update-manually" : "update-available";
}

function ProviderAvatar({
  item,
  providerInfo,
  onToggle,
}: {
  item: MachineProviderItem;
  providerInfo: ProviderInfo | undefined;
  onToggle: () => void;
}) {
  const manual = item.issue?.action === null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-provider-avatar={item.provider}
          data-provider-activity={
            item.failure !== null ? "failed" : (item.activity ?? undefined)
          }
          data-provider-manual={manual ? "" : undefined}
          className={cn(
            "relative z-10 -ml-1.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full ring-2 ring-card first:ml-0",
            manual
              ? "bg-card outline-1 -outline-offset-1 outline-subtle-foreground outline-dashed"
              : "bg-muted",
          )}
          onClick={onToggle}
        >
          <ProviderIcon
            providerKind="agent"
            provider={providerInfo ?? { id: item.provider }}
            className={cn("size-3.5", manual && "opacity-60")}
          />
          {item.activity === "running" ? (
            <span
              aria-hidden
              className="absolute -inset-0.5 animate-spin rounded-full border-2 border-transparent border-t-foreground motion-reduce:animate-none"
            />
          ) : null}
          {item.failure !== null ? (
            <span
              aria-hidden
              className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-destructive ring-2 ring-card"
            />
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {item.status.displayName}
        {item.status.currentVersion === null
          ? null
          : ` ${item.status.currentVersion}`}
        {item.status.latestVersion === null ||
        item.status.latestVersion === item.status.currentVersion
          ? null
          : ` → ${item.status.latestVersion}`}
      </TooltipContent>
    </Tooltip>
  );
}

function ProviderDetailRow({
  hostName,
  item,
  providerInfo,
  onStart,
}: {
  hostName: string;
  item: MachineProviderItem;
  providerInfo: ProviderInfo | undefined;
  onStart: (issue: ProviderCliActionableIssue) => void;
}) {
  const { status, issue, failure } = item;
  const state = providerItemState(item);
  const updater = issue === null ? null : providerCliUpdaterName(status);
  const retryIssue =
    failure !== null && itemIsStartable(item) ? item.issue : null;
  return (
    <div
      data-provider-row={item.provider}
      className="grid min-h-8 min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2.5 text-sm"
    >
      <span
        data-provider-icon={item.provider}
        aria-hidden
        className="flex size-3.5 shrink-0 items-center justify-center"
      >
        <ProviderIcon
          providerKind="agent"
          provider={providerInfo ?? { id: item.provider }}
          className="size-3.5 text-muted-foreground"
        />
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="w-28 shrink-0 truncate text-foreground">
          {status.displayName}
        </span>
        <RowVersions
          current={status.currentVersion}
          latest={issue !== null ? status.latestVersion : null}
        />
      </span>
      <span className="flex shrink-0 items-center justify-end gap-1.5">
        {state === "update-manually" ? (
          <span className="text-xs text-subtle-foreground">
            {UPDATE_STATE_PRESENTATION["update-manually"].label}
          </span>
        ) : updater === null || status.installAction === null ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                data-provider-updater
                tabIndex={0}
                className="rounded-sm text-xs text-subtle-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              >
                {updater}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <code className="font-mono">{status.installAction.command}</code>
            </TooltipContent>
          </Tooltip>
        )}
        {failure === null ? null : (
          <FailureIndicator
            reason={PROVIDER_CLI_FAILURE_SUMMARIES[failure.kind]}
            openLabel={`View ${status.displayName} update log`}
            openTooltip="View log"
            onOpen={() => openProviderCliInstallLog(failure.logDialogState)}
          />
        )}
        {item.activity !== null ? (
          <RowStateControl live state="in-progress" />
        ) : retryIssue !== null ? (
          <RowStateControl
            state="failed"
            actionIcon={RETRY_ACTION_ICON as IconName}
            actionLabel={`Retry ${status.displayName} on ${hostName}`}
            actionTooltip="Retry"
            onClick={() => onStart(retryIssue)}
          />
        ) : state === "up-to-date" || state === "latest-unknown" ? (
          <RowStateControl state={state} />
        ) : null}
      </span>
    </div>
  );
}

interface MachineUpdateRowProps extends ProviderCliJobState {
  machine: UpdateInventoryMachine;
  now: number;
  tags: readonly string[];
  expanded: boolean;
  retryUpdatePending: boolean;
  onToggle: () => void;
  onStartInstall: (hostId: string, issue: ProviderCliActionableIssue) => void;
  onRetryDaemonUpdate: (hostId: string) => void;
  onRecheckClis: (hostId: string) => void;
}

function MachineRowNote({
  machine,
  daemon,
  items,
  retryUpdatePending,
  onStartInstall,
  onRetryDaemonUpdate,
  onRecheckClis,
}: Pick<
  MachineUpdateRowProps,
  | "machine"
  | "retryUpdatePending"
  | "onStartInstall"
  | "onRetryDaemonUpdate"
  | "onRecheckClis"
> & {
  daemon: MachineDaemonState | null;
  items: MachineProviderItem[];
}) {
  const { host } = machine;
  if (daemon === "updating") {
    return (
      <>
        <RowStateCaption state="in-progress">Updating bb</RowStateCaption>
        <RowStateControl live state="in-progress" />
      </>
    );
  }
  if (daemon === "stalled") {
    return (
      <>
        <RowStateCaption state="failed">Update didn't finish</RowStateCaption>
        <RowStateControl
          state="failed"
          actionIcon={RETRY_ACTION_ICON as IconName}
          actionTooltip="Retry"
          actionLabel={`Retry on ${host.name} now`}
          loading={retryUpdatePending}
          onClick={() => onRetryDaemonUpdate(host.id)}
        />
      </>
    );
  }
  if (daemon === "ahead") {
    return (
      <RowStateCaption state="offline">
        Update this app to reconnect
      </RowStateCaption>
    );
  }
  if (daemon === "offline") {
    return <RowStateCaption state="offline">Offline</RowStateCaption>;
  }
  if (machine.statusError) {
    return (
      <>
        <RowStateCaption state="failed">
          Couldn't check for updates
        </RowStateCaption>
        <RowStateControl
          state="failed"
          actionIcon={RETRY_ACTION_ICON as IconName}
          actionTooltip="Retry"
          actionLabel={`Check ${host.name}'s CLIs again`}
          loading={machine.statusFetching}
          onClick={() => onRecheckClis(host.id)}
        />
      </>
    );
  }
  const failed = items.filter((item) => item.failure !== null);
  if (failed.length > 0) {
    const retryable = failed.filter(itemIsStartable);
    return (
      <>
        <RowStateCaption state="failed">
          {failed.length === 1
            ? `${failed[0]?.status.displayName} failed`
            : `${failed.length} failed`}
        </RowStateCaption>
        {retryable.length === 0 ? null : (
          <RowStateControl
            state="failed"
            actionIcon={RETRY_ACTION_ICON as IconName}
            actionTooltip="Retry"
            actionLabel={`Retry failed updates on ${host.name}`}
            onClick={() => {
              for (const item of retryable) {
                onStartInstall(host.id, item.issue);
              }
            }}
          />
        )}
      </>
    );
  }
  const manual = items.filter((item) => item.issue?.action === null).length;
  if (manual > 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="rounded-sm text-xs text-subtle-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          >
            {manual} manual
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {UPDATE_STATE_PRESENTATION["update-manually"].label}
        </TooltipContent>
      </Tooltip>
    );
  }
  return null;
}

export function MachineUpdateRow({
  machine,
  now,
  tags,
  expanded,
  retryUpdatePending,
  runningJobKey,
  queuedJobKeys,
  failuresByJobKey,
  onToggle,
  onStartInstall,
  onRetryDaemonUpdate,
  onRecheckClis,
}: MachineUpdateRowProps) {
  const { host } = machine;
  const providerRoster = useSystemProviders().data;
  const items = machineProviderItems(machine, {
    runningJobKey,
    queuedJobKeys,
    failuresByJobKey,
  });
  const outdated = items.filter((item) => item.issue !== null);
  const startable = items.filter(itemIsStartable);
  const daemon = machineDaemonState(machine, now);
  const expandable = items.length > 0;
  const detailId = `updates-machine-detail-${host.id}`;
  const providerInfoFor = (provider: string) =>
    providerRoster?.find((candidate) => candidate.id === provider);
  return (
    <div data-updates-machine={host.id}>
      <div
        className={cn(
          "relative grid min-h-12 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm",
          expandable && "hover:bg-state-hover",
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-5 w-6 shrink-0 items-center justify-center">
            <Icon
              aria-hidden
              name="Laptop"
              className="size-4 text-muted-foreground"
            />
          </span>
          <span className="flex min-w-0 items-baseline gap-2">
            {expandable ? (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={detailId}
                className="min-w-0 cursor-pointer truncate rounded-sm text-left font-medium text-foreground after:absolute after:inset-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                onClick={onToggle}
              >
                {host.name}
              </button>
            ) : (
              <span className="min-w-0 truncate font-medium text-foreground">
                {host.name}
              </span>
            )}
            {tags.map((tag) => (
              <span
                key={tag}
                data-machine-tag
                className="shrink-0 text-xs text-subtle-foreground"
              >
                {tag}
              </span>
            ))}
          </span>
        </span>
        <span className="relative z-10 flex min-w-0 items-center justify-end gap-2">
          <MachineRowNote
            machine={machine}
            daemon={daemon}
            items={items}
            retryUpdatePending={retryUpdatePending}
            onStartInstall={onStartInstall}
            onRetryDaemonUpdate={onRetryDaemonUpdate}
            onRecheckClis={onRecheckClis}
          />
          {outdated.length === 0 ? null : (
            <span
              data-provider-pile
              className="flex shrink-0 items-center pl-1"
            >
              {outdated.map((item) => (
                <ProviderAvatar
                  key={item.provider}
                  item={item}
                  providerInfo={providerInfoFor(item.provider)}
                  onToggle={onToggle}
                />
              ))}
            </span>
          )}
        </span>
      </div>
      {expanded && expandable ? (
        <div
          id={detailId}
          data-updates-machine-detail
          className="border-t border-border-seam bg-muted/25 py-2 pr-4 pl-[3.25rem]"
        >
          {items.map((item) => (
            <ProviderDetailRow
              key={item.provider}
              hostName={host.name}
              item={item}
              providerInfo={providerInfoFor(item.provider)}
              onStart={(issue) => onStartInstall(host.id, issue)}
            />
          ))}
          {startable.length === 0 ? null : (
            <div className="flex justify-end pt-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  for (const item of startable) {
                    onStartInstall(host.id, item.issue);
                  }
                }}
              >
                Update {host.name}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function BbUpdatesCard({ children }: { children: ReactNode }) {
  return (
    <section aria-label="bb" data-updates-domain="bb">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="divide-y divide-border">{children}</div>
      </div>
    </section>
  );
}

function pluralMachines(count: number): string {
  return `${count} machine${count === 1 ? "" : "s"}`;
}

function quietFleetSummary(machines: readonly UpdateInventoryMachine[]): {
  message: string;
  checking: boolean;
} {
  const connected = machines.filter(
    (machine) => machine.host.status === "connected",
  );
  const offline = machines.length - connected.length;
  if (connected.some((machine) => machine.statusPending)) {
    return { message: "Checking for updates…", checking: true };
  }
  if (connected.length === 0) {
    return {
      message:
        machines.length === 1
          ? `${machines[0]?.host.name} is offline.`
          : `All ${pluralMachines(machines.length)} are offline.`,
      checking: false,
    };
  }
  const scope =
    machines.length === 1
      ? `on ${connected[0]?.host.name}`
      : offline === 0
        ? `on all ${pluralMachines(connected.length)}`
        : `on ${pluralMachines(connected.length)}`;
  return {
    message: `Nothing to update ${scope}.${offline === 0 ? "" : ` ${offline} offline.`}`,
    checking: false,
  };
}

interface ProviderCliUpdatesSectionProps extends ProviderCliJobState {
  machines: readonly UpdateInventoryMachine[];
  now: number;
  localDaemonHostId: string | null;
  serverHostId: string | null;
  retryPendingHostId: string | null;
  onStartInstall: (hostId: string, issue: ProviderCliActionableIssue) => void;
  onRetryDaemonUpdate: (hostId: string) => void;
  onRetryAllDaemonUpdates: (hostIds: string[]) => void;
  onRecheckClis: (hostId: string) => void;
}

export function ProviderCliUpdatesSection({
  machines,
  now,
  localDaemonHostId,
  serverHostId,
  retryPendingHostId,
  runningJobKey,
  queuedJobKeys,
  failuresByJobKey,
  onStartInstall,
  onRetryDaemonUpdate,
  onRetryAllDaemonUpdates,
  onRecheckClis,
}: ProviderCliUpdatesSectionProps) {
  const [expandedHostIds, setExpandedHostIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [showAll, setShowAll] = useState(false);
  const jobs = { runningJobKey, queuedJobKeys, failuresByJobKey };

  const remainingJobs = (runningJobKey === null ? 0 : 1) + queuedJobKeys.size;
  const [batch, setBatch] = useState({ total: 0, remaining: 0 });
  if (batch.remaining !== remainingJobs) {
    setBatch({
      total:
        remainingJobs === 0
          ? 0
          : batch.remaining === 0
            ? remainingJobs
            : batch.total + Math.max(0, remainingJobs - batch.remaining),
      remaining: remainingJobs,
    });
  }

  const attention = machines.filter((machine) =>
    machineNeedsAttention(machine, now),
  );
  const quiet = machines.filter(
    (machine) => !machineNeedsAttention(machine, now),
  );
  const listed = showAll ? [...attention, ...quiet] : attention;
  const startable = machines.flatMap((machine) =>
    machineProviderItems(machine, jobs)
      .filter(itemIsStartable)
      .map((item) => ({ hostId: machine.host.id, issue: item.issue })),
  );
  const stalledHostIds = machines
    .filter((machine) => machineDaemonState(machine, now) === "stalled")
    .map((machine) => machine.host.id);

  const updateAllButton =
    remainingJobs === 0 && startable.length > 0 ? (
      <UpdateActionButton
        label={`Update all ${startable.length} CLI tool${startable.length === 1 ? "" : "s"}`}
        tooltipLabel="Update all"
        icon={UPDATE_ACTION_ICON}
        visibleLabel="Update all"
        variant="default"
        onClick={() => {
          for (const { hostId, issue } of startable) {
            onStartInstall(hostId, issue);
          }
        }}
      />
    ) : null;
  const progress =
    remainingJobs > 0 ? (
      <span
        role="status"
        data-updates-progress
        className="flex h-7 items-center gap-1.5 text-xs text-subtle-foreground"
      >
        <Icon aria-hidden name="Loading" className="size-3.5 animate-spin" />
        {batch.total > 1 && batch.remaining === remainingJobs
          ? `Updating ${batch.total - remainingJobs + 1} of ${batch.total}`
          : "Updating"}
      </span>
    ) : null;
  const retryAllButton =
    stalledHostIds.length > BULK_RETRY_THRESHOLD ? (
      <UpdateActionButton
        label={`Update all ${stalledHostIds.length} machines now`}
        visibleLabel="Retry all"
        icon="RotateCcw"
        iconPosition="end"
        variant="default"
        className="font-medium"
        onClick={() => onRetryAllDaemonUpdates(stalledHostIds)}
      />
    ) : null;
  const bulkActions =
    retryAllButton !== null || updateAllButton !== null || progress !== null ? (
      <div
        role="toolbar"
        aria-label="Bulk update actions"
        className="flex flex-wrap items-center justify-end gap-2"
      >
        {progress}
        {retryAllButton}
        {updateAllButton}
      </div>
    ) : null;

  const summary = quietFleetSummary(quiet);
  return (
    <div data-updates-domain="provider-clis" className="space-y-2">
      <SettingsSection
        action={bulkActions}
        actionPlacement="inline"
        bodyClassName="overflow-hidden p-0"
        title="Provider CLIs"
      >
        {machines.length === 0 ? (
          <ResourceListState state="empty" message="No machines available." />
        ) : listed.length === 0 ? (
          <div
            data-updates-summary
            className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm text-muted-foreground"
          >
            <span className="flex h-5 w-6 shrink-0 items-center justify-center">
              <Icon
                aria-hidden
                name={summary.checking ? "Loading" : "CircleCheck"}
                className={cn(
                  "size-4 text-input",
                  summary.checking && "animate-spin",
                )}
              />
            </span>
            {summary.message}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {listed.map((machine) => {
              const hostId = machine.host.id;
              const tags = [
                hostId === serverHostId ? "Server" : null,
                machines.length > 1 && hostId === localDaemonHostId
                  ? "This machine"
                  : null,
              ].filter((tag): tag is string => tag !== null);
              return (
                <MachineUpdateRow
                  key={hostId}
                  machine={machine}
                  now={now}
                  tags={tags}
                  expanded={expandedHostIds.has(hostId)}
                  retryUpdatePending={retryPendingHostId === hostId}
                  runningJobKey={runningJobKey}
                  queuedJobKeys={queuedJobKeys}
                  failuresByJobKey={failuresByJobKey}
                  onToggle={() => {
                    setExpandedHostIds((current) => {
                      const next = new Set(current);
                      if (!next.delete(hostId)) {
                        next.add(hostId);
                      }
                      return next;
                    });
                  }}
                  onStartInstall={onStartInstall}
                  onRetryDaemonUpdate={onRetryDaemonUpdate}
                  onRecheckClis={onRecheckClis}
                />
              );
            })}
          </div>
        )}
      </SettingsSection>
      {quiet.length === 0 ? null : (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-subtle-foreground">
          {attention.length === 0 ? null : (
            <span>
              {quiet.length === 1
                ? "1 other machine has nothing to update"
                : `${quiet.length} other machines have nothing to update`}
            </span>
          )}
          <button
            type="button"
            aria-expanded={showAll}
            className="cursor-pointer rounded-sm underline decoration-border underline-offset-4 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll
              ? attention.length === 0
                ? "Hide machines"
                : "Hide"
              : attention.length === 0
                ? "Show machines"
                : "Show all"}
          </button>
        </p>
      )}
    </div>
  );
}

function desktopRowNeedsAttention(desktopInfo: BbDesktopInfo | null): boolean {
  if (desktopInfo === null) {
    return false;
  }
  if (
    desktopInfo.updateAvailable ||
    desktopInfo.updateDownloaded ||
    desktopInfo.downloadState === "downloading" ||
    desktopInfo.downloadState === "failed"
  ) {
    return true;
  }
  return (
    desktopInfo.latestVersion === null && desktopInfo.lastCheckedAt !== null
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

interface UpdatesSettingsSectionProps {
  showChangelogPreview?: boolean;
}

export function UpdatesSettingsSection({
  showChangelogPreview = false,
}: UpdatesSettingsSectionProps = {}) {
  const queryClient = useQueryClient();
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
  const hasStalledMachine = relevantFleetMachines.some(
    (machine) => machineDaemonState(machine, now) === "stalled",
  );
  const hasProviderUpdates = inventory.machines.some(
    (machine) => visibleProviderUpdateIssues(machine).length > 0,
  );
  const serverRunsSeparately =
    isDesktop && appUpdate !== undefined && !isDesktopOwnedServer(appUpdate);
  const hasUpdateWork =
    appUpdateVisible || hasProviderUpdates || hasStalledMachine;
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
      name={isDesktop ? "Desktop" : "Server"}
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
      name="Server"
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
      name="Desktop"
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

  function retryAllStalledDaemonUpdates(hostIds: string[]): void {
    for (const hostId of hostIds) {
      retryHostUpdate.mutate(hostId);
    }
    appToast.success(`Retrying the update on ${hostIds.length} machines`);
  }

  return (
    <div className="space-y-6">
      {showChangelogPreview ? <ChangelogPreviewCard /> : null}

      <BbUpdatesCard>
        {serverRunsSeparately ? serverAppRow : appRow}
        {serverRunsSeparately && desktopRowNeedsAttention(desktopInfo)
          ? desktopClientRow
          : null}
      </BbUpdatesCard>

      <ProviderCliUpdatesSection
        machines={inventory.machines}
        now={now}
        localDaemonHostId={localDaemonHostId}
        serverHostId={serverPrimaryHostId}
        retryPendingHostId={
          retryHostUpdate.isPending ? (retryHostUpdate.variables ?? null) : null
        }
        runningJobKey={runningJobKey}
        queuedJobKeys={queuedJobKeys}
        failuresByJobKey={failuresByJobKey}
        onStartInstall={(hostId, issue) => startInstall({ hostId, issue })}
        onRetryDaemonUpdate={retryDaemonUpdate}
        onRetryAllDaemonUpdates={retryAllStalledDaemonUpdates}
        onRecheckClis={(hostId) => {
          void invalidateHostProviderCliStatus({ queryClient, hostId });
        }}
      />
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
