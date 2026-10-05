import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { formatCompactRelativeTime } from "@/lib/relative-time";

export const INFO_LIST_SLOT_CLASS =
  "flex size-3 shrink-0 items-center justify-center";

const INFO_LIST_ROW_CLASS =
  "group relative -mx-1 flex h-6 min-w-0 items-center gap-1.5 rounded px-1 transition-colors hover:bg-state-hover";

const INFO_LIST_PRIMARY_CLASS =
  "min-w-0 truncate text-left text-xs leading-5 text-foreground no-underline after:absolute after:inset-0 after:rounded after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring";

export const INFO_LIST_DEFAULT_LIMIT = 5;

export function InfoCountPill({ count }: { count: number }) {
  return (
    <span className="ml-1.5 rounded-full bg-surface-recessed px-1.5 text-2xs leading-4 font-normal text-muted-foreground tabular-nums">
      {count}
    </span>
  );
}

export function InfoSectionHeading({
  label,
  count,
  trailing,
}: {
  label: ReactNode;
  count?: number;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-1 flex h-5 min-w-0 items-center justify-between gap-3">
      <h3 className="m-0 flex min-w-0 items-center text-xs font-medium leading-5 text-muted-foreground">
        {label}
        {count === undefined ? null : <InfoCountPill count={count} />}
      </h3>
      {trailing}
    </div>
  );
}

export type InfoListRowTarget =
  | { kind: "button"; onSelect: () => void }
  | { kind: "link"; to: string };

export function InfoListRow({
  slot,
  name,
  title,
  target,
  context,
  action,
  meta,
  selected = false,
}: {
  slot: ReactNode;
  name: ReactNode;
  title?: string;
  target: InfoListRowTarget | null;
  context?: string | null;
  action?: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
}) {
  const primary =
    target === null ? (
      <span className="min-w-0 truncate text-xs leading-5 text-foreground">
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
      <span className={INFO_LIST_SLOT_CLASS}>{slot}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1 pr-6">
        {primary}
        {context ? (
          <span className="shrink-0 text-2xs text-subtle-foreground">
            {context}
          </span>
        ) : null}
        {action}
      </span>
      {meta}
    </li>
  );
}

export function InfoRowAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="relative z-10 flex size-4 shrink-0 items-center justify-center rounded text-subtle-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 pointer-coarse:opacity-100"
        >
          <Icon name={icon} className="size-3" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function InfoRowTime({
  timestamp,
  now,
  detail,
}: {
  timestamp: number;
  now: number;
  detail?: string;
}) {
  const date = new Date(timestamp);
  const fullDate = date.toLocaleString();
  return (
    <time
      dateTime={date.toISOString()}
      title={detail ? `${detail} · ${fullDate}` : fullDate}
      className="shrink-0 text-2xs text-subtle-foreground tabular-nums"
    >
      {formatCompactRelativeTime({ timestamp, now })}
    </time>
  );
}

export function InfoList<T>({
  items,
  getKey,
  renderItem,
  limit = INFO_LIST_DEFAULT_LIMIT,
  rail = false,
}: {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  limit?: number;
  rail?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canToggle = items.length > limit + 1;
  const visibleItems = canToggle && !isExpanded ? items.slice(0, limit) : items;
  return (
    <ul className="relative m-0 list-none p-0">
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
            className="-mx-1 flex h-6 w-[calc(100%+0.5rem)] min-w-0 items-center gap-1.5 rounded px-1 text-left text-2xs text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={INFO_LIST_SLOT_CLASS}>
              <Icon
                name="ChevronDown"
                className={cn(
                  "size-3 transition-transform",
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
