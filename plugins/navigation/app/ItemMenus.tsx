import { useState, type ReactNode } from "react";
import {
  experimental_SidebarNavigationIcon as SidebarNavigationIcon,
  experimental_useSidebarNavigation,
  type ExperimentalSidebarNavigationItem,
} from "@get-bb/plugin-sdk/app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { NavigationBadgeMark } from "./badges.js";

export type SidebarNavigationSurface = "rail" | "sidebar";

type MenuSurface = "context" | "dropdown";

function useDisablePlugin(itemId: string) {
  const { actions } = experimental_useSidebarNavigation();
  const [disablePending, setDisablePending] = useState(false);
  return {
    disablePending,
    disable: () => {
      setDisablePending(true);
      actions
        .disablePlugin(itemId)
        .catch(() => {})
        .finally(() => setDisablePending(false));
    },
  };
}

function SidebarNavigationItemMenuItems({
  item,
  surface,
  menu,
  canOpenInSplit,
}: {
  item: ExperimentalSidebarNavigationItem;
  surface: SidebarNavigationSurface;
  menu: MenuSurface;
  canOpenInSplit: boolean;
}) {
  const { actions } = experimental_useSidebarNavigation();
  const { disablePending, disable } = useDisablePlugin(item.id);
  const Item = menu === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator =
    menu === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  const isPluginItem = item.pluginId !== null;
  return (
    <>
      {isPluginItem ? (
        <>
          {canOpenInSplit ? (
            <Item
              onSelect={() => actions.activate(item.id, { openInSplit: true })}
            >
              <Icon name="Columns2" aria-hidden="true" />
              Open in split
            </Item>
          ) : null}
          <Item onSelect={() => actions.openDetails(item.id)}>
            <Icon name="Info" aria-hidden="true" />
            View details
          </Item>
          <Separator />
        </>
      ) : null}
      <Item onSelect={() => actions.setVisible(item.id, false)}>
        <Icon name="EyeOff" aria-hidden="true" />
        Hide from {surface}
      </Item>
      <Item onSelect={() => actions.openCustomize()}>
        <Icon name="SlidersHorizontal" aria-hidden="true" />
        Customize navigation
      </Item>
      {isPluginItem ? (
        <>
          <Separator />
          <Item disabled={disablePending} onSelect={disable}>
            <Icon name="Unavailable" aria-hidden="true" />
            Disable
          </Item>
        </>
      ) : null}
    </>
  );
}

export function sidebarNavigationItemMenuLabel(
  item: ExperimentalSidebarNavigationItem,
): string {
  return item.pluginId === null
    ? `${item.label} options`
    : `${item.label} panel options`;
}

export function SidebarNavigationItemContextMenu({
  item,
  surface,
  canOpenInSplit,
  onOpenChange,
  children,
}: {
  item: ExperimentalSidebarNavigationItem;
  surface: SidebarNavigationSurface;
  canOpenInSplit: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  children: ReactNode;
}) {
  return (
    <ContextMenu {...(onOpenChange ? { onOpenChange } : {})}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={sidebarNavigationItemMenuLabel(item)}>
        <SidebarNavigationItemMenuItems
          item={item}
          surface={surface}
          menu="context"
          canOpenInSplit={canOpenInSplit}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function SidebarNavigationItemDropdownMenu({
  item,
  surface,
  canOpenInSplit,
  onOpenChange,
  trigger,
}: {
  item: ExperimentalSidebarNavigationItem;
  surface: SidebarNavigationSurface;
  canOpenInSplit: boolean;
  onOpenChange: (isOpen: boolean) => void;
  trigger: ReactNode;
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={4}
        aria-label={sidebarNavigationItemMenuLabel(item)}
      >
        <SidebarNavigationItemMenuItems
          item={item}
          surface={surface}
          menu="dropdown"
          canOpenInSplit={canOpenInSplit}
        />
      </DropdownMenuContent>
    </DropdownMenu>
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
  const { actions } = experimental_useSidebarNavigation();
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
                  badge={item.badge}
                  size="list"
                  className="ml-auto"
                />
              </>
            ) : null}
          </DropdownMenuItem>
        ))}
        {hidden.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={() => actions.openCustomize()}>
          <Icon name="SlidersHorizontal" aria-hidden="true" />
          Customize navigation
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
