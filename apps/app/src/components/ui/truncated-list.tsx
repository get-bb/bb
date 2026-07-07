import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";

const DEFAULT_VISIBLE_LIMIT = 5;

export interface TruncatedListProps<T> {
  items: readonly T[];
  renderItem: (item: T) => ReactNode;
  getKey: (item: T) => string;
  /** Maximum items shown before truncating. Defaults to 5. */
  limit?: number;
  /** Class applied to the items container. */
  className?: string;
}

/**
 * Renders a vertical list that caps at `limit` items and reveals the rest
 * behind a "Show N more" / "Show less" toggle. The toggle only appears when
 * the list exceeds the limit.
 */
export function TruncatedList<T>({
  items,
  renderItem,
  getKey,
  limit = DEFAULT_VISIBLE_LIMIT,
  className,
}: TruncatedListProps<T>) {
  const [isExpanded, setIsExpanded] = useState(false);

  const canToggle = items.length > limit;
  const visibleItems = useMemo(
    () => (isExpanded || !canToggle ? items : items.slice(0, limit)),
    [items, isExpanded, canToggle, limit],
  );
  const hiddenCount = items.length - limit;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {visibleItems.map((item) => (
        <div key={getKey(item)}>{renderItem(item)}</div>
      ))}
      {canToggle ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((prev) => !prev)}
          className="-ml-1 inline-flex items-center gap-1.5 self-start rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
        >
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3.5 transition-transform",
              isExpanded && "rotate-180",
            )}
            aria-hidden
          />
          <span>{isExpanded ? "Show less" : `Show ${hiddenCount} more`}</span>
        </button>
      ) : null}
    </div>
  );
}
