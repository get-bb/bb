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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { usePathPickerHost } from "@/hooks/useLocalPathPicker";
import { getSettingsProjectRoutePath } from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { useProjectActions } from "./ProjectActionsProvider";

interface ProjectActionsMenuBaseProps {
  project: ProjectResponse;
  onRename?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  extraActions?: (surface: ProjectActionsMenuSurface) => ReactNode;
}

interface ProjectActionsMenuProps extends ProjectActionsMenuBaseProps {
  triggerClassName?: string;
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
  extraActions,
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
      {extraActions?.(surface)}
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
  extraActions,
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
          extraActions={extraActions}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
