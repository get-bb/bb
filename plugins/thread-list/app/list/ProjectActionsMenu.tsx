import type { MouseEvent, ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ActionMenuItem, ActionMenuSeparator } from "../ui/action-menu-items.js";
import { CompactLongPressMenu } from "../ui/compact-long-press-menu.js";
import type { SidebarProject } from "../model/use-sidebar-data.js";

export type ProjectActionsMenuSurface = "context" | "dropdown";

interface ProjectActionsMenuBaseProps {
  project: SidebarProject;
  onRename: () => void;
  onRemove: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  extraActions?: (surface: ProjectActionsMenuSurface) => ReactNode;
}

interface ProjectActionsContextMenuProps extends ProjectActionsMenuBaseProps {
  disabled?: boolean;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

interface ProjectActionsMenuItemsProps extends ProjectActionsMenuBaseProps {
  surface: ProjectActionsMenuSurface;
}

function stopProjectActionsMenuClickPropagation(event: MouseEvent) {
  event.stopPropagation();
}

export function ProjectActionsMenuItems({
  project,
  surface,
  onRename,
  onRemove,
  extraActions,
}: ProjectActionsMenuItemsProps) {
  return (
    <>
      <ActionMenuItem surface={surface} icon="Settings" href={project.settingsHref}>
        Project settings
      </ActionMenuItem>
      <ActionMenuItem surface={surface} icon="Edit" onSelect={onRename}>
        Rename
      </ActionMenuItem>
      {extraActions?.(surface)}
      <ActionMenuSeparator surface={surface} />
      <ActionMenuItem
        surface={surface}
        icon="Trash2"
        variant="destructive"
        onSelect={onRemove}
      >
        Remove
      </ActionMenuItem>
    </>
  );
}

export function ProjectActionsContextMenu(
  props: ProjectActionsContextMenuProps,
) {
  const isCompactViewport = useIsCompactViewport();
  if (isCompactViewport) {
    return <ProjectActionsCompactLongPressMenu {...props} />;
  }
  return <ProjectActionsDesktopContextMenu {...props} />;
}

function ProjectActionsCompactLongPressMenu({
  children,
  disabled,
  project,
  onOpenChange,
  onRename,
  onRemove,
  extraActions,
}: ProjectActionsContextMenuProps) {
  return (
    <CompactLongPressMenu
      label={`${project.name} actions`}
      onOpenChange={onOpenChange}
      disabled={disabled}
      items={
        <ProjectActionsMenuItems
          project={project}
          surface="dropdown"
          onRename={onRename}
          onRemove={onRemove}
          extraActions={extraActions}
        />
      }
    >
      {children}
    </CompactLongPressMenu>
  );
}

function ProjectActionsDesktopContextMenu({
  children,
  disabled,
  project,
  onOpenChange,
  onRename,
  onRemove,
  onCloseAutoFocus,
  extraActions,
}: ProjectActionsContextMenuProps) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild disabled={disabled}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label={`${project.name} actions`}
        onCloseAutoFocus={onCloseAutoFocus}
        onClick={stopProjectActionsMenuClickPropagation}
      >
        <ProjectActionsMenuItems
          project={project}
          surface="context"
          onRename={onRename}
          onRemove={onRemove}
          extraActions={extraActions}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
