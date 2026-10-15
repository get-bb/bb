import { forwardRef, type ComponentProps } from "react";
import type {
  ExperimentalSidebarNavigationItem,
  ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@bb/shared-ui/sidebar-row-classes";
import { AppCommandShortcutPill } from "@/components/commands/AppCommandShortcutHint";
import {
  useSidebarNavigation,
  useSidebarNavigationSplit,
} from "@/lib/plugin-sidebar-navigation";
import {
  hiddenNavigationBadgeLabels,
  NavigationBadgeMark,
  navigationBadgeAccessibleLabel,
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
          <NavigationBadgeMark count={item.badge.count} size="list" />
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

  return (
    <>
      <div
        data-testid="sidebar-navigation-list"
        className="relative shrink-0 space-y-0.5 px-2 py-2"
      >
        {newThread ? (
          <NavigationListRow
            item={newThread}
            isCompactViewport={isCompactViewport}
          />
        ) : null}
        {visible.map((item) => (
          <NavigationListRow
            key={item.id}
            item={item}
            isCompactViewport={isCompactViewport}
          />
        ))}
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
              {hiddenBadgeLabels.length > 0 ? (
                <NavigationBadgeMark count={undefined} className="mr-1.5" />
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
      <div
        aria-hidden="true"
        className="mx-2 mb-2 shrink-0 border-t border-sidebar-border/25"
      />
    </>
  );
}
