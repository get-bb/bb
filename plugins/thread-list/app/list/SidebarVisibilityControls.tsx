import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "../rows/sidebarRowClasses.js";

const OVERFLOW_ROW_BUTTON_CLASS =
  "w-full justify-start gap-2 rounded-sm px-2 text-xs font-normal hover:bg-state-hover focus-visible:bg-state-hover";

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
  testIdPrefix = "sidebar-navigation",
}: {
  activity?: ReactNode;
  ariaLabel: string;
  children: (close: () => void) => ReactNode;
  customizeLabel: string;
  listLabel: string;
  onCustomize: () => void;
  testIdPrefix?: string;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const close = useCallback(() => setIsMenuOpen(false), []);

  return (
    <div data-testid={`${testIdPrefix}-more-row`}>
      <DropdownMenu
        modal={false}
        open={isMenuOpen}
        onOpenChange={setIsMenuOpen}
      >
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
                    "w-full text-muted-foreground hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-[state=open]:text-sidebar-foreground",
                    isMenuOpen && "bg-sidebar-accent",
                  )}
                  data-testid={`${testIdPrefix}-more-trigger`}
                >
                  <Icon name="MoreHorizontal" aria-hidden="true" />
                  <span className="min-w-0 truncate text-left">More</span>
                  {activity ? (
                    <span className="ml-auto flex shrink-0">{activity}</span>
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
          mobileTitle="More"
          aria-label={ariaLabel}
          className="flex max-h-[min(var(--radix-dropdown-menu-content-available-height),calc(100dvh-0.5rem))] w-56 flex-col overflow-hidden p-1 max-md:min-h-0 max-md:flex-1"
        >
          <div
            role="group"
            aria-label={listLabel}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {children(close)}
          </div>
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SidebarOverflowItem({
  activity,
  children,
  item,
  onAddToSidebar,
  onClose,
}: {
  activity?: ReactNode;
  children: ReactNode;
  item: SidebarVisibilityItem;
  onAddToSidebar: (id: string) => void;
  onClose: () => void;
}) {
  const compact = useIsCompactViewport();
  const content = (
    <div data-sidebar-overflow="true" className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          OVERFLOW_ROW_BUTTON_CLASS,
          COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
          "mt-1 shrink-0 border-t",
        )}
        onClick={() => {
          onClose();
          onAddToSidebar(item.id);
        }}
      >
        <SidebarVisibilityActionContent visible={false} label="Add to list" />
      </Button>
    </div>
  );
  const label = (
    <>
      {item.icon}
      <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
      {activity}
    </>
  );

  if (compact) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              OVERFLOW_ROW_BUTTON_CLASS,
              COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
            )}
            disabled={item.disabled}
            data-sidebar-overflow-item={item.id}
          >
            {label}
            <Icon name="ChevronRight" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          mobileTitle={item.title}
          aria-label={item.title}
          className="flex min-h-0 flex-col p-1 [&>div]:min-h-0 [&>div]:flex-1"
        >
          {content}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        disabled={item.disabled}
        data-sidebar-overflow-item={item.id}
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
          {content}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export { SidebarVisibilityCustomize } from "./SidebarVisibilityCustomize.js";
