import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";

export interface ProjectSelectorOption {
  id: string;
  name: string;
}

export interface ProjectSelectorCreateProjectConfig {
  onCreate: () => void;
  disabled?: boolean;
  isCreating?: boolean;
}

interface ProjectSelectorProps {
  projects: readonly ProjectSelectorOption[];
  value: string | null;
  onChange: (projectId: string | null) => void;
  allowNoProject?: boolean;
  createProject?: ProjectSelectorCreateProjectConfig;
  disabled?: boolean;
  isLoading?: boolean;
  showChevronWhenDisabled?: boolean;
  className?: string;
  defaultOpen?: boolean;
  modal?: boolean;
}

export function ProjectSelector({
  projects,
  value,
  onChange,
  allowNoProject = false,
  createProject,
  disabled: disabledProp = false,
  isLoading = false,
  showChevronWhenDisabled = false,
  className,
  defaultOpen,
  modal,
}: ProjectSelectorProps) {
  const disabled = disabledProp || isLoading;
  const selected = value !== null ? projects.find((p) => p.id === value) : null;
  const fallback = !allowNoProject && !selected ? projects[0] : null;
  const triggerLabel = isLoading
    ? "Loading projects…"
    : (selected?.name ?? fallback?.name ?? "Work in a project");
  const compactTriggerLabel = isLoading
    ? "Loading…"
    : (selected?.name ?? fallback?.name ?? "No project");
  const triggerIcon =
    isLoading || selected || fallback ? "Folder" : "FolderPlus";
  const createProjectAction = createProject;
  const createProjectLabel = createProjectAction?.isCreating
    ? "Creating..."
    : "New project";
  const showActionSeparator =
    projects.length > 0 && (Boolean(createProjectAction) || allowNoProject);

  return (
    <DropdownMenu defaultOpen={defaultOpen} modal={modal}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Project"
          aria-busy={isLoading || undefined}
          disabled={disabled}
          data-promptbox-project-control=""
          className={cn(
            OPTION_BASE_CLASS_NAME,
            !disabled && OPTION_INTERACTIVE_CLASS_NAME,
            disabled && "cursor-default disabled:opacity-100",
            OPTION_MUTED_CLASS_NAME,
            className,
          )}
        >
          <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME}>
            <Icon
              name={triggerIcon}
              className="size-3.5 shrink-0"
              aria-hidden
            />
            <span className="min-w-0 truncate" data-promptbox-full-label="">
              {triggerLabel}
            </span>
            <span className="min-w-0 truncate" data-promptbox-compact-label="">
              {compactTriggerLabel}
            </span>
          </span>
          {disabled && !showChevronWhenDisabled ? null : (
            <Icon
              name="ChevronDown"
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-52">
        <DropdownMenuLabel>Project</DropdownMenuLabel>
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={() => onChange(project.id)}
          >
            <Icon
              name="Folder"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            {project.name}
            <Icon
              name="Check"
              className={cn(
                "ml-auto size-4",
                project.id === value ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </DropdownMenuItem>
        ))}
        {showActionSeparator ? <DropdownMenuSeparator /> : null}
        {createProjectAction ? (
          <DropdownMenuItem
            disabled={createProjectAction.disabled}
            onSelect={() => createProjectAction.onCreate()}
          >
            <Icon
              name="FolderPlus"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            {createProjectLabel}
          </DropdownMenuItem>
        ) : null}
        {allowNoProject ? (
          <DropdownMenuItem onSelect={() => onChange(null)}>
            <Icon
              name="FolderMinus"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            Don&apos;t work in a project
            <Icon
              name="Check"
              className={cn(
                "ml-auto size-4",
                value === null ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
