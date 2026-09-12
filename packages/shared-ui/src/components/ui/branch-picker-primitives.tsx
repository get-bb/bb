import type { ReactNode, RefObject } from "react";
import { cn } from "../../lib/utils";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
} from "./coarse-pointer-sizing";
import { Icon, type IconName } from "./icon";
import { Input } from "./input";
import {
  MENU_ITEM_LAST_HOVERED_CLASS,
  useMenuItemHover,
} from "./menu-item-hover";
import { LIST_HOVER_TRANSITION } from "./motion";

const BRANCH_PICKER_ROW_CLASS_NAME =
  "flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-[0.3125rem] text-left text-xs outline-none hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:text-foreground";
const BRANCH_PICKER_HEADER_BASE_CLASS_NAME =
  "text-xs font-medium text-muted-foreground";
const BRANCH_PICKER_HEADER_STICKY_CLASS_NAME =
  "sticky top-0 z-20 -mx-1 bg-background px-3";
export const BRANCH_PICKER_CONTENT_CLASS_NAME =
  "flex w-full min-w-0 flex-col overflow-hidden p-0 md:w-max md:max-w-[min(18rem,calc(100vw-2rem))] md:max-h-[calc(100vh-6rem)]";

interface BranchPickerSectionHeaderProps {
  label: string;
  subtitle?: string;
  sticky?: boolean;
}

interface BranchPickerRowProps {
  disabled?: boolean;
  icon: IconName;
  selected: boolean;
  title: string;
  onSelect: () => void;
  children: ReactNode;
}

interface BranchPickerSearchProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  enterSelection: string | undefined;
  onEnterSelection: (branch: string) => void;
  onQueryChange: (query: string) => void;
  ariaLabel?: string;
}

export function BranchPickerSectionHeader({
  label,
  subtitle,
  sticky = true,
}: BranchPickerSectionHeaderProps) {
  const positionClassName = sticky
    ? BRANCH_PICKER_HEADER_STICKY_CLASS_NAME
    : "px-2";
  if (subtitle) {
    return (
      <div
        className={cn(
          BRANCH_PICKER_HEADER_BASE_CLASS_NAME,
          positionClassName,
          "py-[0.3125rem] pb-1.5",
        )}
        title={subtitle}
      >
        <div>{label}</div>
        <div className="mt-1 text-xs font-normal leading-snug text-muted-foreground">
          <span className="min-w-0">{subtitle}</span>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        BRANCH_PICKER_HEADER_BASE_CLASS_NAME,
        positionClassName,
        "flex h-7 items-center",
      )}
    >
      {label}
    </div>
  );
}

export function BranchPickerRow({
  disabled,
  icon,
  selected,
  title,
  onSelect,
  children,
}: BranchPickerRowProps) {
  const { hoverProps } = useMenuItemHover();
  return (
    <button
      type="button"
      className={cn(
        BRANCH_PICKER_ROW_CLASS_NAME,
        LIST_HOVER_TRANSITION,
        MENU_ITEM_LAST_HOVERED_CLASS,
        disabled &&
          "cursor-not-allowed text-muted-foreground opacity-60 hover:bg-transparent hover:text-muted-foreground",
      )}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      {...hoverProps}
    >
      <Icon
        name={icon}
        className={cn(
          "text-muted-foreground",
          COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
        )}
      />
      {children}
      <Icon
        name="Check"
        className={cn(
          selected ? "opacity-100" : "opacity-0",
          COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
        )}
      />
    </button>
  );
}

export function BranchPickerSearch({
  inputRef,
  query,
  enterSelection,
  onEnterSelection,
  onQueryChange,
  ariaLabel,
}: BranchPickerSearchProps) {
  return (
    <div className="shrink-0 border-b border-border p-1.5">
      <div className="relative">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          aria-label={ariaLabel}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.stopPropagation();
            if (enterSelection) onEnterSelection(enterSelection);
          }}
          placeholder="Search branches"
          className="h-8 border-0 bg-transparent pl-8 pr-2 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}
