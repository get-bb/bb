import { findLocalPathProjectSourceForHost } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { usePathPickerHost } from "@/hooks/useLocalPathPicker";
import {
  getProjectArchivedRoutePath,
  getProjectSettingsRoutePath,
} from "@/lib/app-route-paths";
import { cn } from "@/lib/utils";
import { useProjectActions } from "./ProjectActionsProvider";

interface ProjectActionsMenuBaseProps {
  project: ProjectResponse;
}

interface ProjectActionsMenuProps extends ProjectActionsMenuBaseProps {
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  onOpenChange?: (open: boolean) => void;
}

interface ProjectActionsContextMenuProps extends ProjectActionsMenuBaseProps {
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

type ProjectActionsMenuSurface = "context" | "dropdown";

interface ProjectActionsMenuItemsProps extends ProjectActionsMenuBaseProps {
  surface: ProjectActionsMenuSurface;
}

interface ProjectActionMenuItemProps {
  children: ReactNode;
  className?: string;
  onSelect?: (event: Event) => void;
  surface: ProjectActionsMenuSurface;
}

interface ProjectActionMenuSeparatorProps {
  surface: ProjectActionsMenuSurface;
}

function ProjectActionMenuItem({
  children,
  className,
  onSelect,
  surface,
}: ProjectActionMenuItemProps) {
  if (surface === "context") {
    return (
      <ContextMenuItem className={className} onSelect={onSelect}>
        {children}
      </ContextMenuItem>
    );
  }

  return (
    <DropdownMenuItem className={className} onSelect={onSelect}>
      {children}
    </DropdownMenuItem>
  );
}

function ProjectActionMenuSeparator({
  surface,
}: ProjectActionMenuSeparatorProps) {
  return surface === "context" ? (
    <ContextMenuSeparator />
  ) : (
    <DropdownMenuSeparator />
  );
}

function ProjectActionsMenuItems({
  project,
  surface,
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
      <ProjectActionMenuItem
        surface={surface}
        onSelect={() => {
          navigate(getProjectSettingsRoutePath(project.id));
        }}
      >
        Project settings
      </ProjectActionMenuItem>
      <ProjectActionMenuItem
        surface={surface}
        onSelect={() => {
          navigate(getProjectArchivedRoutePath(project.id));
        }}
      >
        Archived threads
      </ProjectActionMenuItem>
      <ProjectActionMenuSeparator surface={surface} />
      <ProjectActionMenuItem
        surface={surface}
        onSelect={(event) => {
          if (surface === "dropdown") {
            event.preventDefault();
          }
          requestRename(project);
        }}
      >
        Rename
      </ProjectActionMenuItem>
      {showAddLocalPath ? (
        <ProjectActionMenuItem
          surface={surface}
          onSelect={(event) => {
            if (surface === "dropdown") {
              event.preventDefault();
            }
            requestAddLocalPath(project);
          }}
        >
          Add local path
        </ProjectActionMenuItem>
      ) : null}
      <ProjectActionMenuItem
        surface={surface}
        className="text-destructive focus:text-destructive"
        onSelect={(event) => {
          if (surface === "dropdown") {
            event.preventDefault();
          }
          requestDelete(project);
        }}
      >
        Remove
      </ProjectActionMenuItem>
    </>
  );
}

export function ProjectActionsMenu({
  project,
  triggerClassName,
  align = "end",
  onOpenChange,
}: ProjectActionsMenuProps) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "rounded-md p-0 text-muted-foreground",
            triggerClassName,
          )}
          aria-label={`${project.name} actions`}
          title={`${project.name} actions`}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Icon name="MoreHorizontal" className={COARSE_POINTER_ICON_SIZE_CLASS} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44">
        <ProjectActionsMenuItems project={project} surface="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectActionsContextMenu({
  children,
  project,
  onOpenChange,
}: ProjectActionsContextMenuProps) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={`${project.name} actions`}
        className="w-44"
      >
        <ProjectActionsMenuItems project={project} surface="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}
