import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ExperimentalSidebarNavigationItem,
  ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@bb/shared-ui/sidebar-row-classes";
import { useIsSidebarFramed } from "@/components/ui/sidebar.js";
import { AppCommandShortcutPill } from "@/components/commands/AppCommandShortcutHint";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
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
import { useSidebarHeaderControlAxisClass } from "./SidebarChrome";
import {
  SidebarNavigationItemContextMenu,
  SidebarNavigationMoreMenu,
} from "./SidebarNavigationMenus";
import { SidebarNavigationIcon } from "./SidebarNavigationModel";
import { NEW_THREAD_NAVIGATION_ITEM_ID } from "./sidebarNavigationItems";

const RAIL_ICON_CLASS = "size-(--bb-sidebar-control-icon-size)";
const RAIL_MENU_SIDE_OFFSET = 12;

const RAIL_BUTTON_CLASS = cn(
  "relative size-(--bb-sidebar-control-size) shrink-0 rounded-md p-0 text-muted-foreground ring-sidebar-ring",
  "hover:bg-state-hover hover:text-sidebar-foreground focus-visible:ring-2",
  "aria-[current=page]:bg-state-active aria-[current=page]:text-sidebar-foreground",
  "data-[state=open]:bg-state-active data-[state=open]:text-sidebar-foreground",
  "[&_[data-icon-root]]:size-(--bb-sidebar-control-icon-size)",
);

interface RailButtonProps extends Omit<
  ComponentProps<typeof Button>,
  "aria-label" | "aria-current"
> {
  label: string;
  active?: boolean;
  children: ReactNode;
}

const RailButton = forwardRef<HTMLButtonElement, RailButtonProps>(
  ({ label, active = false, className, children, ...props }, ref) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={cn(RAIL_BUTTON_CLASS, className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  ),
);
RailButton.displayName = "RailButton";

function RailItem({ item }: { item: ExperimentalSidebarNavigationItem }) {
  const { activeItemId, actions } = useSidebarNavigation();
  const split = useSidebarNavigationSplit(item.id);
  const label = navigationBadgeAccessibleLabel(item.label, item.badge);

  return (
    <SidebarNavigationItemContextMenu
      item={item}
      surface="rail"
      canOpenInSplit={split.isAvailable}
    >
      <span className="flex" data-nav-rail-item={item.id}>
        <RailButton
          label={item.shortcut ? `${label} (${item.shortcut.label})` : label}
          active={item.id === activeItemId}
          disabled={item.isDisabled}
          aria-busy={item.isLoading || undefined}
          aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
          className={cn(item.isLoading && "opacity-60")}
          {...split.splitProps}
          onClick={(event) =>
            actions.activate(item.id, {
              openInSplit: event.metaKey || event.ctrlKey,
            })
          }
        >
          <SidebarNavigationIcon icon={item.icon} className={RAIL_ICON_CLASS} />
          {item.badge ? (
            <NavigationBadgeMark
              badge={item.badge}
              className={cn(
                "pointer-events-none absolute",
                item.badge.count === undefined
                  ? "top-1 right-1"
                  : "-top-0.5 -right-0.5",
              )}
            />
          ) : null}
        </RailButton>
      </span>
    </SidebarNavigationItemContextMenu>
  );
}

export function AppNavRail(_props: ExperimentalSidebarNavigationProps) {
  const { items, isHomeActive, actions } = useSidebarNavigation();
  const isFramed = useIsSidebarFramed();

  const destinations = items.filter(
    (item) => item.action.kind !== "new-thread",
  );
  const visible = destinations.filter((item) => item.isVisible);
  const hidden = destinations.filter((item) => !item.isVisible);
  const hiddenBadgeLabels = hiddenNavigationBadgeLabels(hidden);
  const hiddenBadgeTone = strongestNavigationBadgeTone(
    hidden.map((item) => item.badge),
  );

  return (
    <div
      data-testid="app-nav-rail"
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center pb-2",
        isFramed ? "pt-2.5" : "pt-1",
      )}
    >
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto py-0.5 [scrollbar-width:none]">
        <RailButton
          label="Home"
          active={isHomeActive}
          onClick={() => actions.goHome()}
        >
          <Icon name="Home" aria-hidden="true" />
        </RailButton>
        {visible.map((item) => (
          <RailItem key={item.id} item={item} />
        ))}
        <SidebarNavigationMoreMenu
          trigger={
            <RailButton
              label={
                hiddenBadgeLabels.length > 0
                  ? `More, ${hiddenBadgeLabels.join(", ")}`
                  : "More"
              }
            >
              <Icon name="MoreHorizontal" aria-hidden="true" />
              {hiddenBadgeTone !== null ? (
                <NavigationBadgeMark
                  badge={{ tone: hiddenBadgeTone }}
                  className="pointer-events-none absolute top-1 right-1"
                />
              ) : null}
            </RailButton>
          }
          hidden={hidden}
          surface="rail"
          side="right"
          sideOffset={RAIL_MENU_SIDE_OFFSET}
          testId="nav-rail-more-menu"
        />
      </div>
    </div>
  );
}

export function NavRailSettingsButton({
  isSettingsActive,
  settingsRoutePath,
}: {
  isSettingsActive: boolean;
  settingsRoutePath: string;
}) {
  const navigate = useNavigate();
  const settingsShortcut = useAppCommandShortcut("settings.open");
  return (
    <RailButton
      label={
        settingsShortcut ? `Settings (${settingsShortcut.label})` : "Settings"
      }
      active={isSettingsActive}
      className="my-1 max-md:pointer-coarse:my-0"
      aria-keyshortcuts={settingsShortcut?.ariaKeyshortcuts}
      onClick={() => {
        if (!isSettingsActive) void navigate(settingsRoutePath);
      }}
    >
      <Icon name="Settings" aria-hidden="true" />
    </RailButton>
  );
}

export function NavRailNewThreadButton() {
  const { items, actions, isShortcutModifierHeld } = useSidebarNavigation();
  const split = useSidebarNavigationSplit(NEW_THREAD_NAVIGATION_ITEM_ID);
  const axisClass = useSidebarHeaderControlAxisClass();
  const item = items.find(
    (candidate) => candidate.action.kind === "new-thread",
  );
  if (item === undefined) return null;
  const shortcut = isShortcutModifierHeld ? item.shortcut : null;

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(
        PROJECT_LIST_ACTION_BUTTON_CLASS,
        "w-auto flex-1",
        axisClass,
      )}
      disabled={item.isDisabled}
      aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
      aria-label={
        item.shortcut ? `${item.label} (${item.shortcut.label})` : undefined
      }
      {...split.splitProps}
      onClick={(event) =>
        actions.activate(item.id, {
          openInSplit: event.metaKey || event.ctrlKey,
        })
      }
    >
      <SidebarNavigationIcon icon={item.icon} />
      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
      {shortcut ? <AppCommandShortcutPill shortcut={shortcut} /> : null}
    </Button>
  );
}
