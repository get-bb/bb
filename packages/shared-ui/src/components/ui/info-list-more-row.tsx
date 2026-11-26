import { Icon } from "./icon";
import {
  INFO_LIST_LEADING_CLASS,
  InfoListIndentGuides,
  infoListIndentStyle,
} from "./info-list-row";
import { cn } from "../../lib/utils";

export const INFO_LIST_CARET_CLASS = "size-3 shrink-0 transition-transform";

export const INFO_LIST_DEFAULT_LIMIT = 5;

export function infoListCollapses(
  count: number,
  limit: number = INFO_LIST_DEFAULT_LIMIT,
): boolean {
  return count > limit + 1;
}

const INFO_LIST_QUIET_CONTROL_CLASS =
  "rounded text-2xs text-subtle-foreground transition-colors hover:text-foreground focus-visible:bg-state-hover focus-visible:text-foreground focus-visible:outline-none";

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
