import { useMemo } from "react";
import "@bb/shared-ui/icon-extended";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { useProjectActions } from "@/components/project/ProjectActionsProvider";
import {
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section.js";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import {
  stripProjectThreads,
  type SidebarProject,
} from "@/hooks/queries/project-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";

const PROJECTS_SECTION_DESCRIPTION =
  "Projects group your threads by working directory. Rename, delete, or create them here.";

export function resolveProjectSubtitle(
  project: SidebarProject,
): string | null {
  const defaultSource =
    project.sources.find((source) => source.isDefault) ??
    project.sources[0] ??
    null;
  if (defaultSource) return defaultSource.path;
  return project.gitRemoteUrl;
}

interface ProjectSettingsRowProps {
  project: SidebarProject;
  onRename: () => void;
  onRemove: () => void;
}

function ProjectSettingsRow({
  project,
  onRename,
  onRemove,
}: ProjectSettingsRowProps) {
  const subtitle = resolveProjectSubtitle(project);
  return (
    <SettingsRow>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="min-w-0 truncate text-sm font-medium text-foreground">
          {project.name}
        </p>
        <p className="min-w-0 truncate font-mono text-xs text-subtle-foreground/75">
          {subtitle ?? "—"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" onClick={onRename}>
          Rename
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onRemove}>
          Delete
        </Button>
      </div>
    </SettingsRow>
  );
}

export function ProjectsSettingsSection() {
  const sidebarNavigationQuery = useSidebarNavigation();
  const projectActions = useProjectActions();
  const quickCreateProject = useQuickCreateProjectController();

  const projects = useMemo(
    () => sidebarNavigationQuery.data?.projects.map(stripProjectThreads),
    [sidebarNavigationQuery.data],
  );

  const newProjectLabel = quickCreateProject.isCreating
    ? "Creating..."
    : "New project";

  return (
    <SettingsSection
      title="Projects"
      description={PROJECTS_SECTION_DESCRIPTION}
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!quickCreateProject.isAvailable || quickCreateProject.isCreating}
          onClick={() => quickCreateProject.openCreateDialog()}
        >
          <Icon name="Plus" className="size-3.5" />
          {newProjectLabel}
        </Button>
      }
    >
      {projects === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-subtle-foreground">No projects yet.</p>
      ) : (
        <SettingsRowList>
          {projects.map((project) => (
            <ProjectSettingsRow
              key={project.id}
              project={project}
              onRename={() => projectActions.requestRename(project)}
              onRemove={() => projectActions.requestDelete(project)}
            />
          ))}
        </SettingsRowList>
      )}
    </SettingsSection>
  );
}
