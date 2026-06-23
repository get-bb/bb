import { type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu.js";
import { Icon } from "@/components/ui/icon.js";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "ui/Context menu",
};

// Context menus open at the pointer on right-click (Radix has no declarative
// "open"), so this story is interactive: right-click the row to open it. It
// renders the real project-row actions — the same items as the project's ···
// dropdown — so the right-click surface + shadow-md chrome match the app. Thread
// rows expose the equivalent menu via ThreadActionsMenu.
function ProjectRowTarget({ children }: { children: ReactNode }) {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <div className="flex h-7 w-full max-w-[260px] items-center gap-1.5 rounded-md border border-border bg-surface-recessed px-2 text-sm">
          <Icon
            name="FolderOpen"
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate">bb</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            right-click ⌥
          </span>
        </div>
      </ContextMenuTrigger>
      {children}
    </ContextMenu>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="project row (right-click)"
        hint="the real project actions — same items as the project's ··· dropdown"
      >
        <ProjectRowTarget>
          <ContextMenuContent className="w-48">
            <ContextMenuItem>Project settings</ContextMenuItem>
            <ContextMenuItem>Archived threads</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem>Rename</ContextMenuItem>
            <ContextMenuItem>Add local path</ContextMenuItem>
            <ContextMenuItem className="text-destructive focus:text-destructive">
              Remove
            </ContextMenuItem>
          </ContextMenuContent>
        </ProjectRowTarget>
      </StoryRow>
    </StoryCard>
  );
}
