import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "./OptionPicker";

export interface ProjectSelectorOption {
  id: string;
  name: string;
}

export interface ProjectSelectorCreateProjectConfig {
  onCreate: () => void;
  disabled?: boolean;
  isCreating?: boolean;
}

export interface ProjectSelectorProps {
  projects: readonly ProjectSelectorOption[];
  /**
   * Selected project id, or `null` for the no-project case. Only emit/accept
   * `null` when `allowNoProject` is true — callers in required mode can wrap
   * their handler with a null guard (the picker won't emit `null` then).
   */
  value: string | null;
  onChange: (projectId: string | null) => void;
  /**
   * When true, adds a "Don't work in a project" item and lets the trigger
   * render the "Work in a project" empty state when `value === null`. Default
   * false: the no-project item is hidden and `value` is assumed to be a valid
   * project id (the trigger has no empty state).
   */
  allowNoProject?: boolean;
  /** When provided, adds a "New project" action. */
  createProject?: ProjectSelectorCreateProjectConfig;
  /** Render as a non-interactive label while preserving the selected project. */
  disabled?: boolean;
  className?: string;
  /** Render with the menu open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the menu blocks page interaction. Defaults to Radix's true. */
  modal?: boolean;
}

export function ProjectSelector({
  projects,
  value,
  onChange,
  allowNoProject = false,
  createProject,
  disabled = false,
  className,
  defaultOpen,
  modal,
}: ProjectSelectorProps) {
  const selected = value !== null ? projects.find((p) => p.id === value) : null;
  // When allowNoProject is false and the caller's value doesn't match any
  // project (shouldn't happen in normal use), the trigger falls back to the
  // first project so it's never blank.
  const fallback = !allowNoProject && !selected ? projects[0] : null;
  const triggerLabel = selected?.name ?? fallback?.name ?? "Work in a project";
  const compactTriggerLabel = selected?.name ?? fallback?.name ?? "No project";
  const triggerIcon = selected || fallback ? "Folder" : "FolderPlus";
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
          {disabled ? null : (
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
        {showActionSeparator ? (
          <DropdownMenuSeparator />
        ) : null}
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
