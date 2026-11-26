import { Fragment, useId, useState, type ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  INFO_LIST_DEFAULT_LIMIT,
  infoListCollapses,
  InfoListMoreRow,
} from "@bb/shared-ui/info-list-more-row";
import { useScopedInfoSectionCollapse } from "./useInfoSectionCollapse";

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

export const INFO_SECTION_TITLE_CLASS =
  "m-0 flex min-w-0 items-center text-xs font-medium leading-5 text-muted-foreground";

export function InfoSectionHeading({
  label,
  count,
  accessory,
  trailing,
  collapse,
  bodyId,
  className,
}: InfoSectionHeadingProps & { bodyId: string; className?: string }) {
  const countPill =
    count === undefined ? null : <InfoCountPill count={count} />;
  const collapsed = collapse?.collapsed ?? false;
  return (
    <div
      className={cn(
        "mb-1 flex min-h-5 min-w-0 items-center justify-between gap-3",
        className,
      )}
    >
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

export interface InfoListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  limit?: number;
}

export function InfoList<T>({
  items,
  getKey,
  renderItem,
  limit = INFO_LIST_DEFAULT_LIMIT,
}: InfoListProps<T>) {
  const [isExpanded, setIsExpanded] = useState(false);
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
