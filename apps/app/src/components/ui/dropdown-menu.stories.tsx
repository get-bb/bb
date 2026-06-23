import { type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { Button } from "./button.js";
import { Icon } from "@/components/ui/icon.js";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "ui/Dropdown menu",
};

// Each story mirrors a real sidebar menu. Radix portals the content and anchors
// it to the trigger, so the stage leaves room below. `defaultOpen` renders it
// open; `modal={false}` keeps Ladle interactive.
function MenuStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[300px] justify-center pt-4">{children}</div>
  );
}

// Single-select option with a trailing check — mirrors the sidebar's
// SidebarOrganizeMenuOption (the check keeps its slot when unselected so the
// labels stay aligned).
function CheckOption({
  label,
  selected,
}: {
  label: string;
  selected: boolean;
}) {
  return (
    <DropdownMenuItem className="flex items-center justify-between gap-3">
      <span className="truncate text-xs">{label}</span>
      <Icon name="Check" className={selected ? "opacity-100" : "opacity-0"} />
    </DropdownMenuItem>
  );
}

// The sidebar display menu (the Layers button on the Projects / Threads section
// headers): global Group-by mode + chronological Sort, single-select with a
// trailing check on the active option.
export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="sidebar display"
        hint="Group by + Sort by — single-select options with a trailing check"
      >
        <MenuStage>
          <DropdownMenu defaultOpen modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Sidebar display options"
              >
                <Icon name="AlignLeft" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Group by</DropdownMenuLabel>
              <CheckOption label="Project" selected />
              <CheckOption label="None" selected={false} />
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <CheckOption label="Updated at" selected />
              <CheckOption label="Created at" selected={false} />
            </DropdownMenuContent>
          </DropdownMenu>
        </MenuStage>
      </StoryRow>
    </StoryCard>
  );
}

// The folder row's ··· menu in the cross-project Folders view.
export function FolderActions() {
  return (
    <StoryCard>
      <StoryRow
        label="folder actions"
        hint="row ··· menu — items with icons, a separator, and a destructive Remove"
      >
        <MenuStage>
          <DropdownMenu defaultOpen modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Folder actions">
                <Icon name="MoreHorizontal" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem>
                <Icon name="Archive" />
                View archive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Icon name="Edit" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive">
                <Icon name="Trash2" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </MenuStage>
      </StoryRow>
    </StoryCard>
  );
}

// The Threads section's ··· menu.
export function ThreadsActions() {
  return (
    <StoryCard>
      <StoryRow label="threads actions" hint="section ··· menu">
        <MenuStage>
          <DropdownMenu defaultOpen modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Threads actions">
                <Icon name="MoreHorizontal" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem>Archived threads</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </MenuStage>
      </StoryRow>
    </StoryCard>
  );
}
