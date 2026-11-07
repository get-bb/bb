import {
  createContext,
  useContext,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "../../lib/utils";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
} from "./coarse-pointer-sizing";
import { Icon, type IconName } from "./icon";
import { Input } from "./input";
import { LIST_HOVER_TRANSITION } from "./motion";

const BRANCH_PICKER_ROW_CLASS_NAME =
  "flex w-full min-w-0 scroll-mt-7 items-center gap-2 rounded-sm px-2 py-[0.3125rem] text-left text-xs outline-none data-[highlighted]:bg-state-hover data-[highlighted]:text-foreground focus-visible:bg-state-hover focus-visible:text-foreground";
const BRANCH_PICKER_ROW_SELECTOR =
  "button[data-branch-picker-row]:not(:disabled)";
const BRANCH_PICKER_HEADER_BASE_CLASS_NAME =
  "text-xs font-medium text-muted-foreground";
const BRANCH_PICKER_HEADER_STICKY_CLASS_NAME =
  "sticky top-0 z-20 -mx-1 bg-background px-3";
export const BRANCH_PICKER_CONTENT_CLASS_NAME =
  "flex w-full min-w-0 flex-col overflow-hidden p-0 md:w-max md:max-w-[min(18rem,calc(100vw-2rem))] md:max-h-[calc(100vh-6rem)]";

interface BranchPickerHighlightContextValue {
  highlighted: string;
  setHighlighted: (value: string) => void;
}

const BranchPickerHighlightContext =
  createContext<BranchPickerHighlightContextValue>({
    highlighted: "",
    setHighlighted: () => {},
  });

interface BranchPickerNavigationProps {
  highlight: string | undefined;
  query: string;
  children: ReactNode;
}

interface BranchPickerSectionHeaderProps {
  label: string;
  subtitle?: string;
  sticky?: boolean;
}

interface BranchPickerRowProps {
  value: string;
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
  onQueryChange: (query: string) => void;
  ariaLabel?: string;
  placeholder?: string;
}

function nextRowIndex(
  key: string,
  currentIndex: number,
  rowCount: number,
): number | null {
  switch (key) {
    case "ArrowDown":
      return currentIndex < 0 ? 0 : Math.min(currentIndex + 1, rowCount - 1);
    case "ArrowUp":
      return currentIndex < 0 ? rowCount - 1 : Math.max(currentIndex - 1, 0);
    case "Home":
      return 0;
    case "End":
      return rowCount - 1;
    default:
      return null;
  }
}

export function BranchPickerNavigation({
  highlight,
  query,
  children,
}: BranchPickerNavigationProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const resetKey = `${query}\u0000${highlight ?? ""}`;
  const [highlightState, setHighlightState] = useState({
    resetKey,
    value: highlight ?? "",
  });
  let highlighted = highlightState.value;
  if (highlightState.resetKey !== resetKey) {
    highlighted = highlight ?? "";
    setHighlightState({ resetKey, value: highlighted });
  }
  const setHighlighted = (value: string) =>
    setHighlightState({ resetKey, value });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const rows = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        BRANCH_PICKER_ROW_SELECTOR,
      ) ?? [],
    );
    const currentIndex = rows.findIndex(
      (row) => row.dataset.value === highlighted,
    );
    if (event.key === "Enter") {
      if (!(event.target instanceof HTMLInputElement)) return;
      event.preventDefault();
      event.stopPropagation();
      rows[currentIndex]?.click();
      return;
    }
    const nextIndex = nextRowIndex(event.key, currentIndex, rows.length);
    const nextRow = nextIndex === null ? undefined : rows[nextIndex];
    if (nextRow === undefined) return;
    event.preventDefault();
    setHighlighted(nextRow.dataset.value ?? "");
    if (event.target instanceof HTMLButtonElement) nextRow.focus();
    nextRow.scrollIntoView({ block: "nearest" });
  };

  return (
    <BranchPickerHighlightContext.Provider
      value={{ highlighted, setHighlighted }}
    >
      <div
        ref={rootRef}
        className="flex min-h-0 w-full flex-col max-md:flex-1"
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </BranchPickerHighlightContext.Provider>
  );
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
  value,
  disabled,
  icon,
  selected,
  title,
  onSelect,
  children,
}: BranchPickerRowProps) {
  const { highlighted, setHighlighted } = useContext(
    BranchPickerHighlightContext,
  );
  return (
    <button
      type="button"
      data-branch-picker-row=""
      data-value={value}
      data-highlighted={!disabled && highlighted === value ? "" : undefined}
      className={cn(
        BRANCH_PICKER_ROW_CLASS_NAME,
        LIST_HOVER_TRANSITION,
        disabled && "cursor-not-allowed text-muted-foreground opacity-60",
      )}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      onPointerMove={() => {
        if (!disabled && highlighted !== value) setHighlighted(value);
      }}
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
  onQueryChange,
  ariaLabel,
  placeholder = "Search branches",
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
          placeholder={placeholder}
          className="h-8 border-0 bg-transparent pl-8 pr-2 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}
