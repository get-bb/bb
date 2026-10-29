import { Fragment, useId, useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  INFO_LIST_LEADING_CLASS,
  InfoListIndentGuides,
  infoListIndentStyle,
} from "@bb/shared-ui/info-list-row";
import { useScopedInfoSectionCollapse } from "./useInfoSectionCollapse";

export const INFO_LIST_CARET_CLASS = "size-3 shrink-0 transition-transform";

const INFO_LIST_DEFAULT_LIMIT = 5;

export function infoListCollapses(
  count: number,
  limit: number = INFO_LIST_DEFAULT_LIMIT,
): boolean {
  return count > limit + 1;
}

const INFO_LIST_QUIET_CONTROL_CLASS =
  "rounded text-2xs text-subtle-foreground transition-colors hover:text-foreground focus-visible:bg-state-hover focus-visible:text-foreground focus-visible:outline-none";

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

export interface InfoSectionProps extends InfoSectionHeadingProps {
  children: ReactNode;
}

export function InfoSection({
  children,
  collapse,
  ...heading
}: InfoSectionProps) {
  const bodyId = useId();
  const scopedCollapse = useScopedInfoSectionCollapse();
  const resolvedCollapse = collapse ?? scopedCollapse;
  const collapsed = resolvedCollapse?.collapsed ?? false;
  return (
    <section data-info-section="" className="min-w-0">
      <InfoSectionHeading
        {...heading}
        collapse={resolvedCollapse}
        bodyId={bodyId}
      />
      {collapsed ? null : <div id={bodyId}>{children}</div>}
    </section>
  );
}

export function InfoListMoreRow({
  label,
  expanded,
  onToggle,
  depth = 0,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  depth?: number;
}) {
  return (
    <li className="relative">
      <InfoListIndentGuides depth={depth} />
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        style={infoListIndentStyle(depth)}
        className={cn(
          INFO_LIST_QUIET_CONTROL_CLASS,
          "-mx-1 flex h-6 w-[calc(100%+0.5rem)] min-w-0 cursor-pointer items-center gap-1.5 px-1 text-left",
        )}
      >
        <span className={INFO_LIST_LEADING_CLASS}>
          <Icon
            name="ChevronDown"
            className={cn(INFO_LIST_CARET_CLASS, expanded && "rotate-180")}
            aria-hidden
          />
        </span>
        {label}
      </button>
    </li>
  );
}

export interface InfoListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  limit?: number;
  revealIndex?: number | null;
}

export function InfoList<T>({
  items,
  getKey,
  renderItem,
  limit = INFO_LIST_DEFAULT_LIMIT,
  revealIndex = null,
}: InfoListProps<T>) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [revealedIndex, setRevealedIndex] = useState<number | null>(null);
  if (revealIndex !== revealedIndex) {
    setRevealedIndex(revealIndex);
    if (revealIndex !== null && revealIndex >= limit) setIsExpanded(true);
  }
  const canToggle = infoListCollapses(items.length, limit);
  const visibleItems = canToggle && !isExpanded ? items.slice(0, limit) : items;
  return (
    <ul className="relative m-0 list-none p-0 max-md:pointer-coarse:[--text-xs--line-height:1.125rem] max-md:pointer-coarse:[--text-xs:0.8125rem]">
      {visibleItems.map((item) => (
        <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>
      ))}
      {canToggle ? (
        <InfoListMoreRow
          label={isExpanded ? "Show less" : `${items.length - limit} more`}
          expanded={isExpanded}
          onToggle={() => setIsExpanded((value) => !value)}
        />
      ) : null}
    </ul>
  );
}
