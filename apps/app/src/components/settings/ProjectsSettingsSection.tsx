import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Host } from "@bb/domain";
import type { ProjectWithThreadsResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import "@bb/shared-ui/icon-extended";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceOverflowMenu,
  ResourceRowDetailChevron,
} from "@bb/shared-ui/resource-list";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import {
  ProjectDeleteDialog,
  type ProjectDeleteDialogTarget,
} from "@/components/dialogs/ProjectDeleteDialog";
import {
  ProjectRenameDialog,
  type ProjectRenameDialogTarget,
} from "@/components/dialogs/ProjectRenameDialog";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import {
  useDeleteProject,
  useReorderProject,
  useUpdateProject,
} from "@/hooks/mutations/project-mutations";
import { selectHosts, useHosts } from "@/hooks/queries/host-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useQuickCreateProject } from "@/hooks/useQuickCreateProject";
import { getSettingsProjectRoutePath } from "@/lib/route-paths";

const PROJECTS_SECTION_DESCRIPTION =
  "Repositories Opulent can work in. Drag to change the order projects appear in the sidebar.";

const restrictDragToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

const projectDragModifiers: Modifier[] = [restrictDragToVerticalAxis];

export function formatGitRemote(url: string): string {
  const sshMatch = /^[^@]+@([^:]+):(.+?)(?:\.git)?$/.exec(url);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\.git$/, "")}`;
  } catch {
    return url;
  }
}

export interface ProjectReorderRequest {
  order: string[];
  previousProjectId: string | null;
  nextProjectId: string | null;
}

export function buildProjectReorderRequest(
  ids: readonly string[],
  activeId: string,
  overId: string,
): ProjectReorderRequest | null {
  if (activeId === overId) return null;
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1) return null;
  const order = arrayMove([...ids], from, to);
  return {
    order,
    previousProjectId: order[to - 1] ?? null,
    nextProjectId: order[to + 1] ?? null,
  };
}

export function pluralize(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

interface ProjectSummary {
  configuredMachineCount: number;
  onlineMachineCount: number;
  totalMachineCount: number;
}

function summarizeMachines(
  project: ProjectWithThreadsResponse,
  hostById: ReadonlyMap<string, Host>,
): ProjectSummary {
  let configuredMachineCount = 0;
  let onlineMachineCount = 0;
  for (const hostId of new Set(
    project.sources.map((source) => source.hostId),
  )) {
    const host = hostById.get(hostId);
    if (!host) continue;
    configuredMachineCount += 1;
    if (host.status === "connected") onlineMachineCount += 1;
  }
  return {
    configuredMachineCount,
    onlineMachineCount,
    totalMachineCount: hostById.size,
  };
}

function machineLabel(summary: ProjectSummary): string {
  if (summary.configuredMachineCount === 0) return "Not set up on any machine";
  if (summary.totalMachineCount <= 1) return "1 machine";
  return `${summary.configuredMachineCount} of ${summary.totalMachineCount} machines`;
}

interface SortableProjectRowProps {
  project: ProjectWithThreadsResponse;
  summary: ProjectSummary;
  dragDisabled: boolean;
  onRename: () => void;
  onDelete: () => void;
}

function SortableProjectRow({
  project,
  summary,
  dragDisabled,
  onRename,
  onDelete,
}: SortableProjectRowProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: project.id, disabled: dragDisabled });
  const style = useMemo<CSSProperties>(
    () => ({ transform: CSS.Translate.toString(transform), transition }),
    [transform, transition],
  );
  const detailPath = getSettingsProjectRoutePath(project.id);
  const remoteLabel =
    project.gitRemoteUrl === null
      ? null
      : formatGitRemote(project.gitRemoteUrl);
  const needsSetup = summary.configuredMachineCount === 0;
  const allOffline =
    summary.configuredMachineCount > 0 && summary.onlineMachineCount === 0;

  return (
    <SettingsRow
      ref={setNodeRef}
      style={style}
      className={cn(
        "items-start",
        isDragging && "relative z-10 rounded-md bg-card opacity-90 shadow-lift",
      )}
    >
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "-ml-2 h-8 w-7 shrink-0 touch-none text-muted-foreground",
          !dragDisabled && "cursor-grab active:cursor-grabbing",
        )}
        disabled={dragDisabled}
        aria-label={`Reorder ${project.name}`}
        {...attributes}
        {...listeners}
      >
        <Icon name="DragDropVertical" aria-hidden="true" />
      </Button>
      <div
        data-project-row
        className="group -mx-2 flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-state-hover focus-within:bg-state-hover"
      >
        <Link
          to={detailPath}
          aria-label={`Open ${project.name} settings`}
          className="min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <Icon
                name="FolderGit"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 truncate text-sm font-medium text-foreground">
                {project.name}
              </span>
              {needsSetup ? <SettingsBadge>needs setup</SettingsBadge> : null}
              {allOffline ? <SettingsBadge>offline</SettingsBadge> : null}
            </div>
            <div className="min-w-0 space-y-0.5 text-xs text-subtle-foreground/75">
              {remoteLabel === null ? (
                <div className="italic">No git remote</div>
              ) : (
                <div className="truncate">{remoteLabel}</div>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span
                  className={cn("shrink-0", needsSetup && "text-warning-text")}
                >
                  {machineLabel(summary)}
                </span>
                <span className="shrink-0">
                  {pluralize(project.threads.length, "thread")}
                </span>
              </div>
            </div>
          </div>
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          <ResourceOverflowMenu
            label={`${project.name} actions`}
            items={[
              { label: "Rename", icon: "Edit", onSelect: onRename },
              {
                label: "Delete project",
                icon: "Trash2",
                tone: "destructive",
                onSelect: onDelete,
              },
            ]}
          />
          <ResourceRowDetailChevron />
        </div>
      </div>
    </SettingsRow>
  );
}

export function ProjectsSettingsSection() {
  const sidebarNavigationQuery = useSidebarNavigation();
  const hostsQuery = useHosts();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const reorderProject = useReorderProject();
  const quickCreateProject = useQuickCreateProject();
  const [renameTarget, setRenameTarget] =
    useState<ProjectRenameDialogTarget | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<ProjectDeleteDialogTarget | null>(null);
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);

  const serverProjects = sidebarNavigationQuery.data?.projects;
  useEffect(() => {
    setOptimisticOrder(null);
  }, [serverProjects]);
  const projects = useMemo(() => {
    if (!serverProjects) return undefined;
    if (!optimisticOrder) return serverProjects;
    const byId = new Map(serverProjects.map((entry) => [entry.id, entry]));
    const ordered = optimisticOrder.flatMap((id) => byId.get(id) ?? []);
    const seen = new Set(optimisticOrder);
    return [
      ...ordered,
      ...serverProjects.filter((entry) => !seen.has(entry.id)),
    ];
  }, [optimisticOrder, serverProjects]);
  const projectIds = useMemo(
    () => projects?.map((project) => project.id) ?? [],
    [projects],
  );
  const hosts = useMemo(
    () => selectHosts(hostsQuery.data, "persistent"),
    [hostsQuery.data],
  );
  const hostById = useMemo(
    () => new Map<string, Host>(hosts.map((host) => [host.id, host])),
    [hosts],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const dragDisabled = reorderProject.isPending || projectIds.length < 2;

  const handleDragEnd = (event: DragEndEvent): void => {
    if (
      dragDisabled ||
      typeof event.active.id !== "string" ||
      typeof event.over?.id !== "string"
    ) {
      return;
    }
    const request = buildProjectReorderRequest(
      projectIds,
      event.active.id,
      event.over.id,
    );
    if (request === null) return;
    setOptimisticOrder(request.order);
    reorderProject.mutate(
      {
        id: event.active.id,
        previousProjectId: request.previousProjectId,
        nextProjectId: request.nextProjectId,
      },
      { onError: () => setOptimisticOrder(null) },
    );
  };

  return (
    <>
      <SettingsSection
        title="Projects"
        description={PROJECTS_SECTION_DESCRIPTION}
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={
              !quickCreateProject.isAvailable || quickCreateProject.isCreating
            }
            onClick={quickCreateProject.openCreateDialog}
          >
            <Icon name="Plus" className="size-3.5" />
            Add a project
          </Button>
        }
      >
        {sidebarNavigationQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Couldn't load projects.
          </p>
        ) : projects === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-subtle-foreground">
            No projects yet. Add a project to start running threads in a
            repository.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={projectDragModifiers}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={projectIds}
              strategy={verticalListSortingStrategy}
            >
              <SettingsRowList>
                {projects.map((project) => (
                  <SortableProjectRow
                    key={project.id}
                    project={project}
                    summary={summarizeMachines(project, hostById)}
                    dragDisabled={dragDisabled}
                    onRename={() => {
                      updateProject.reset();
                      setRenameTarget({
                        id: project.id,
                        currentName: project.name,
                      });
                    }}
                    onDelete={() => {
                      deleteProject.reset();
                      setDeleteTarget({ id: project.id, name: project.name });
                    }}
                  />
                ))}
              </SettingsRowList>
            </SortableContext>
          </DndContext>
        )}
      </SettingsSection>

      <ProjectPathDialog
        target={quickCreateProject.projectPathDialog.target}
        pending={quickCreateProject.isCreating}
        platform={quickCreateProject.platform}
        hostId={quickCreateProject.hostId}
        hostName={quickCreateProject.hostName}
        hosts={quickCreateProject.hosts}
        onOpenChange={quickCreateProject.projectPathDialog.onOpenChange}
        onSubmit={quickCreateProject.submitProjectPath}
      />

      <ProjectRenameDialog
        target={renameTarget}
        pending={updateProject.isPending}
        onOpenChange={(open) => {
          if (!open && !updateProject.isPending) setRenameTarget(null);
        }}
        onRename={(projectId, name) =>
          updateProject.mutate(
            { id: projectId, name },
            { onSuccess: () => setRenameTarget(null) },
          )
        }
      />

      <ProjectDeleteDialog
        target={deleteTarget}
        pending={deleteProject.isPending}
        onOpenChange={(open) => {
          if (!open && !deleteProject.isPending) setDeleteTarget(null);
        }}
        onDelete={(projectId) =>
          deleteProject.mutate(projectId, {
            onSuccess: () => setDeleteTarget(null),
          })
        }
      />
    </>
  );
}
