import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { SIDEBAR_DISCLOSURE_ACTION_CLASS } from "@/components/ui/chrome-style-tokens";
import { cn } from "@/lib/utils";
import {
  PROJECT_LIST_ACTION_BUTTON_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
} from "../rows/sidebarRowClasses.js";
import { CONTEXT_SELECTION_SURFACE_CLASS } from "../ui/context-selection.js";

const OVERFLOW_ROW_BUTTON_CLASS =
  "w-full justify-start gap-2 rounded-sm px-2 text-xs font-normal hover:bg-state-hover focus-visible:bg-state-hover";

interface CompactOverflowPage {
  id: string;
  title: string;
}

const CompactOverflowContext = createContext<{
  page: CompactOverflowPage | null;
  setPage: (page: CompactOverflowPage | null) => void;
} | null>(null);

export interface SidebarVisibilityItem {
  id: string;
  title: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SidebarActivationModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
}

export function SidebarCustomizeActionContent({ label }: { label: string }) {
  return (
    <>
      <Icon name="FilterHorizontal" aria-hidden="true" />
      {label}
    </>
  );
}

export function SidebarVisibilityActionContent({
  visible,
  label,
}: {
  visible: boolean;
  label?: string;
}) {
  return (
    <>
      <Icon name={visible ? "EyeOff" : "Eye"} aria-hidden="true" />
      {label ?? (visible ? "Hide from sidebar" : "Add to sidebar")}
    </>
  );
}

export function SidebarMore({
  activity,
  ariaLabel,
  children,
  customizeLabel,
  listLabel,
  onCustomize,
  selected = false,
  testIdPrefix = "sidebar-navigation",
}: {
  activity?: ReactNode;
  ariaLabel: string;
  children: (close: () => void) => ReactNode;
  customizeLabel: string;
  listLabel: string;
  onCustomize: () => void;
  selected?: boolean;
  testIdPrefix?: string;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [page, setPage] = useState<CompactOverflowPage | null>(null);
  const compact = useIsCompactViewport();
  const changeOpen = useCallback((open: boolean) => {
    setIsMenuOpen(open);
    if (open) setPage(null);
  }, []);
  const close = useCallback(() => changeOpen(false), [changeOpen]);

  return (
    <div data-testid={`${testIdPrefix}-more-row`}>
      <DropdownMenu modal={false} open={isMenuOpen} onOpenChange={changeOpen}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={ariaLabel}
                  className={cn(
                    PROJECT_LIST_ACTION_BUTTON_CLASS,
                    SIDEBAR_DISCLOSURE_ACTION_CLASS,
                    "w-full hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-[state=open]:text-sidebar-foreground",
                    selected && SIDEBAR_ROW_SELECTED_STATE_CLASS,
                    isMenuOpen && "bg-sidebar-accent",
                  )}
                  data-selected={selected ? "true" : undefined}
                  data-testid={`${testIdPrefix}-more-trigger`}
                >
                  <Icon name="MoreHorizontal" aria-hidden="true" />
                  <span className="min-w-0 truncate text-left">More</span>
                  {activity ? (
                    <span
                      className={cn(
                        "ml-auto inline-flex shrink-0 items-center justify-center",
                        COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
                      )}
                    >
                      {activity}
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent aria-label={`${ariaLabel} options`}>
            <ContextMenuItem onSelect={onCustomize}>
              <SidebarCustomizeActionContent label={customizeLabel} />
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={8}
          mobileTitle={compact && page ? page.title : "More"}
          aria-label={ariaLabel}
          className="flex max-h-[min(var(--radix-dropdown-menu-content-available-height),calc(100dvh-0.5rem))] w-56 flex-col overflow-hidden p-1 max-md:min-h-0 max-md:flex-1"
        >
          <div
            role="group"
            aria-label={listLabel}
            className={cn(
              "min-h-0 flex-1 overscroll-contain",
              compact && page
                ? "flex flex-col overflow-hidden"
                : "overflow-y-auto",
            )}
          >
            {compact && page ? (
              <>
                <DropdownMenuItem
                  className="shrink-0"
                  onSelect={(event) => {
                    event.preventDefault();
                    setPage(null);
                  }}
                >
                  <Icon name="ChevronLeft" aria-hidden="true" />
                  Back
                </DropdownMenuItem>
                <div
                  role="separator"
                  className="my-1 h-px shrink-0 bg-border"
                />
              </>
            ) : null}
            <CompactOverflowContext.Provider value={{ page, setPage }}>
              {children(close)}
            </CompactOverflowContext.Provider>
          </div>
          {compact && page ? null : (
            <>
              <div
                role="separator"
                className="-mx-1 my-1 h-px shrink-0 bg-border"
              />
              <DropdownMenuItem
                className={cn(
                  OVERFLOW_ROW_BUTTON_CLASS,
                  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
                  "shrink-0",
                )}
                data-testid={`${testIdPrefix}-customize-trigger`}
                onSelect={() => {
                  close();
                  onCustomize();
                }}
              >
                <SidebarCustomizeActionContent label={customizeLabel} />
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SidebarOverflowItem({
  activity,
  children,
  empty = false,
  item,
  onAddToSidebar,
  onClose,
  onNewThread,
  selected = false,
}: {
  activity?: ReactNode;
  children: (close: () => void) => ReactNode;
  empty?: boolean;
  item: SidebarVisibilityItem;
  onAddToSidebar: (id: string) => void;
  onClose: () => void;
  onNewThread?: () => void;
  selected?: boolean;
}) {
  const compact = useIsCompactViewport();
  const compactOverflow = useContext(CompactOverflowContext);
  const content = (close: () => void) => (
    <div data-sidebar-overflow="true" className="flex min-h-0 flex-col">
      {empty ? (
        onNewThread ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              OVERFLOW_ROW_BUTTON_CLASS,
              COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
              "shrink-0",
            )}
            onClick={() => {
              close();
              onNewThread();
            }}
          >
            <Icon name="MessageSquarePlus" aria-hidden="true" />
            New thread
          </Button>
        ) : null
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children(close)}
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          OVERFLOW_ROW_BUTTON_CLASS,
          COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
          "shrink-0",
          !empty && "mt-1",
        )}
        onClick={() => {
          close();
          onAddToSidebar(item.id);
        }}
      >
        <SidebarVisibilityActionContent visible={false} label="Add to list" />
      </Button>
    </div>
  );
  const label = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
        {item.icon}
        <span className="min-w-0 truncate">{item.title}</span>
      </span>
      {activity ? (
        <span className="ml-auto flex shrink-0">{activity}</span>
      ) : null}
      {compact ? (
        <Icon name="ChevronRight" className="ml-auto" aria-hidden="true" />
      ) : null}
    </>
  );

  if (compact) {
    if (
      !compactOverflow ||
      (compactOverflow.page && compactOverflow.page.id !== item.id)
    ) {
      return null;
    }
    if (compactOverflow.page) {
      return content(onClose);
    }
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          OVERFLOW_ROW_BUTTON_CLASS,
          COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
          selected && CONTEXT_SELECTION_SURFACE_CLASS,
        )}
        disabled={item.disabled}
        data-sidebar-overflow-item={item.id}
        data-selected={selected ? "true" : undefined}
        onClick={() =>
          compactOverflow.setPage({ id: item.id, title: item.title })
        }
      >
        {label}
      </Button>
    );
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        className={cn(
          "[&>[data-icon-root]:last-child]:hidden",
          selected && CONTEXT_SELECTION_SURFACE_CLASS,
        )}
        disabled={item.disabled}
        data-sidebar-overflow-item={item.id}
        data-selected={selected ? "true" : undefined}
        textValue={item.title}
      >
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          aria-label={item.title}
          onKeyDownCapture={(event) => {
            if (event.key === "Tab") event.stopPropagation();
          }}
          className="flex max-h-[min(var(--radix-dropdown-menu-content-available-height),calc(100dvh-1rem))] w-72 flex-col [&>div]:min-h-0 [&>div]:flex-1"
        >
          {content(onClose)}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export { SidebarVisibilityCustomize } from "./SidebarVisibilityCustomize.js";
