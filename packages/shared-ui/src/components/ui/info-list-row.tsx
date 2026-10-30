import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS } from "./hover-reveal";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { TruncateStart } from "./truncate-start";

export const INFO_LIST_LEADING_CLASS =
  "flex size-3 shrink-0 items-center justify-center";

const INFO_LIST_ROW_CLASS =
  "group relative -mx-1 flex h-6 min-w-0 items-center gap-1.5 rounded px-1 transition-colors has-[:focus-visible]:bg-state-hover";

const INFO_LIST_PRIMARY_CLASS =
  "min-w-0 cursor-pointer truncate text-left text-xs leading-5 text-foreground no-underline after:absolute after:inset-0 after:rounded after:content-[''] focus-visible:outline-none";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function formatCompactRelativeTime({
  timestamp,
  now,
}: {
  timestamp: number;
  now: number;
}): string {
  const diffMs = now - timestamp;
  if (diffMs < MINUTE_MS) {
    return "now";
  }
  if (diffMs < HOUR_MS) {
    return `${Math.floor(diffMs / MINUTE_MS)}m`;
  }
  if (diffMs < DAY_MS) {
    return `${Math.floor(diffMs / HOUR_MS)}h`;
  }
  if (diffMs < WEEK_MS) {
    return `${Math.floor(diffMs / DAY_MS)}d`;
  }
  if (diffMs < 5 * WEEK_MS) {
    return `${Math.floor(diffMs / WEEK_MS)}w`;
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export type InfoListRowTarget =
  | { kind: "button"; onSelect: () => void }
  | {
      kind: "custom";
      render(primary: {
        className: string;
        title: string | undefined;
        children: ReactNode;
      }): ReactNode;
    };

export interface InfoListRowProps {
  leading: ReactNode;
  leadingLabel?: string;
  name: ReactNode;
  target: InfoListRowTarget | null;
  title?: string;
  context?: string | null;
  actions?: readonly InfoRowActionItem[];
  trailing?: ReactNode;
  selected?: boolean;
  depth?: number;
  expanded?: boolean;
}

const INFO_LIST_INDENT_REM = 1.125;

export function infoListIndentStyle(depth: number) {
  return depth > 0
    ? { paddingLeft: `calc(0.25rem + ${depth * INFO_LIST_INDENT_REM}rem)` }
    : undefined;
}

export function InfoListIndentGuides({ depth }: { depth: number }) {
  return Array.from({ length: depth }, (_, level) => (
    <span
      key={level}
      className="pointer-events-none absolute inset-y-0 w-px bg-border"
      style={{
        left: `calc(0.25rem + 5.5px + ${level * INFO_LIST_INDENT_REM}rem)`,
      }}
      aria-hidden
    />
  ));
}

export function InfoListRow({
  leading,
  leadingLabel,
  name,
  target,
  title,
  context,
  actions = [],
  trailing,
  selected = false,
  depth = 0,
  expanded,
}: InfoListRowProps) {
  const primary =
    target === null ? (
      <span
        title={title}
        className="min-w-0 truncate text-xs leading-5 text-foreground"
      >
        {name}
      </span>
    ) : target.kind === "custom" ? (
      target.render({
        className: INFO_LIST_PRIMARY_CLASS,
        title,
        children: name,
      })
    ) : (
      <button
        type="button"
        title={title}
        aria-expanded={expanded}
        onClick={target.onSelect}
        className={INFO_LIST_PRIMARY_CLASS}
      >
        {name}
      </button>
    );
  return (
    <li
      className={cn(INFO_LIST_ROW_CLASS, selected && "bg-state-active")}
      style={infoListIndentStyle(depth)}
      aria-current={selected ? "true" : undefined}
    >
      <InfoListIndentGuides depth={depth} />
      {leadingLabel ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              aria-label={leadingLabel}
              className={cn(INFO_LIST_LEADING_CLASS, "relative z-10")}
            >
              {leading}
            </span>
          </TooltipTrigger>
          <TooltipContent>{leadingLabel}</TooltipContent>
        </Tooltip>
      ) : (
        <span className={INFO_LIST_LEADING_CLASS}>{leading}</span>
      )}
      <span className="flex min-w-0 flex-1 items-center gap-1 pr-2">
        {primary}
        {context ? (
          <TruncateStart className="min-w-0 max-w-44 text-2xs text-subtle-foreground [flex-shrink:9999]">
            {context}
          </TruncateStart>
        ) : null}
        <InfoRowInlineActions actions={actions} />
      </span>
      <InfoRowTouchActionsMenu
        actions={actions}
        menuTitle={title ?? "Actions"}
      />
      {trailing}
    </li>
  );
}

export interface InfoRowActionItem {
  icon: IconName;
  label: string;
  onSelect: () => void;
}

const INFO_ROW_ACTION_CLASS = cn(
  "relative z-10 flex size-5 shrink-0 items-center justify-center rounded text-subtle-foreground opacity-0 transition-[opacity,background-color,color] hover:bg-state-active hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100",
  HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS,
);

function InfoRowAction({
  action,
  className,
}: {
  action: InfoRowActionItem;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={action.label}
          onClick={action.onSelect}
          className={cn(INFO_ROW_ACTION_CLASS, className)}
        >
          <Icon name={action.icon} className="size-3" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{action.label}</TooltipContent>
    </Tooltip>
  );
}

function InfoRowInlineActions({
  actions,
}: {
  actions: readonly InfoRowActionItem[];
}) {
  const collapsesOnTouch = actions.length > 1;
  return actions.map((action) => (
    <InfoRowAction
      key={action.label}
      action={action}
      className={collapsesOnTouch ? "[@media(hover:none)]:hidden" : undefined}
    />
  ));
}

function InfoRowTouchActionsMenu({
  actions,
  menuTitle,
}: {
  actions: readonly InfoRowActionItem[];
  menuTitle: string;
}) {
  if (actions.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More actions"
          className={cn(
            INFO_ROW_ACTION_CLASS,
            "hidden [@media(hover:none)]:flex",
          )}
        >
          <Icon name="MoreHorizontal" className="size-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" mobileTitle={menuTitle}>
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            onSelect={action.onSelect}
            textValue={action.label}
          >
            <Icon name={action.icon} className="size-3.5" aria-hidden />
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function InfoRowTime({
  timestamp,
  detail,
  now = Date.now(),
}: {
  timestamp: number;
  detail?: string;
  now?: number;
}) {
  const date = new Date(timestamp);
  const fullDate = date.toLocaleString();
  return (
    <time
      dateTime={date.toISOString()}
      title={detail ? `${detail} · ${fullDate}` : fullDate}
      className="relative z-10 shrink-0 text-2xs text-subtle-foreground tabular-nums"
    >
      {formatCompactRelativeTime({ timestamp, now })}
    </time>
  );
}
