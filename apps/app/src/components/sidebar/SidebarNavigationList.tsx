import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import type {
  ExperimentalSidebarNavigationItem,
  ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@bb/shared-ui/sidebar-row-classes";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { AppCommandShortcutPill } from "@/components/commands/AppCommandShortcutHint";
import {
  useSidebarNavigation,
  useSidebarNavigationSplit,
} from "@/lib/plugin-sidebar-navigation";
import {
  hiddenNavigationBadgeLabels,
  NavigationBadgeMark,
  navigationBadgeAccessibleLabel,
  strongestNavigationBadgeTone,
} from "./navigationBadges";
import {
  SidebarNavigationItemContextMenu,
  SidebarNavigationMoreMenu,
} from "./SidebarNavigationMenus";
import { SidebarNavigationIcon } from "./SidebarNavigationModel";

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
    useSidebarNavigation();
  const split = useSidebarNavigationSplit(item.id);
  const shortcut = isShortcutModifierHeld ? item.shortcut : null;
  const label = navigationBadgeAccessibleLabel(item.label, item.badge);

  const row = (
    <div data-sidebar-navigation-item={item.id}>
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
          item.isLoading &&
            "text-sidebar-foreground/55 [&_[data-icon-root]]:opacity-60",
        )}
        {...split.splitProps}
        onClick={(event) =>
          actions.activate(item.id, {
            openInSplit: event.metaKey || event.ctrlKey,
          })
        }
      >
        <SidebarNavigationIcon icon={item.icon} />
        <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
        {shortcut ? (
          <AppCommandShortcutPill shortcut={shortcut} />
        ) : item.badge ? (
          <NavigationBadgeMark badge={item.badge} size="list" />
        ) : null}
      </ListRowButton>
    </div>
  );
  if (item.action.kind === "new-thread") return row;
  return (
    <SidebarNavigationItemContextMenu
      item={item}
      surface="sidebar"
      canOpenInSplit={split.isAvailable && !isCompactViewport}
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

export function SidebarNavigationList({
  isCompactViewport,
}: ExperimentalSidebarNavigationProps) {
  const { items } = useSidebarNavigation();
  const newThread = items.find((item) => item.action.kind === "new-thread");
  const destinations = items.filter(
    (item) => item.action.kind !== "new-thread",
  );
  const visible = destinations.filter((item) => item.isVisible);
  const hidden = destinations.filter((item) => !item.isVisible);
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
        {newThread ? (
          <div className="relative z-10">
            <NavigationListRow
              item={newThread}
              isCompactViewport={isCompactViewport}
            />
            {destinationsOverflow.above ? (
              <OverflowFade placement="below" tone="sidebar" />
            ) : null}
          </div>
        ) : null}
        {visible.length > 0 ? (
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
        ) : null}
        <div className="relative z-10">
          {destinationsOverflow.below ? (
            <OverflowFade placement="above" tone="sidebar" />
          ) : null}
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
        </div>
      </div>
      <div
        aria-hidden="true"
        className="mx-2 mb-2 shrink-0 border-t border-sidebar-border/25"
      />
    </>
  );
}
