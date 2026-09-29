import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/DropdownMenu",
};

const SECTIONS = ["Threads", "Backlog", "Done"];

function ActionsMenuDemo() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Thread actions"
        >
          <Icon name="MoreHorizontal" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>
          <Icon name="Copy" aria-hidden="true" />
          Copy thread link
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Icon name="Edit" aria-hidden="true" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name="SectionMove" aria-hidden="true" />
            Move to section
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {SECTIONS.map((section) => (
              <DropdownMenuItem key={section}>{section}</DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Icon name="Trash2" aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SORTS = ["Priority", "Recently updated", "Alphabetical"] as const;

function SortMenuDemo() {
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Priority");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Sort: {sort}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        mobileTitle="Sort tasks"
      >
        {SORTS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={sort === option}
            onCheckedChange={(checked) => {
              if (checked) setSort(option);
            }}
          >
            {option}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Actions menu"
        hint="plugins/thread-list/app/rows/ThreadActionsMenu.tsx — icon items, a submenu, and a destructive item"
      >
        <ActionsMenuDemo />
      </StoryRow>
      <StoryRow
        label="Sort menu"
        hint="plugins/tasks/views/list/filter-bar.tsx — checkbox items used as a single-select toggle group"
      >
        <SortMenuDemo />
      </StoryRow>
    </StoryCard>
  );
}
