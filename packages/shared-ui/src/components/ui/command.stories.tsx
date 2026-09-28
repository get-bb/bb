import { useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./command.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Command",
};

interface PickerProject {
  id: string;
  name: string;
}

const PROJECTS: PickerProject[] = [
  { id: "bb", name: "bb" },
  { id: "docs-site", name: "docs-site" },
  { id: "infra", name: "infra" },
];

function GroupedListDemo() {
  const [selectedId, setSelectedId] = useState<string | null>("bb");

  return (
    <Command className="w-72 rounded-md border" shouldFilter={false}>
      <CommandList>
        <CommandGroup heading="Project">
          {PROJECTS.map((project) => (
            <CommandItem
              key={project.id}
              value={project.id}
              onSelect={() => setSelectedId(project.id)}
              className="text-xs"
            >
              <Icon
                name="Folder"
                className="size-4 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <Icon
                name="Check"
                className={
                  project.id === selectedId
                    ? "ml-auto size-4 opacity-100"
                    : "ml-auto size-4 opacity-0"
                }
                aria-hidden
              />
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup>
          <CommandItem value="new-project" className="text-xs">
            <Icon
              name="FolderPlus"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            New project
          </CommandItem>
          <CommandItem
            value="no-project"
            onSelect={() => setSelectedId(null)}
            className="text-xs"
          >
            <Icon
              name="FolderMinus"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            Don&apos;t work in a project
            <Icon
              name="Check"
              className={
                selectedId === null
                  ? "ml-auto size-4 opacity-100"
                  : "ml-auto size-4 opacity-0"
              }
              aria-hidden
            />
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function EmptySearchDemo() {
  const [query, setQuery] = useState("zzz");
  const filtered = useMemo(
    () =>
      PROJECTS.filter((project) =>
        project.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  return (
    <Command
      className="w-72 rounded-md border"
      shouldFilter={false}
      label="Search projects"
    >
      <CommandInput
        aria-label="Search projects"
        placeholder="Search projects"
        value={query}
        onValueChange={setQuery}
        className="h-8 text-xs"
      />
      <CommandList>
        {filtered.length === 0 ? (
          <CommandEmpty className="px-2 py-2 text-xs text-muted-foreground">
            No projects match.
          </CommandEmpty>
        ) : (
          <CommandGroup heading="Project">
            {filtered.map((project) => (
              <CommandItem
                key={project.id}
                value={project.id}
                className="text-xs"
              >
                {project.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Grouped list with separator"
        hint="apps/app/src/components/pickers/ProjectSelector.tsx — a CommandGroup of real items, a CommandSeparator, then a second CommandGroup with a 'create new' action. Normally rendered inside a Popover; simplified here to a bordered standalone block since shared-ui/Popover's own story already covers that combination"
      >
        <GroupedListDemo />
      </StoryRow>
      <StoryRow
        label="Empty search state"
        hint="apps/app/src/components/pickers/ReuseEnvironmentPicker.tsx — CommandEmpty renders only when the CommandGroup below it has zero matching CommandItems. Starts pre-filled with a non-matching query so the empty state is visible without typing; edit the search box to see real matches"
      >
        <EmptySearchDemo />
      </StoryRow>
    </StoryCard>
  );
}
