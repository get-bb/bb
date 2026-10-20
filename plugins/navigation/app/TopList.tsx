import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  experimental_SidebarNavigationIcon as SidebarNavigationIcon,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { ShortcutPill } from "@/components/ui/shortcut-pill";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import {
  PROJECT_LIST_ACTION_BUTTON_CLASS,
  SIDEBAR_CONTROL_STATE_CLASS,
} from "@/components/ui/sidebar-row-classes";
import { SplitPaneMiniMap } from "@/components/ui/split-pane-mini-map";
import { cn } from "@/lib/utils";
import {
  hiddenNavigationBadgeLabels,
  NavigationBadgeMark,
  navigationBadgeAccessibleLabel,
  strongestNavigationBadgeTone,
} from "./badges.js";
import {
  SidebarNavigationItemContextMenu,
  SidebarNavigationItemDropdownMenu,
  sidebarNavigationItemMenuLabel,
  SidebarNavigationMoreMenu,
} from "./ItemMenus.js";
import { clickTarget } from "./target.js";

const MORE_MENU_SIDE_OFFSET = 4;

const ListRowButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof Button> & { active?: boolean }
>(({ active = false, className, ...props }, ref) => (
  <Button
    ref={ref}
    type="button"
    size="sm"
    variant="ghost"
    aria-current={active ? "page" : undefined}
    className={cn(
      PROJECT_LIST_ACTION_BUTTON_CLASS,
      "w-full",
      "data-[state=open]:bg-sidebar-accent",
      active && "bg-sidebar-accent text-sidebar-foreground",
      className,
    )}
    {...props}
  />
));
ListRowButton.displayName = "ListRowButton";

function NavigationListRow({
  item,
  isCompactViewport,
}: {
  item: ExperimentalSidebarNavigationItem;
  isCompactViewport: boolean;
}) {
  const { activeItemId, actions, isShortcutModifierHeld } =
    experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  const [isDropdownOpen, setDropdownOpen] = useState(false);
  const [isContextMenuOpen, setContextMenuOpen] = useState(false);
  const shortcut = isShortcutModifierHeld ? item.shortcut : null;
  const label = navigationBadgeAccessibleLabel(item.label, item.badge);
  const showsOptions = shortcut === null;
  const isActionsOpen = isDropdownOpen || isContextMenuOpen;
  const canOpenInSplit = split.isAvailable && !isCompactViewport;

  const row = (
    <div
      data-sidebar-navigation-item={item.id}
      className={cn("relative", SIDEBAR_HOVER_ACTIONS_ROW_CLASS)}
    >
      <ListRowButton
        active={item.id === activeItemId && item.action.kind !== "new-thread"}
        disabled={item.isDisabled}
        aria-busy={item.isLoading || undefined}
        aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
        aria-label={
          item.shortcut
            ? `${label} (${item.shortcut.label})`
            : item.badge
              ? label
              : undefined
        }
        className={cn(
          showsOptions &&
            (item.badge ? "pr-18 [@media(hover:none)]:pr-25" : "pr-7"),
          isContextMenuOpen && "bg-sidebar-accent text-sidebar-foreground",
          item.isLoading &&
            "text-sidebar-foreground/55 [&_[data-icon-root]]:opacity-60",
        )}
        {...split.splitProps}
        onClick={(event) =>
          actions.activate(item.id, {
            target: clickTarget(event),
          })
        }
      >
        <SidebarNavigationIcon icon={item.icon} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {split.layout ? (
            <SplitPaneMiniMap
              slots={split.layout.panes}
              label={`${item.label}, open in split`}
            />
          ) : null}
        </span>
        {shortcut ? (
          <ShortcutPill shortcut={shortcut} />
        ) : item.badge && !showsOptions ? (
          <NavigationBadgeMark badge={item.badge} size="list" />
        ) : null}
      </ListRowButton>
      {showsOptions && item.badge ? (
        <span
          data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
          className={cn(
            SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
            "pointer-events-none absolute top-1/2 right-1.5 flex -translate-y-1/2 [@media(hover:none)]:right-9",
          )}
        >
          <NavigationBadgeMark badge={item.badge} size="list" />
        </span>
      ) : null}
      {showsOptions ? (
        <div
          data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
          data-sidebar-hover-actions-mobile={
            SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
          }
          className={cn(
            SIDEBAR_HOVER_ACTIONS_CLASS,
            "absolute inset-y-0 right-0 flex items-center",
          )}
        >
          <SidebarNavigationItemDropdownMenu
            item={item}
            surface="sidebar"
            canOpenInSplit={canOpenInSplit}
            onOpenChange={setDropdownOpen}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={sidebarNavigationItemMenuLabel(item)}
                className={cn(
                  "m-1 size-5 rounded-md p-0 max-md:pointer-coarse:m-0 max-md:pointer-coarse:size-9",
                  SIDEBAR_CONTROL_STATE_CLASS,
                  isContextMenuOpen && "bg-state-active",
                )}
              >
                <Icon
                  name="MoreHorizontal"
                  className={COARSE_POINTER_ICON_SIZE_CLASS}
                />
              </Button>
            }
          />
        </div>
      ) : null}
    </div>
  );
  return (
    <SidebarNavigationItemContextMenu
      item={item}
      surface="sidebar"
      canOpenInSplit={canOpenInSplit}
      onOpenChange={setContextMenuOpen}
    >
      {row}
    </SidebarNavigationItemContextMenu>
  );
}

function useScrollOverflow(itemCount: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ above: false, below: false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const update = () => {
      const above = element.scrollTop > 1;
      const below =
        element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      setOverflow((current) =>
        current.above === above && current.below === below
          ? current
          : { above, below },
      );
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => element.removeEventListener("scroll", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [itemCount]);
  return [ref, overflow] as const;
}

export function TopList({
  isCompactViewport,
}: ExperimentalSidebarNavigationProps) {
  const { items } = experimental_useSidebarNavigation();
  const visible = items.filter((item) => item.isVisible);
  const hidden = items.filter((item) => !item.isVisible);
  const hiddenBadgeLabels = hiddenNavigationBadgeLabels(hidden);
  const hiddenBadgeTone = strongestNavigationBadgeTone(
    hidden.map((item) => item.badge),
  );
  const [destinationsRef, destinationsOverflow] = useScrollOverflow(
    visible.length,
  );

  return (
    <>
      <div
        data-testid="sidebar-navigation-list"
        className="relative shrink-0 space-y-0.5 px-2 py-2"
      >
        {visible.length > 0 ? (
          <div className="relative">
            <div
              ref={destinationsRef}
              data-testid="sidebar-navigation-destinations"
              className="max-h-[max(4rem,calc(70svh_-_4.5rem))] space-y-0.5 overflow-y-auto [scrollbar-width:thin]"
            >
              {visible.map((item) => (
                <NavigationListRow
                  key={item.id}
                  item={item}
                  isCompactViewport={isCompactViewport}
                />
              ))}
            </div>
            {destinationsOverflow.above ? (
              <OverflowFade placement="above" inset tone="sidebar" />
            ) : null}
            {destinationsOverflow.below ? (
              <OverflowFade placement="below" inset tone="sidebar" />
            ) : null}
          </div>
        ) : null}
        {hidden.length > 0 ? (
          <SidebarNavigationMoreMenu
            trigger={
              <ListRowButton
                aria-label={
                  hiddenBadgeLabels.length > 0
                    ? `More, ${hiddenBadgeLabels.join(", ")}`
                    : undefined
                }
              >
                <Icon name="MoreHorizontal" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-left">More</span>
                {hiddenBadgeTone !== null ? (
                  <NavigationBadgeMark
                    badge={{ tone: hiddenBadgeTone }}
                    className="mr-1.5"
                  />
                ) : null}
              </ListRowButton>
            }
            hidden={hidden}
            surface="sidebar"
            side="right"
            sideOffset={MORE_MENU_SIDE_OFFSET}
            testId="sidebar-navigation-more-menu"
          />
        ) : null}
      </div>
      <div
        aria-hidden="true"
        className="mx-2 mb-2 shrink-0 border-t border-sidebar-border/25"
      />
    </>
  );
}
