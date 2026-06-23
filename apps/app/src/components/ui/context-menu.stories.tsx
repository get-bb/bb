import { type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "./context-menu.js";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "ui/Context menu",
};

// Radix context menus open at the pointer on right-click — there is no
// declarative "open" prop — so this story is interactive: right-click the
// target to open the menu. It shares the dropdown menu's chrome (rounded-md
// border + shadow-md popover). `modal={false}` keeps Ladle interactive.
function Target({ children }: { children: ReactNode }) {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <div className="flex min-h-[160px] w-full max-w-[420px] items-center justify-center rounded-lg border border-dashed border-border bg-surface-recessed text-sm text-muted-foreground">
          Right-click anywhere in this area
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
        label="right-click target"
        hint="rounded-md border + shadow-md popover; label / item / shortcut / checkbox / destructive"
      >
        <Target>
          <ContextMenuContent className="w-52">
            <ContextMenuLabel>Thread</ContextMenuLabel>
            <ContextMenuItem>
              Open
              <ContextMenuShortcut>⏎</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>Rename</ContextMenuItem>
            <ContextMenuCheckboxItem checked>Pinned</ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive">
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </Target>
      </StoryRow>
    </StoryCard>
  );
}
