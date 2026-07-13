import { useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePreferredTheme } from "@/hooks/useTheme";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

/**
 * Shared pieces of the Settings → Plugins surfaces. Tinted styles derive
 * from the theme anchors per the repo palette rules: opaque steps mix in
 * oklch; only transparent-pole mixes use oklab.
 */

/** Green "Update X.Y.Z" tint (sketch v2 `.pill.update`). */
export const UPDATE_TINT_STYLE = {
  background: "color-mix(in oklch, var(--success) 14%, var(--canvas))",
  borderColor: "color-mix(in oklch, var(--success) 35%, var(--canvas))",
  color: "color-mix(in oklch, var(--success) 80%, var(--ink))",
} as const;

/** Destructive "Needs attention" tint (sketch v2 `.pill.bad`). */
export const ATTENTION_TINT_STYLE = {
  background: "color-mix(in oklch, var(--destructive-text) 9%, var(--canvas))",
  borderColor:
    "color-mix(in oklch, var(--destructive-text) 28%, var(--canvas))",
  color: "var(--destructive-text)",
} as const;

/** Success verdict banner tint (sketch v2 `.banner`). */
export const SUCCESS_BANNER_STYLE = {
  background: "color-mix(in oklch, var(--success) 9%, var(--canvas))",
  borderColor: "color-mix(in oklch, var(--success) 35%, var(--canvas))",
} as const;

/** Warning note tint (sketch `.notebox.warn`, full-trust warning). */
export const WARNING_NOTE_STYLE = {
  background: "color-mix(in oklch, var(--warning-text) 6%, var(--canvas))",
  borderColor: "color-mix(in oklch, var(--warning-text) 35%, var(--canvas))",
} as const;

export const SUCCESS_TEXT_STYLE = {
  color: "color-mix(in oklch, var(--success) 80%, var(--ink))",
} as const;

export function PluginLogo({
  plugin,
  className,
}: {
  plugin: PluginListItem;
  className: string;
}) {
  const theme = usePreferredTheme();
  const logoUrl =
    theme === "dark" && plugin.logoDarkUrl !== null
      ? plugin.logoDarkUrl
      : plugin.logoUrl;
  if (logoUrl === null) {
    return <LetterBadge label={plugin.displayName ?? plugin.id} className={className} />;
  }
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      data-testid={`plugin-settings-logo-${plugin.id}`}
      className={cn("rounded-sm object-contain", className)}
    />
  );
}

/** Letter avatar for entries without a shipped logo (browse cards, rows). */
export function LetterBadge({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold text-muted-foreground",
        className,
      )}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function formatAbsoluteDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface DetailsDisclosureProps {
  summary: string;
  children: ReactNode;
  /** Pre-expand when the details are the story (failure, skipped release). */
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * The Layer 3 evidence disclosure: collapsed when the verdict line is the
 * whole story, pre-expanded when a check failed or something surprising
 * happened.
 */
export function DetailsDisclosure({
  summary,
  children,
  defaultExpanded = false,
  className,
}: DetailsDisclosureProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border-seam text-xs",
        className,
      )}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 bg-muted/40 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="min-w-0 truncate">{summary}</span>
        <Icon
          name="ChevronDown"
          className={cn("size-3.5 shrink-0", expanded && "rotate-180")}
        />
      </button>
      {expanded ? (
        <div className="border-t border-border-seam px-3 py-2.5">{children}</div>
      ) : null}
    </div>
  );
}

/** Key/value grid used in dialogs and the source-details disclosure. */
export function KeyValueGrid({
  entries,
}: {
  entries: { key: string; value: ReactNode; mono?: boolean }[];
}) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-xs">
      {entries.map((entry) => (
        <div key={entry.key} className="contents">
          <dt className="text-muted-foreground">{entry.key}</dt>
          <dd
            className={cn(
              "min-w-0 break-words text-foreground",
              entry.mono !== false && "font-mono",
            )}
          >
            {entry.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The full-trust warning — never collapsed (locked design rule). */
export function FullTrustWarning() {
  return (
    <div
      className="flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs text-foreground"
      style={WARNING_NOTE_STYLE}
      data-testid="full-trust-warning"
    >
      <span
        className="mt-0.5 shrink-0"
        style={{ color: "var(--warning-text)" }}
      >
        <Icon name="AlertTriangle" className="size-3.5" />
      </span>
      <span>
        <span className="font-medium">Plugins are full-trust code</span> running
        inside the BB server. They can read all local BB data, including other
        plugins&rsquo; secrets. Only install sources you trust.
      </span>
    </div>
  );
}

/** The rollback promise — always visible in update dialogs (locked rule). */
export function RollbackNote({
  fromVersion,
  toVersion,
}: {
  fromVersion: string;
  toVersion: string;
}) {
  return (
    <div
      className="flex gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground"
      data-testid="rollback-note"
    >
      <Icon name="RotateCcw" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Your plugin data is snapshotted first — if {toVersion} fails to start,
        bb restores {fromVersion} and its data automatically.
      </span>
    </div>
  );
}
