import { useState, type ReactNode } from "react";
import type { ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk";
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
import { useSidebarNavigation } from "@/lib/plugin-sidebar-navigation";
import { NavigationBadgeMark } from "./navigationBadges";
import { SidebarNavigationIcon } from "./SidebarNavigationModel";

export type SidebarNavigationSurface = "rail" | "sidebar";

export function SidebarNavigationItemContextMenu({
  item,
  surface,
  canOpenInSplit,
  children,
}: {
  item: ExperimentalSidebarNavigationItem;
  surface: SidebarNavigationSurface;
  canOpenInSplit: boolean;
  children: ReactNode;
}) {
  const { actions } = useSidebarNavigation();
  const [disablePending, setDisablePending] = useState(false);
  const isPluginItem = item.pluginId !== null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={
          isPluginItem ? `${item.label} panel options` : `${item.label} options`
        }
      >
        {isPluginItem ? (
          <>
            {canOpenInSplit ? (
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
          Hide from {surface}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.openCustomize()}>
          <Icon name="SlidersHorizontal" aria-hidden="true" />
          Customize {surface}
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

export function SidebarNavigationMoreMenu({
  trigger,
  hidden,
  surface,
  side,
  sideOffset,
  testId,
}: {
  trigger: ReactNode;
  hidden: readonly ExperimentalSidebarNavigationItem[];
  surface: SidebarNavigationSurface;
  side: "right" | "bottom";
  sideOffset: number;
  testId: string;
}) {
  const { actions } = useSidebarNavigation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align="start"
        sideOffset={sideOffset}
        data-testid={testId}
      >
        {hidden.map((item) => (
          <DropdownMenuItem
            key={item.id}
            disabled={item.isDisabled || item.isLoading}
            onSelect={() => actions.activate(item.id, { openInSplit: false })}
          >
            <SidebarNavigationIcon icon={item.icon} />
            {item.label}
            {item.badge ? (
              <>
                <span className="sr-only">, {item.badge.label}</span>
                <NavigationBadgeMark
                  count={item.badge.count}
                  className="ml-auto"
                />
              </>
            ) : null}
          </DropdownMenuItem>
        ))}
        {hidden.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={() => actions.openCustomize()}>
          <Icon name="SlidersHorizontal" aria-hidden="true" />
          Customize {surface}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
