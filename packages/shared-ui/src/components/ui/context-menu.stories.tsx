import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/ContextMenu",
};

const TRIGGER_AREA_CLASS =
  "flex h-16 w-72 cursor-default select-none items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground";

function FileActionsDemo() {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={TRIGGER_AREA_CLASS}>Right-click this file row</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        <ContextMenuItem>Open preview</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Open with</ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-48">
            <ContextMenuItem>BB preview</ContextMenuItem>
            <ContextMenuItem>VS Code</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem>Copy file path</ContextMenuItem>
        <ContextMenuItem>Copy file name</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RowActionsDemo() {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={TRIGGER_AREA_CLASS}>Right-click this project row</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        <ContextMenuItem>
          <Icon name="Settings" aria-hidden />
          Project settings
        </ContextMenuItem>
        <ContextMenuItem>
          <Icon name="Edit" aria-hidden />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:bg-destructive/15 focus:text-destructive data-[last-hovered]:bg-destructive/15 data-[last-hovered]:text-destructive">
          <Icon name="Trash2" aria-hidden />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Nested submenu"
        hint="apps/app/src/components/plugin/ExperimentalFileLinkMenu.tsx + ExperimentalFileLink.tsx — ContextMenuTrigger wraps the target row; ContextMenuSub/SubTrigger/SubContent nests an 'Open with' picker. Right-click the dashed box to open"
      >
        <FileActionsDemo />
      </StoryRow>
      <StoryRow
        label="Destructive item"
        hint="apps/app/src/components/project/ProjectActionsMenu.tsx via apps/app/src/components/ui/action-menu-items.tsx — the repo's shared action-menu-item helper styles a trailing destructive action in red; the same helper renders these exact items as a DropdownMenu on touch surfaces (see shared-ui/DropdownMenu). Right-click the dashed box to open"
      >
        <RowActionsDemo />
      </StoryRow>
    </StoryCard>
  );
}
