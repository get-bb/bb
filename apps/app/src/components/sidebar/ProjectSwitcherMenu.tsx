import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@bb/shared-ui/command";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import type { ProjectSelectorOption } from "@/components/pickers/ProjectSelector";
import { searchPickerOptions } from "@/components/pickers/picker-search";
import { useResetPickerScroll } from "@/components/pickers/useResetPickerScroll";
import { stripProjectThreads } from "@/hooks/queries/project-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import {
  useRootComposeProjectId,
  useSetRootComposeProjectId,
} from "@/lib/root-compose-selection";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "./ProjectList";

const PROJECT_SWITCHER_SEARCH_MIN_OPTIONS = 5;
const PROJECT_SWITCHER_ITEM_CLASS_NAME = "py-[0.3125rem] text-xs max-md:py-2";

interface ProjectSwitcherMenuProps {
  onNavigate?: () => void;
  defaultOpen?: boolean;
  modal?: boolean;
}

export function ProjectSwitcherMenu({
  onNavigate,
  defaultOpen,
  modal = true,
}: ProjectSwitcherMenuProps) {
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const [rootComposeProjectId] = useRootComposeProjectId();
  const quickCreateProject = useQuickCreateProjectController();
  const sidebarNavigation = useSidebarNavigation().data;
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [searchQuery, setSearchQuery] = useState("");
  const commandRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useResetPickerScroll<HTMLDivElement>(searchQuery);

  const projects = useMemo<ProjectSelectorOption[]>(
    () =>
      (sidebarNavigation?.projects.map(stripProjectThreads) ?? []).map(
        ({ id, name }) => ({ id, name }),
      ),
    [sidebarNavigation],
  );
  const showSearch =
    projects.length > PROJECT_SWITCHER_SEARCH_MIN_OPTIONS;
  const filteredProjects = useMemo(
    () =>
      showSearch
        ? searchPickerOptions({
            options: projects,
            query: searchQuery,
            getLabel: (project) => project.name,
          })
        : projects,
    [projects, searchQuery, showSearch],
  );
  const currentProject = projects.find(
    (project) => project.id === rootComposeProjectId,
  );
  const triggerLabel = currentProject?.name ?? "Projects";
  const createProjectLabel = quickCreateProject.isCreating
    ? "Creating..."
    : "New project";

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery("");
    }
  };

  const openRootComposeForProject = (projectId: string) => {
    setRootComposeProjectId(projectId);
    onNavigate?.();
    navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
    handleOpenChange(false);
  };

  const handleCreateProject = () => {
    quickCreateProject.openCreateDialog();
    handleOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={modal}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(PROJECT_LIST_ACTION_BUTTON_CLASS, "w-full")}
        >
          <Icon name="Folder" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-left">
              {triggerLabel}
            </span>
            <Icon
              name="ChevronDown"
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Projects"
        mobileTitle="Projects"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (showSearch) {
            searchInputRef.current?.focus();
          } else {
            commandRef.current?.focus();
          }
        }}
        className="flex max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-0.5rem))] w-52 flex-col overflow-hidden p-0 max-md:min-h-0 max-md:w-full max-md:flex-1"
      >
        <Command
          ref={commandRef}
          label="Search projects"
          shouldFilter={false}
          className="min-h-0"
        >
          {showSearch ? (
            <CommandInput
              ref={searchInputRef}
              aria-label="Search projects"
              placeholder="Search projects"
              value={searchQuery}
              onValueChange={setSearchQuery}
              className="h-8 text-xs"
            />
          ) : null}
          <CommandList
            ref={listRef}
            className="min-h-0 max-h-none flex-1 overscroll-contain"
          >
            {projects.length > 0 ? (
              <CommandGroup heading="Projects">
                {filteredProjects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={project.id}
                    keywords={[project.name]}
                    aria-current={
                      project.id === rootComposeProjectId
                        ? "true"
                        : undefined
                    }
                    onSelect={() => openRootComposeForProject(project.id)}
                    className={PROJECT_SWITCHER_ITEM_CLASS_NAME}
                  >
                    <Icon
                      name="Folder"
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {project.name}
                    </span>
                    <Icon
                      name="Check"
                      className={cn(
                        "ml-auto size-4",
                        project.id === rootComposeProjectId
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                      aria-hidden
                    />
                  </CommandItem>
                ))}
                {showSearch && filteredProjects.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground max-md:py-2">
                    No projects found
                  </div>
                ) : null}
              </CommandGroup>
            ) : null}
            {projects.length > 0 ? <CommandSeparator /> : null}
            <CommandGroup
              heading={projects.length === 0 ? "Projects" : undefined}
            >
              <CommandItem
                disabled={!quickCreateProject.isAvailable}
                value="new-project"
                onSelect={handleCreateProject}
                className={PROJECT_SWITCHER_ITEM_CLASS_NAME}
              >
                <Icon
                  name="FolderPlus"
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                {createProjectLabel}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
