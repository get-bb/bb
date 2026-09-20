import { Icon } from "@bb/shared-ui/icon";
import {
  ActionMenuItem,
  ActionMenuSeparator,
} from "@/components/ui/action-menu-items";
import { findLocalPathProjectSourceForHost } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import type { MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";

import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import { usePathPickerHost } from "@/hooks/useLocalPathPicker";
import { getSettingsProjectRoutePath } from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { useProjectActions } from "./ProjectActionsProvider";

interface ProjectActionsMenuBaseProps {
  project: ProjectResponse;
  onRename?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

interface ProjectActionsMenuProps extends ProjectActionsMenuBaseProps {
  triggerClassName?: string;
}

interface ProjectActionsContextMenuProps extends ProjectActionsMenuBaseProps {
  disabled?: boolean;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

type ProjectActionsMenuSurface = "context" | "dropdown";

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
}: ProjectActionsMenuItemsProps) {
  const navigate = useNavigate();
  const { hostId: pickerHostId } = usePathPickerHost();
  const { requestRename, requestDelete, requestAddLocalPath } =
    useProjectActions();
  const showAddLocalPath =
    pickerHostId != null &&
    !findLocalPathProjectSourceForHost(project.sources, pickerHostId);

  return (
    <>
      <ActionMenuItem
        surface={surface}
        icon="Settings"
        onSelect={() => {
          navigate(getSettingsProjectRoutePath(project.id));
        }}
      >
        Project settings
      </ActionMenuItem>
      <ActionMenuItem
        surface={surface}
        icon="Edit"
        onSelect={() => {
          if (onRename) onRename();
          else requestRename(project);
        }}
      >
        Rename
      </ActionMenuItem>
      {showAddLocalPath ? (
        <ActionMenuItem
          surface={surface}
          icon="FolderPlus"
          onSelect={() => {
            requestAddLocalPath(project);
          }}
        >
          Add local path
        </ActionMenuItem>
      ) : null}
      <ActionMenuSeparator surface={surface} />
      <ActionMenuItem
        surface={surface}
        icon="Trash2"
        variant="destructive"
        onSelect={() => {
          requestDelete(project);
        }}
      >
        Remove
      </ActionMenuItem>
    </>
  );
}

export function ProjectActionsMenu({
  project,
  triggerClassName,
  onRename,
  onCloseAutoFocus,
}: ProjectActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "rounded-md p-0 text-muted-foreground",
            triggerClassName,
            "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
          )}
          aria-label={`${project.name} actions`}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Icon
            name="MoreHorizontal"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={onCloseAutoFocus}
        onClick={stopProjectActionsMenuClickPropagation}
      >
        <ProjectActionsMenuItems
          project={project}
          surface="dropdown"
          onRename={onRename}
        />
      </DropdownMenuContent>
    </DropdownMenu>
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
  onCloseAutoFocus,
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
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
