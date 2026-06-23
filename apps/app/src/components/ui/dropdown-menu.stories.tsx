import { type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { Button } from "./button.js";
import { Icon } from "@/components/ui/icon.js";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "ui/Dropdown menu",
};

// Radix portals the menu and positions it against the trigger, so each story
// gets a tall stage with the trigger near the top and room below for the open
// menu. `defaultOpen` renders it open on mount; `modal={false}` keeps Ladle
// interactive (no focus trap / scroll lock).
function MenuStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[340px] justify-center pt-4">{children}</div>
  );
}

// The menu opened, exercising every item type so the chrome (rounded-md border +
// shadow-md popover) and the item states read at a glance.
export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="open menu"
        hint="rounded-md border + shadow-md popover; label / item / shortcut / checkbox / radio / destructive"
      >
        <MenuStage>
          <DropdownMenu defaultOpen modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Actions
                <Icon name="ChevronDown" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Thread</DropdownMenuLabel>
              <DropdownMenuItem>
                Rename
                <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem>Duplicate</DropdownMenuItem>
              <DropdownMenuItem disabled>Move to project</DropdownMenuItem>
              <DropdownMenuCheckboxItem checked>
                Show archived
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value="recent">
                <DropdownMenuRadioItem value="recent">
                  Most recent
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="alpha">
                  Alphabetical
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive">
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </MenuStage>
      </StoryRow>
    </StoryCard>
  );
}
