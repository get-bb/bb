import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import type { SystemVersionResponse } from "@bb/server-contract";
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
  ResourceRow,
} from "@bb/shared-ui/resource-list";
import {
  hasProviderCliAction,
  isProviderCliUpdateIssue,
  useProviderCliInstallRunner,
  type ProviderCliActionableIssue,
  type ProviderCliIssue,
} from "@/components/provider-cli/provider-cli-install";
import {
  openProviderCliInstallLog,
  providerCliJobKey,
  type ProviderCliInstallFailure,
} from "@/components/provider-cli/provider-cli-install-store";
import {
  getAppUpdateCheckSnapshot,
  startAppUpdateCheck,
  subscribeAppUpdateCheck,
} from "@/components/settings/app-update-check-store";
import {
  CHANGELOG_RELEASE_META,
  fetchLatestChangelogEntry,
  LATEST_CHANGELOG_ENTRY,
  type ChangelogBlock,
} from "@/components/settings/changelog-preview";
import { appToast } from "@/components/ui/app-toast";
import { BbLogo } from "@/components/ui/bb-logo";
import { OverflowFade } from "@/components/ui/overflow-fade";
import {
  SettingsBadge,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { invalidateHostProviderCliStatus } from "@/hooks/cache-owners/provider-cli-status-cache-owner";
import { hydrateSystemVersionCache } from "@/hooks/cache-owners/system-version-cache-owner";
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
import {
  getSettingsMachineRoutePath,
  getSettingsProviderRoutePath,
} from "@/lib/route-paths";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { sdk } from "@/lib/sdk";
import { rawStringLocalStorage } from "@/lib/browser-storage";

const EMPTY_PROVIDER_CLI_FAILURES: ReadonlyMap<
  string,
  ProviderCliInstallFailure
> = new Map();
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

/** Stalled machines needed before the page offers a bulk retry. */
const BULK_RETRY_THRESHOLD = 1;

function updateCheckErrorDescription(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "The update check did not complete.";
}

/**
 * A row action. The icon-only form delegates to the shared
 * `ResourceActionButton`, which already owns the tooltip, the loading
 * spinner, and a `disabledReason` that explains a blocked action rather than
 * only greying it out. Labelled forms stay local — the shared atom is
 * icon-only by design.
 */
export function UpdateActionButton({
  label,
  tooltipLabel,
  icon,
  iconPosition = "start",
  visibleLabel,
  className,
  variant,
  loading = false,
  disabled = false,
  disabledReason,
  onClick,
}: {
  label: string;
  /** Short tooltip when the accessible label is a full sentence. */
  tooltipLabel?: string;
  icon: IconName;
  iconPosition?: "start" | "end";
  visibleLabel?: string;
  className?: string;
  variant?: ButtonProps["variant"];
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: ReactNode;
  onClick?: () => void;
}) {
  if (visibleLabel === undefined) {
    return (
      <ResourceActionButton
        label={label}
        tooltipLabel={tooltipLabel}
        icon={icon}
        loading={loading}
        disabled={disabled}
        disabledReason={disabledReason}
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
  // Only a quiet button gets the quiet text colour. Applying it regardless
  // painted `text-subtle-foreground` over a filled variant's own foreground —
  // mid-grey on near-black, which is unreadable rather than merely quiet.
  const isQuiet = variant === undefined || variant === "ghost";
  return (
    <Button
      type="button"
      variant={variant ?? "ghost"}
      size="sm"
      aria-label={label}
      aria-busy={loading}
      disabled={disabled}
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

export interface UpdatesSectionProps {
  /** Which machine or supporting domain this block covers. */
  domain: string;
  title: ReactNode;
  /** Right-hand slot for compact identity or contextual actions. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * One machine or supporting update block, using the same settings chrome as
 * the rest of Settings.
 */
export function UpdatesSection({
  domain,
  title,
  action,
  children,
}: UpdatesSectionProps) {
  return (
    <div data-updates-domain={domain}>
      <SettingsSection title={title} action={action}>
        {children}
      </SettingsSection>
    </div>
  );
}

/** Rows owned by one machine, on the settings card's own divider. */
export function UpdatesRowList({ children }: { children: ReactNode }) {
  return <SettingsRowList>{children}</SettingsRowList>;
}

/**
 * The grid every line in a card sits on: mark, content, trailing controls.
 *
 * One constant rather than one string per caller, because the whole point is
 * that they agree — `ResourceRow` uses this template internally, so a row, a
 * caption and bb's own row all end their content column in the same place and
 * truncate long text at the same point.
 */
const ROW_GRID =
  "grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3";

/**
 * A row with no destination — bb itself, which has no page of its own to open.
 * It borrows `ResourceRow`'s grid rather than its behaviour so its mark, name
 * and action land on the same three columns as the rows that are navigable;
 * a plain flex row put bb's name half a mark to the left of every CLI's.
 */
function UpdatesRow({
  leading,
  children,
  className,
}: {
  leading?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(ROW_GRID, "py-2.5 text-sm first:pt-0 last:pb-0", className)}
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        {leading}
      </span>
      {children}
    </div>
  );
}

/**
 * Versions read as part of the name's own phrase — "Codex 0.145.0 → 0.146.0" —
 * rather than as a right-aligned column. Sitting in the same line box as the
 * name is what keeps the baselines shared no matter how long the name is; a
 * right-flushed column drifted away from the text it described and had to be
 * re-anchored every time an action's width changed.
 *
 * Not `font-mono`. The mono stack resolves to a single face here, so
 * `font-medium` on the target version rendered at exactly the same weight as
 * the version you are on — measured identical widths at 400 through 700 — and
 * the pair lost the contrast that makes it scannable. Mono is still right for
 * the upgrade *command*, which is text you retype; a version number is prose.
 *
 * No current version means nothing is installed here; showing `latest` alone
 * would read as the version you have, so the row's status label says it.
 */
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
          {/* The only recoloured half of the pair: what you'd move to reads
              louder than what you're on, so the row is scannable without
              parsing two version numbers. Semibold, not medium — at 10px a
              single step buys almost no contrast, and small text needs more
              weight than body text to hold the same emphasis. */}
          <span className="font-semibold text-version-upgrade">{latest}</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * The bb app's row. `detail` carries the same weight as a machine row's
 * provider name: secondary to the thing's identity, ahead of its versions.
 */
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
      <RowVersions current={current} latest={latest} />
    </span>
  );
}

/**
 * A row's condition as one mark, named on hover.
 *
 * The bb card reports condition; the Providers card reports decisions. A
 * condition is the same handful of words on every row — "Up to date", "Offline"
 * — so spelling it out down a column reads as a wall of repetition that says
 * nothing about which row differs. A mark says which row differs at a glance.
 *
 * The tooltip is the state's name and nothing more. It does not repeat what the
 * row already prints (the CLI, the versions, the machine), and it never carries
 * something the reader has to act on — that is a visible caption's job. The
 * label is always in the accessibility tree, so nothing is hover-only for a
 * screen reader.
 */
/**
 * Red belongs to the statement of what is wrong, and to nothing else.
 *
 * A row says its condition exactly once — as words (`RowStateCaption`) or, when
 * it has no words, as the inert glyph. That one element carries the error tone.
 * Controls never do: a button is the way out of the problem, not part of it, and
 * a destructive-red "Retry" reads as a second failure rather than a recovery.
 *
 * So there are two red surfaces on this page and no others. Anything that takes
 * a click stays untinted, whatever state it belongs to.
 */
function stateTextClass(state: UpdateState): string {
  return UPDATE_STATE_PRESENTATION[state].tone === "error"
    ? "font-semibold text-destructive"
    : "font-semibold text-subtle-foreground";
}

/**
 * A state's words, placed beside the version rather than beside its control.
 *
 * The trailing column is the control spine: one thing per row sits on it. When
 * a row has both something to say and something to press, the words belong to
 * the row's identity — left, flush after the version — and the control keeps
 * the spine to itself.
 */
function RowStateCaption({
  state,
  children,
}: {
  state: UpdateState;
  children: ReactNode;
}) {
  return (
    <span className={cn("shrink-0 text-xs", stateTextClass(state))}>
      {children}
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
  /**
   * Overrides the state's glyph when the control does something other than the
   * state implies — the web bb row copies an upgrade command rather than
   * fetching anything, and a Download arrow there promises an install that
   * never happens.
   */
  actionIcon?: IconName;
  /**
   * What clicking does. This is the accessible name, so it stays specific —
   * two "Retry" buttons in a fleet are indistinguishable to a screen reader
   * without the machine in them.
   */
  actionLabel?: string;
  /**
   * The visible tooltip, when it should be shorter than the accessible name.
   * A tooltip sits next to the row that already prints the CLI, its versions
   * and its machine, so repeating them there is noise; a screen reader has no
   * such context and needs the long form.
   */
  actionTooltip?: string;
  /** Optional decorative mark before a labelled action. */
  buttonLeading?: ReactNode;
  /** Renders the control as a labelled button carrying the state's glyph. */
  buttonLabel?: string;
  loading?: boolean;
  live?: boolean;
  onClick?: () => void;
}) {
  const presentation = UPDATE_STATE_PRESENTATION[state];
  const icon = actionIcon ?? (presentation.icon as IconName | null);
  // A retryable failure defaults to the shared retry glyph. A caller can
  // provide a product mark when the action is specifically about that product.
  const buttonIcon =
    state === "failed" ? (RETRY_ACTION_ICON as IconName) : null;
  const spin = loading || presentation.inFlight === true;
  const srLabel = presentation.label;
  // A spinner is self-evident on sight, so it gets no tooltip — but it still
  // needs its words in the accessibility tree, where nothing is self-evident.
  const explainOnHover = presentation.inFlight !== true;

  // A state with a resolution is ONE labelled control carrying its mark — not
  // a mark beside a button repeating it.
  if (onClick !== undefined && buttonLabel !== undefined) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        {/* Untinted by rule — see `stateTextClass`. A failure's control wears
            the reload glyph; everything else is label-only. */}
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
          ) : buttonLeading !== undefined ? (
            buttonLeading
          ) : buttonIcon === null ? null : (
            <Icon aria-hidden name={buttonIcon} className="size-3" />
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

  // A glyph-less state still holds the spine, so a column of rows keeps one
  // right edge whether each row ends in an icon or a button.
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
          {/* The state and nothing else. Anything a reader has to act on is a
              visible caption; anything the row already shows is not repeated. */}
          <TooltipContent>{presentation.label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

/**
 * The trailing column, flush to the card's inner edge. Section bulk actions
 * land on the same edge, so every control on the page — per-row and
 * per-section — shares one right spine against the content's left one.
 */

function RowActions({ children }: { children: ReactNode }) {
  return (
    // `gap-1` is `ResourceRow`'s own gap between a row's meta and its action,
    // so a bb row's status lands on the same spine as every machine row's.
    <span className="ml-auto flex shrink-0 items-center justify-end gap-1">
      {children}
    </span>
  );
}

const CHANGELOG_INLINE_COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
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

/**
 * A compact card rendering of the same release structure as getbb.app. Version
 * and date stay in a short metadata line so the release content owns the full
 * card width. The bundled release stays available offline; the live source
 * keeps it current.
 */
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
  const releaseMeta = CHANGELOG_RELEASE_META[entry.version];
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
      <SettingsSection
        title={
          <span
            data-changelog-label
            className="inline-flex rounded-sm border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium leading-none text-muted-foreground"
          >
            What's new
          </span>
        }
        action={
          releaseVisible ? (
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
          ) : (
            <span aria-hidden className="block size-7" />
          )
        }
        bodyClassName="p-0"
      >
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
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  data-changelog-version={entry.version}
                  className="inline-flex rounded-full border border-border bg-muted/30 px-2.5 py-1 font-mono text-xs font-semibold leading-none tracking-tight text-foreground"
                >
                  {entry.version}
                </span>
                {releaseMeta === undefined ? null : (
                  <span className="text-xs text-muted-foreground">
                    {releaseMeta.date}
                  </span>
                )}
              </div>

              <div className="relative mt-3 min-w-0">
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
      </SettingsSection>
    </div>
  );
}

export interface BbAppUpdateRowsProps {
  systemVersion: SystemVersionResponse | undefined;
  desktopInfo: BbDesktopInfo | null;
  isDesktop: boolean;
  onRelaunchDesktop: (() => void) | null;
  onRetryDesktop: (() => void) | null;
  /** A check is in flight; the row says so instead of asserting a result. */
  isChecking?: boolean;
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
  isChecking = false,
}: BbAppUpdateRowsProps) {
  // No "checked 2m ago": opening this page runs the check, so the age of the
  // claim is always "since you got here" and printing it just gives the reader
  // a number to evaluate instead of an answer.
  const settledStatus = isChecking ? (
    <RowStateControl live state="in-progress" />
  ) : (
    <RowStateControl state="up-to-date" />
  );
  // Every branch below ends in the same shape — mark, name, status, action
  // slot — so no branch can quietly drop a column and knock the row out of the
  // page's spines.
  // One indicator per row. The state's mark *is* the control where the state
  // has a resolution, so a row never shows a condition beside a separate
  // button that means the same thing.
  const row = (name: ReactNode, indicator: ReactNode, caption?: ReactNode) => (
    <UpdatesRow
      leading={
        <span data-bb-update-role="app" aria-hidden>
          <BbLogo className="size-4" />
        </span>
      }
    >
      <span className="flex min-w-0 items-baseline gap-2">
        {name}
        {caption}
      </span>
      <RowActions>{indicator}</RowActions>
    </UpdatesRow>
  );
  if (isDesktop && desktopInfo === null) {
    return row(
      // One bb, however it happens to be packaged. The desktop shell and a
      // web/npm install are two ways to reach the same thing to update, not
      // two things, so the row does not rename itself per surface.
      <RowName name="bb app" current={null} latest={null} />,
      <RowStateControl live state="in-progress" />,
    );
  }

  if (desktopInfo !== null) {
    const pendingVersion =
      desktopInfo.pendingVersion ?? desktopInfo.latestVersion;
    const latest = desktopInfo.updateAvailable ? pendingVersion : null;
    const name = (
      <RowName name="bb app" current={desktopInfo.version} latest={latest} />
    );

    if (desktopInfo.updateDownloaded) {
      return row(
        name,
        // One control: a small bb mark inside its own outlined labelled button.
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
          buttonLabel="Retry"
          actionLabel="Retry the download"
          onClick={() => onRetryDesktop?.()}
        />,
        <RowStateCaption state="failed">Download failed</RowStateCaption>,
      );
    }
    if (desktopInfo.updateAvailable) {
      // The shell downloads on its own; the version pair in the name already
      // says what is coming, so the mark only says it is in hand.
      return row(name, <RowStateControl state="update-available" />);
    }
    return row(name, settledStatus);
  }

  if (systemVersion === undefined) {
    return row(
      <RowName name="bb app" current={null} latest={null} />,
      <RowStateControl state="in-progress" />,
    );
  }

  const name = (
    <RowName
      name="bb app"
      detail={
        systemVersion.updateAvailable ? (
          // The command is a readback of what the button copies, so it sits in
          // the same slot a machine row gives its provider name — secondary to
          // the thing's identity — instead of as a filled block competing with
          // the version column for the right edge.
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

  return row(name, settledStatus);
}

export interface MachineUpdatesRowsProps {
  machine: UpdateInventoryMachine;
  runningJobKey: string | null;
  queuedJobKeys: ReadonlySet<string>;
  failuresByJobKey?: ReadonlyMap<string, ProviderCliInstallFailure>;
  onStartInstall: (hostId: string, issue: ProviderCliActionableIssue) => void;
  /** Opens that provider's own settings page — the row's real destination. */
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

/**
 * A machine's bb daemon condition. The machine name now owns the section, so
 * the row names the software that needs attention and uses the same bb mark as
 * the app row. App-versus-daemon is text, never an unexplained icon swap.
 */
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
  // The daemon is ahead of this server, so no amount of retrying on the
  // machine can fix it — the server is the thing that has to move. Left
  // unnamed, the row said only "Offline", which is true and useless: it sends
  // the reader to check a network that is working. The caption says "this app"
  // rather than "bb" because the opposite direction — a machine whose daemon
  // is behind — is a different row entirely (it self-updates, with a Retry),
  // and "Update bb" reads as an instruction to go touch the remote machine.
  const machineIsAhead = hostNeedsUpdate(host) && !hostCanRetryUpdate(host);
  const offline = host.status !== "connected";

  // Words beside the name; the trailing column stays the control spine.
  const daemonCaption = updateStalled ? (
    <RowStateCaption state="failed">Update didn&apos;t finish</RowStateCaption>
  ) : machineIsAhead ? (
    <RowStateCaption state="offline">
      Update this app to reconnect
    </RowStateCaption>
  ) : null;

  return (
    <ResourceRow
      className="py-2"
      actionsVisibility="always"
      openLabel={`Open ${host.name} settings`}
      onOpen={() => onOpenMachine(host.id)}
      leading={
        <span data-bb-update-role="daemon" aria-hidden>
          <BbLogo className="size-4" />
        </span>
      }
      title="bb daemon"
      state={daemonCaption}
      trailingMeta={null}
      actions={
        // One indicator. `waiting-to-retry` is the only machine state with a
        // resolution here, so it is the only one drawn as a control; the rest
        // are conditions and say so on hover.
        updating ? (
          <RowStateControl live state="in-progress" />
        ) : updateStalled ? (
          <RowStateControl
            state="failed"
            buttonLabel="Retry"
            actionLabel={`Retry on ${host.name} now`}
            loading={retryUpdatePending}
            onClick={() => onRetryDaemonUpdate(host.id)}
          />
        ) : machineIsAhead ? (
          // No "needs attention": that names a feeling, not a fix. The row
          // says what is true (unreachable) and what resolves it (update the
          // app it is talking to).
          <RowStateControl state="offline" />
        ) : offline ? (
          <RowStateControl state="offline" />
        ) : null
      }
    />
  );
}

/** A recoverable provider status failure, kept distinct from bb's daemon. */
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
      className="py-2"
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
      state={
        <RowStateCaption state="failed">
          Couldn&apos;t check for updates
        </RowStateCaption>
      }
      trailingMeta={null}
      actions={
        <RowStateControl
          state="failed"
          buttonLabel="Retry"
          actionLabel={`Check ${host.name}'s CLIs again`}
          loading={machine.statusFetching}
          onClick={() => onRecheckClis(host.id)}
        />
      }
    />
  );
}

/**
 * The one update state a CLI row is in.
 *
 * Keyed off the same vocabulary the bb rows and `bb updates` use, so a CLI
 * that reads "update available" in Settings reads "update available" in the
 * terminal too. A CLI with nothing wrong produces no issue and so no row.
 *
 * `not-installed` is absent on purpose: this page filters to update issues, so
 * a CLI without an installed version never reaches a row here. The state still
 * exists in the shared vocabulary because `bb updates` prints a full status
 * table and does report it.
 */
function providerRowState({
  issue,
}: {
  issue: ProviderCliIssue | null;
}): UpdateState | null {
  if (issue === null) {
    return "up-to-date";
  }
  if (issue.action === null) {
    return "update-manually";
  }
  return "update-available";
}

/** Provider update rows owned by the surrounding machine section. */
export function MachineUpdatesRows({
  machine,
  runningJobKey,
  queuedJobKeys,
  failuresByJobKey = EMPTY_PROVIDER_CLI_FAILURES,
  onStartInstall,
  onOpenProvider,
}: MachineUpdatesRowsProps) {
  const { host } = machine;
  const updateIssues = visibleProviderUpdateIssues(machine);
  const issuesByProvider = new Map(
    updateIssues.map((issue) => [issue.provider, issue]),
  );

  if (updateIssues.length === 0) {
    return null;
  }

  const rows = updateIssues.map((listedIssue) => {
    const provider = listedIssue.provider;
    const status = machine.providerStatus?.[provider];
    if (status === undefined) {
      return null;
    }
    const issue = issuesByProvider.get(provider) ?? null;
    const state = providerRowState({ issue });
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
    const ProviderIcon = getProviderIconInfo(providerId)?.icon;
    return (
      <ResourceRow
        key={provider}
        className="py-2"
        actionsVisibility="always"
        openLabel={`Open ${status.displayName} settings`}
        onOpen={() => onOpenProvider(providerId)}
        leading={
          ProviderIcon === undefined ? null : (
            <span data-provider-icon={providerId} aria-hidden>
              <ProviderIcon className="size-3.5 text-muted-foreground" />
            </span>
          )
        }
        title={status.displayName}
        titleMeta={
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <RowVersions
              current={status.currentVersion}
              latest={issue !== null ? status.latestVersion : null}
            />
            {failure === null ? null : (
              <>
                <RowStateCaption state="failed">Failed</RowStateCaption>
                <code
                  role="alert"
                  className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-xs text-destructive"
                >
                  {failure.logDialogState.message}
                </code>
              </>
            )}
          </span>
        }
        trailingMeta={null}
        actions={
          running ? (
            <RowStateControl live state="in-progress" />
          ) : queued ? (
            <RowStateControl live state="in-progress" />
          ) : failure !== null ? (
            <span className="flex items-center gap-1">
              <UpdateActionButton
                label={`View ${status.displayName} update log`}
                tooltipLabel="View log"
                icon="File"
                onClick={() =>
                  openProviderCliInstallLog(failure.logDialogState)
                }
              />
              {actionable ? (
                <RowStateControl
                  state="failed"
                  actionLabel={`Retry ${status.displayName} on ${host.name}`}
                  actionTooltip="Retry"
                  onClick={() => onStartInstall(host.id, issue)}
                />
              ) : null}
            </span>
          ) : state === null ? null : (
            <RowStateControl
              state={state}
              actionLabel={
                actionable
                  ? `${issue.action.label} ${status.displayName} on ${host.name}`
                  : undefined
              }
              // Just the verb on hover. The row already carries the CLI's
              // name, its versions, and the machine heading above it.
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

/** One machine owns one settings section; the badge makes local scope explicit. */
export function MachineUpdatesSection({
  machine,
  isThisMachine,
  action,
  children,
}: {
  machine: UpdateInventoryMachine;
  isThisMachine: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-updates-machine={machine.host.id}>
      <UpdatesSection
        domain="machine"
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Icon
              name="Laptop"
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="truncate">{machine.host.name}</span>
            {isThisMachine ? <SettingsBadge>This machine</SettingsBadge> : null}
          </span>
        }
        action={
          action === undefined ? undefined : (
            <div className="pr-4">{action}</div>
          )
        }
      >
        <UpdatesRowList>{children}</UpdatesRowList>
      </UpdatesSection>
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
export interface UpdatesSettingsSectionProps {
  /** Default-off experiment gate owned by Settings → Experiments. */
  showChangelogPreview?: boolean;
}

export function UpdatesSettingsSection({
  showChangelogPreview = false,
}: UpdatesSettingsSectionProps = {}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const inventory = useUpdateInventory();
  const { localDaemonHostId } = useHostDaemon();
  const { desktopApi, desktopInfo, isDesktop } = useDesktopUpdateInfo();
  const retryHostUpdate = useRetryHostUpdate();
  // The check store outlives this view, so an in-flight check stays visible
  // across navigation and a failure still toasts even if we unmount.
  const isChecking = useSyncExternalStore(
    subscribeAppUpdateCheck,
    getAppUpdateCheckSnapshot,
  );
  const now = useNow(30_000);
  const { failuresByJobKey, queuedJobKeys, runningJobKey, startInstall } =
    useProviderCliInstallRunner();

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

  // Opening the page is the request to check, so there is no button to press.
  // This waits for the host list rather than firing on the first render: the
  // check invalidates each connected machine's CLI status, and on mount that
  // list is still empty, so an immediate run would refresh the app version and
  // silently skip every machine.
  const hostsSettled = !inventory.isLoading;
  const checkedOnLoad = useRef(false);
  useEffect(() => {
    if (checkedOnLoad.current || !hostsSettled) {
      return;
    }
    checkedOnLoad.current = true;
    handleCheckForUpdates();
    // Deliberately runs once per mount; `handleCheckForUpdates` closes over the
    // host snapshot taken at that moment, which is what the check should use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostsSettled]);

  const appUpdateVisible =
    desktopInfo?.updateAvailable === true ||
    inventory.systemVersion?.updateAvailable === true ||
    inventory.appUpdateAvailable;
  const relevantFleetMachines = inventory.machines.filter(
    machineHasRelevantHealthStatus,
  );
  // A machine whose own bb update has stalled is outstanding update work, not
  // just fleet trivia: it is the third update domain, and the page would claim
  // everything is settled while a stalled row sat under it.
  const stalledMachines = relevantFleetMachines.filter(
    (machine) =>
      machine.canRetryDaemonUpdate && hostUpdateIsStalled(machine.host, now),
  );
  const appMachine =
    inventory.machines.find((machine) => machine.isPrimary) ??
    inventory.machines[0] ??
    null;
  const visibleMachines = inventory.machines.filter(
    (machine) =>
      machine.host.id === appMachine?.host.id ||
      machineHasRelevantHealthStatus(machine) ||
      visibleProviderUpdateIssues(machine).length > 0,
  );
  const hasUpdateWork =
    appUpdateVisible ||
    visibleProviderIssues.length > 0 ||
    stalledMachines.length > 0;
  const fleetIsHealthy = relevantFleetMachines.length === 0;
  const showFallbackBbStatus =
    !hasUpdateWork && !fleetIsHealthy && isDesktop && desktopInfo === null;

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

  // One toast for the whole sweep: a per-machine confirmation would stack as
  // many toasts as there are stalled machines, which is exactly the pile the
  // consolidated Updates page replaced.
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
        iconPosition="end"
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
      {showChangelogPreview ? <ChangelogPreviewCard /> : null}

      {visibleMachines.length === 0 ? (
        <ResourceListState state="empty" message="No machines available." />
      ) : (
        visibleMachines.map((machine, index) => {
          const ownsApp = machine.host.id === appMachine?.host.id;
          const showDaemon =
            machine.canRetryDaemonUpdate || machine.host.status !== "connected";
          return (
            <MachineUpdatesSection
              key={machine.host.id}
              machine={machine}
              isThisMachine={
                inventory.machines.length > 1 &&
                machine.host.id === localDaemonHostId
              }
              action={index === 0 ? bulkActions : null}
            >
              {ownsApp ? (
                <BbAppUpdateRows
                  systemVersion={inventory.systemVersion}
                  desktopInfo={desktopInfo}
                  isDesktop={isDesktop}
                  isChecking={isChecking}
                  onRelaunchDesktop={
                    desktopApi === null || showFallbackBbStatus
                      ? null
                      : () => {
                          void desktopApi.installUpdate().catch((error) => {
                            appToast.error("Relaunch failed", {
                              description: updateCheckErrorDescription(error),
                            });
                          });
                        }
                  }
                  onRetryDesktop={
                    desktopApi === null || showFallbackBbStatus
                      ? null
                      : () => {
                          void desktopApi.checkForUpdates().catch((error) => {
                            appToast.error("Update retry failed", {
                              description: updateCheckErrorDescription(error),
                            });
                          });
                        }
                  }
                />
              ) : null}
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
                onOpenProvider={(providerId) =>
                  navigate(getSettingsProviderRoutePath(providerId))
                }
              />
            </MachineUpdatesSection>
          );
        })
      )}
    </div>
  );
}
