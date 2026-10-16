import { forwardRef, type ComponentProps, type ReactNode } from "react";
import {
  experimental_SidebarNavigationIcon as SidebarNavigationIcon,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  type ExperimentalSidebarNavigationItem,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ShortcutPill } from "@/components/ui/shortcut-pill";
import {
  PROJECT_LIST_ACTION_BUTTON_CLASS,
  SIDEBAR_RAIL_BUTTON_CLASS,
} from "@/components/ui/sidebar-row-classes";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  hiddenNavigationBadgeLabels,
  NavigationBadgeMark,
  navigationBadgeAccessibleLabel,
  strongestNavigationBadgeTone,
} from "./badges.js";
import {
  SidebarNavigationItemContextMenu,
  SidebarNavigationMoreMenu,
} from "./ItemMenus.js";

export const NEW_THREAD_ITEM_ID = "__bb__/new-thread";

const RAIL_ICON_CLASS = "size-(--bb-sidebar-control-icon-size)";
const RAIL_MENU_SIDE_OFFSET = 12;

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
          className={cn(SIDEBAR_RAIL_BUTTON_CLASS, className)}
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
  const { activeItemId, actions } = experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
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
                  ? "top-0.5 right-0.5"
                  : "-top-1 -right-1",
              )}
            />
          ) : null}
        </RailButton>
      </span>
    </SidebarNavigationItemContextMenu>
  );
}

export function Rail() {
  const { items, isHomeActive, actions } = experimental_useSidebarNavigation();

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
    <TooltipProvider>
      <div
        data-testid="app-nav-rail"
        className="flex min-h-0 flex-1 flex-col items-center pb-2"
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
                    className="pointer-events-none absolute top-0.5 right-0.5"
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
    </TooltipProvider>
  );
}

export function RailNewThreadButton() {
  const { items, actions, isShortcutModifierHeld } =
    experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(NEW_THREAD_ITEM_ID);
  const item = items.find((candidate) => candidate.id === NEW_THREAD_ITEM_ID);
  if (item === undefined) return null;
  const shortcut = isShortcutModifierHeld ? item.shortcut : null;

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(PROJECT_LIST_ACTION_BUTTON_CLASS, "w-auto flex-1")}
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
      {shortcut ? <ShortcutPill shortcut={shortcut} /> : null}
    </Button>
  );
}
