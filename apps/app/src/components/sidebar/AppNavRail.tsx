import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { AppCommandShortcutPill } from "@/components/commands/AppCommandShortcutHint";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import {
  CHROME_ROW_HEIGHT_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_AXIS_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldReserveMacosTrafficLights,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import {
  useSidebarNavigation,
  useSidebarNavigationSplit,
} from "@/lib/plugin-sidebar-navigation";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { NAV_RAIL_WIDTH_CLASS } from "./SidebarChrome";
import { SidebarNavigationIcon } from "./SidebarNavigationModel";
import { NEW_THREAD_NAVIGATION_ITEM_ID } from "./sidebarNavigationItems";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "./sidebarRowClasses";

const RAIL_ICON_CLASS = "size-(--bb-sidebar-control-icon-size)";

const RAIL_BUTTON_CLASS = cn(
  "size-(--bb-sidebar-control-size) shrink-0 rounded-md p-0 text-muted-foreground ring-sidebar-ring",
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

function RailItem({
  item,
  onCustomize,
}: {
  item: ExperimentalSidebarNavigationItem;
  onCustomize: () => void;
}) {
  const { activeItemId, actions } = useSidebarNavigation();
  const split = useSidebarNavigationSplit(item.id);
  const [disablePending, setDisablePending] = useState(false);
  const Accessory = item.experimental_Accessory;
  const isPluginItem = item.pluginId !== null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span className="relative flex" data-nav-rail-item={item.id}>
          <RailButton
            label={
              item.shortcut
                ? `${item.label} (${item.shortcut.label})`
                : item.label
            }
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
            <SidebarNavigationIcon
              icon={item.icon}
              className={RAIL_ICON_CLASS}
            />
          </RailButton>
          {Accessory ? (
            <span
              data-nav-rail-accessory=""
              className="pointer-events-none absolute -top-1 -right-2 max-h-4 max-w-8 overflow-hidden text-center text-xs leading-4 whitespace-nowrap"
            >
              <Accessory />
            </span>
          ) : null}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label={
          isPluginItem ? `${item.label} panel options` : `${item.label} options`
        }
      >
        {isPluginItem ? (
          <>
            {split.isAvailable ? (
              <ContextMenuItem
                onSelect={() =>
                  actions.activate(item.id, { openInSplit: true })
                }
              >
                <Icon name="Columns2" aria-hidden="true" />
                Open in split
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem onSelect={() => actions.openDetails(item.id)}>
              <Icon name="Info" aria-hidden="true" />
              View details
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuItem onSelect={() => actions.setVisible(item.id, false)}>
          <Icon name="EyeOff" aria-hidden="true" />
          Hide from sidebar
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCustomize}>
          <Icon name="SlidersHorizontal" aria-hidden="true" />
          Customize sidebar
        </ContextMenuItem>
        {isPluginItem ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={disablePending}
              onSelect={() => {
                setDisablePending(true);
                actions
                  .disablePlugin(item.id)
                  .catch(() => {})
                  .finally(() => setDisablePending(false));
              }}
            >
              <Icon name="Unavailable" aria-hidden="true" />
              Disable
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RailMoreMenu({
  hidden,
  onCustomize,
}: {
  hidden: readonly ExperimentalSidebarNavigationItem[];
  onCustomize: () => void;
}) {
  const { actions } = useSidebarNavigation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <RailButton label="More">
          <Icon name="MoreHorizontal" aria-hidden="true" />
        </RailButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start">
        {hidden.map((item) => (
          <DropdownMenuItem
            key={item.id}
            disabled={item.isDisabled || item.isLoading}
            onSelect={() => actions.activate(item.id, { openInSplit: false })}
          >
            <SidebarNavigationIcon icon={item.icon} />
            {item.label}
          </DropdownMenuItem>
        ))}
        {hidden.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={onCustomize}>
          <Icon name="SlidersHorizontal" aria-hidden="true" />
          Customize sidebar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppNavRail({
  isAppMode,
  isSettingsActive,
  settingsRoutePath,
}: {
  isAppMode: boolean;
  isSettingsActive: boolean;
  settingsRoutePath: string;
}) {
  const { items, activeItemId, actions } = useSidebarNavigation();
  const location = useLocation();
  const navigate = useNavigate();
  const settingsShortcut = useAppCommandShortcut("settings.open");
  const [desktopInfo] = useState(getBbDesktopInfo);
  const desktopWindowState = useDesktopWindowState();
  const reserveMacosTrafficLights = shouldReserveMacosTrafficLights({
    desktopInfo,
    windowState: desktopWindowState,
  });

  const isHomeActive =
    isAppMode &&
    (activeItemId === null || activeItemId === NEW_THREAD_NAVIGATION_ITEM_ID);
  const currentRoutePath = `${location.pathname}${location.search}${location.hash}`;
  const homeRoutePathRef = useRef(
    isHomeActive ? currentRoutePath : getRootComposeRoutePath(),
  );
  useEffect(() => {
    if (isHomeActive) homeRoutePathRef.current = currentRoutePath;
  }, [currentRoutePath, isHomeActive]);

  const destinations = items.filter(
    (item) => item.action.kind !== "new-thread",
  );
  const visible = destinations.filter((item) => item.isVisible);
  const hidden = destinations.filter((item) => !item.isVisible);

  const openCustomize = () => {
    if (!isAppMode) void navigate(homeRoutePathRef.current);
    actions.openCustomize();
  };

  return (
    <div
      data-testid="app-nav-rail"
      className={cn("flex shrink-0 flex-col", NAV_RAIL_WIDTH_CLASS)}
    >
      <div
        aria-hidden="true"
        className={cn(
          CHROME_ROW_HEIGHT_CLASS,
          "shrink-0",
          !reserveMacosTrafficLights && "bg-surface-recessed",
          shouldUseMacosDesktopChrome(desktopInfo) && MACOS_WINDOW_DRAG_CLASS,
        )}
      />
      <nav
        aria-label="Primary navigation"
        className="flex min-h-0 flex-1 flex-col items-center gap-2.5 bg-surface-recessed pb-2.5"
      >
        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2.5 overflow-y-auto py-0.5 [scrollbar-width:none]">
          <RailButton
            label="Home"
            active={isHomeActive}
            onClick={() => {
              if (!isHomeActive) void navigate(homeRoutePathRef.current);
            }}
          >
            <Icon name="Home" aria-hidden="true" />
          </RailButton>
          {visible.map((item) => (
            <RailItem key={item.id} item={item} onCustomize={openCustomize} />
          ))}
          <RailMoreMenu hidden={hidden} onCustomize={openCustomize} />
        </div>
        <RailButton
          label={
            settingsShortcut
              ? `Settings (${settingsShortcut.label})`
              : "Settings"
          }
          active={isSettingsActive}
          aria-keyshortcuts={settingsShortcut?.ariaKeyshortcuts}
          onClick={() => {
            if (!isSettingsActive) void navigate(settingsRoutePath);
          }}
        >
          <Icon name="Settings" aria-hidden="true" />
        </RailButton>
      </nav>
    </div>
  );
}

export function NavRailNewThreadButton() {
  const { items, actions, isShortcutModifierHeld } = useSidebarNavigation();
  const split = useSidebarNavigationSplit(NEW_THREAD_NAVIGATION_ITEM_ID);
  const [desktopInfo] = useState(getBbDesktopInfo);
  const item = items.find(
    (candidate) => candidate.action.kind === "new-thread",
  );
  if (item === undefined || !item.isVisible) return null;
  const shortcut = isShortcutModifierHeld ? item.shortcut : null;

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(
        PROJECT_LIST_ACTION_BUTTON_CLASS,
        "w-auto flex-1",
        shouldUseMacosDesktopChrome(desktopInfo) &&
          MACOS_CHROME_CONTROL_AXIS_CLASS,
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
