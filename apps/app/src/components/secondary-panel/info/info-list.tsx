import { Fragment, useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS } from "@bb/shared-ui/hover-reveal";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { formatCompactRelativeTime } from "@/lib/relative-time";

const INFO_LIST_LEADING_CLASS =
  "flex size-3 shrink-0 items-center justify-center";

const INFO_LIST_CARET_CLASS = "size-3 shrink-0 transition-transform";

const INFO_LIST_DEFAULT_LIMIT = 5;

export function infoListCollapses(
  count: number,
  limit: number = INFO_LIST_DEFAULT_LIMIT,
): boolean {
  return count > limit + 1;
}

const INFO_LIST_ROW_CLASS =
  "group relative -mx-1 flex h-6 min-w-0 items-center gap-1.5 rounded px-1 transition-colors hover:bg-state-hover";

const INFO_LIST_PRIMARY_CLASS =
  "min-w-0 truncate text-left text-xs leading-5 text-foreground no-underline after:absolute after:inset-0 after:rounded after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring";

const INFO_LIST_QUIET_CONTROL_CLASS =
  "rounded text-2xs text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function InfoCountPill({ count }: { count: number }) {
  return (
    <span className="ml-1.5 rounded-full bg-surface-recessed px-1.5 text-2xs leading-4 font-normal text-muted-foreground tabular-nums">
      {count}
    </span>
  );
}

export interface InfoSectionCollapse {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

export interface InfoSectionHeadingProps {
  label: string;
  count?: number;
  accessory?: ReactNode;
  trailing?: ReactNode;
  collapse?: InfoSectionCollapse;
}

const INFO_SECTION_TITLE_CLASS =
  "m-0 flex min-w-0 items-center text-xs font-medium leading-5 text-muted-foreground";

function InfoSectionHeading({
  label,
  count,
  accessory,
  trailing,
  collapse,
  bodyId,
}: InfoSectionHeadingProps & { bodyId: string }) {
  const countPill =
    count === undefined ? null : <InfoCountPill count={count} />;
  const collapsed = collapse?.collapsed ?? false;
  return (
    <div className="mb-1 flex min-h-5 min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center">
        {collapse ? (
          <h3 className={INFO_SECTION_TITLE_CLASS}>
            <button
              type="button"
              aria-expanded={!collapse.collapsed}
              aria-controls={bodyId}
              onClick={() => collapse.setCollapsed(!collapse.collapsed)}
              className="-mx-1.5 -my-0.5 flex min-w-0 items-center rounded-md px-1.5 py-0.5 transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:pointer-coarse:min-h-8"
            >
              <span className="truncate">{label}</span>
              {countPill}
            </button>
          </h3>
        ) : (
          <>
            <h3 className={INFO_SECTION_TITLE_CLASS}>{label}</h3>
            {countPill}
          </>
        )}
        {collapsed ? null : accessory}
      </div>
      {collapsed ? null : trailing}
    </div>
  );
}

export function InfoSubheading({
  label,
  count,
  trailing,
}: {
  label: string;
  count: number;
  trailing?: ReactNode;
}) {
  return (
    <div className="mt-3 mb-1 flex h-5 min-w-0 items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1 text-2xs text-subtle-foreground">
        <span className="truncate">{label}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{count}</span>
      </span>
      {trailing}
    </div>
  );
}

export interface InfoSectionProps extends InfoSectionHeadingProps {
  children: ReactNode;
}

export function InfoSection({ children, ...heading }: InfoSectionProps) {
  const bodyId = useId();
  const collapsed = heading.collapse?.collapsed ?? false;
  return (
    <section className="min-w-0">
      <InfoSectionHeading {...heading} bodyId={bodyId} />
      {collapsed ? null : <div id={bodyId}>{children}</div>}
    </section>
  );
}

export type InfoListRowTarget =
  | { kind: "button"; onSelect: () => void }
  | { kind: "link"; to: string };

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
}: InfoListRowProps) {
  const primary =
    target === null ? (
      <span
        title={title}
        className="min-w-0 truncate text-xs leading-5 text-foreground"
      >
        {name}
      </span>
    ) : target.kind === "link" ? (
      <Link to={target.to} title={title} className={INFO_LIST_PRIMARY_CLASS}>
        {name}
      </Link>
    ) : (
      <button
        type="button"
        title={title}
        onClick={target.onSelect}
        className={INFO_LIST_PRIMARY_CLASS}
      >
        {name}
      </button>
    );
  return (
    <li
      className={cn(INFO_LIST_ROW_CLASS, selected && "bg-state-active")}
      aria-current={selected ? "true" : undefined}
    >
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
          <span className="shrink-0 text-2xs text-subtle-foreground">
            {context}
          </span>
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
          className={cn(INFO_ROW_ACTION_CLASS, "hidden [@media(hover:none)]:flex")}
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

export interface InfoListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  limit?: number;
  rail?: boolean;
}

export function InfoList<T>({
  items,
  getKey,
  renderItem,
  limit = INFO_LIST_DEFAULT_LIMIT,
  rail = false,
}: InfoListProps<T>) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canToggle = infoListCollapses(items.length, limit);
  const visibleItems = canToggle && !isExpanded ? items.slice(0, limit) : items;
  return (
    <ul className="relative m-0 list-none p-0 max-md:pointer-coarse:[--text-xs--line-height:1.125rem] max-md:pointer-coarse:[--text-xs:0.8125rem]">
      {rail ? (
        <span
          className="pointer-events-none absolute top-3 bottom-3 left-[5.5px] w-px bg-border"
          aria-hidden
        />
      ) : null}
      {visibleItems.map((item) => (
        <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>
      ))}
      {canToggle ? (
        <li>
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((value) => !value)}
            className={cn(
              INFO_LIST_QUIET_CONTROL_CLASS,
              "-mx-1 flex h-6 w-[calc(100%+0.5rem)] min-w-0 items-center gap-1.5 px-1 text-left hover:bg-state-hover",
            )}
          >
            <span className={INFO_LIST_LEADING_CLASS}>
              <Icon
                name="ChevronDown"
                className={cn(
                  INFO_LIST_CARET_CLASS,
                  isExpanded && "rotate-180",
                )}
                aria-hidden
              />
            </span>
            {isExpanded ? "Show less" : `${items.length - limit} more`}
          </button>
        </li>
      ) : null}
    </ul>
  );
}
