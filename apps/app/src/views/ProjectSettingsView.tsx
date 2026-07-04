import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import {
  findLocalPathProjectSourceForHost,
  isLocalPathProjectSource,
  type LocalPathProjectSource,
} from "@bb/domain";
import { Button } from "@/components/ui/button.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Textarea } from "@/components/ui/textarea.js";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import {
  ProjectSourceDeleteDialog,
  type ProjectSourceDeleteDialogTarget,
} from "@/components/dialogs/ProjectSourceDeleteDialog";
import {
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section.js";
import { ProjectSourceRow } from "@/views/project-settings/ProjectSourceRow";
import {
  useAddLocalProjectSource,
  useDeleteLocalProjectSource,
  useUpdateProject,
  useUpdateLocalProjectSource,
} from "@/hooks/mutations/project-mutations";
import {
  isHostPathMissing,
  useHostPathExistence,
} from "@/hooks/queries/host-path-queries";
import {
  useLocalPathPicker,
  type LocalPathSubmitParams,
} from "@/hooks/useLocalPathPicker";
import { stripProjectThreads } from "@/hooks/queries/project-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";

function readScriptFormValue(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function ProjectSettingsView() {
  const { projectId } = useParams<{ projectId: string }>();
  const sidebarNavigationQuery = useSidebarNavigation();
  const projects = useMemo(
    () => sidebarNavigationQuery.data?.projects.map(stripProjectThreads),
    [sidebarNavigationQuery.data],
  );
  const isLoading = sidebarNavigationQuery.isFetching && projects === undefined;

  const [deleteTarget, setDeleteTarget] =
    useState<ProjectSourceDeleteDialogTarget | null>(null);

  const deleteSource = useDeleteLocalProjectSource();
  const addLocalSource = useAddLocalProjectSource();
  const updateProject = useUpdateProject();
  const updateLocalSource = useUpdateLocalProjectSource();

  const project = projects?.find((p) => p.id === projectId);
  const projectSources = project?.sources;
  const sources = useMemo(() => projectSources ?? [], [projectSources]);

  const projectName = project?.name ?? "";
  const localSourcePickerPending =
    addLocalSource.isPending || updateLocalSource.isPending;
  const localSourceSubmit = useCallback(
    ({ path, hostId, target, closeDialog }: LocalPathSubmitParams) => {
      if (!projectId) return;
      if (target.kind === "add-source") {
        addLocalSource.mutate(
          { projectId, path, hostId },
          { onSuccess: closeDialog },
        );
      } else if (target.kind === "update") {
        const source = sources.find(
          (candidate): candidate is LocalPathProjectSource =>
            isLocalPathProjectSource(candidate) && candidate.hostId === hostId,
        );
        if (!source) return;
        updateLocalSource.mutate(
          { projectId, sourceId: source.id, path },
          { onSuccess: closeDialog },
        );
      }
    },
    [addLocalSource, projectId, sources, updateLocalSource],
  );
  const localSourcePicker = useLocalPathPicker({
    isPending: localSourcePickerPending,
    submit: localSourceSubmit,
  });
  const openAddLocalSourcePicker = useCallback(() => {
    if (!projectId) return;
    localSourcePicker.openPicker({
      kind: "add-source",
      projectId,
      projectName,
    });
  }, [localSourcePicker, projectId, projectName]);
  const openEditLocalSourcePicker = useCallback(
    (source: LocalPathProjectSource) => {
      if (!projectId) return;
      localSourcePicker.openPicker({
        kind: "update",
        projectId,
        projectName,
        currentPath: source.path,
      });
    },
    [localSourcePicker, projectId, projectName],
  );
  const pickerHostId = localSourcePicker.hostId;

  const pickerHostSourcePaths = useMemo(() => {
    if (!pickerHostId) return [];
    return sources
      .filter(
        (source): source is LocalPathProjectSource =>
          isLocalPathProjectSource(source) && source.hostId === pickerHostId,
      )
      .map((source) => source.path);
  }, [pickerHostId, sources]);
  const pathExistence = useHostPathExistence(
    pickerHostId,
    pickerHostSourcePaths,
  );

  const showAddLocalSourceButton =
    pickerHostId != null &&
    !findLocalPathProjectSourceForHost(sources, pickerHostId);

  const addSourceButtons = showAddLocalSourceButton ? (
    <div className="mt-2 flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={addLocalSource.isPending}
        onClick={openAddLocalSourcePicker}
      >
        Add local path
      </Button>
    </div>
  ) : null;

  const lifecycleFormKey = project
    ? `${project.id}:${project.updatedAt}`
    : "project-lifecycle-loading";
  const saveLifecycleScripts = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!projectId) return;
      const formData = new FormData(event.currentTarget);
      updateProject.mutate({
        id: projectId,
        runCommand: readScriptFormValue(formData.get("runCommand")),
        worktreeInitScript: readScriptFormValue(
          formData.get("worktreeInitScript"),
        ),
        worktreeTeardownScript: readScriptFormValue(
          formData.get("worktreeTeardownScript"),
        ),
      });
    },
    [projectId, updateProject],
  );

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <SettingsSection title="Project Sources">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sources.length === 0 ? (
            <div>
              <p className="text-sm text-muted-foreground">
                No sources configured.
              </p>
              {addSourceButtons}
            </div>
          ) : (
            <div>
              <SettingsRowList>
                {sources.map((source) => {
                  const isPickerHostSource =
                    isLocalPathProjectSource(source) &&
                    pickerHostId != null &&
                    source.hostId === pickerHostId;
                  const isInvalid =
                    isPickerHostSource &&
                    isHostPathMissing(pathExistence, source.path);
                  return (
                    <ProjectSourceRow
                      key={source.id}
                      source={source}
                      canEditLocalPath={isPickerHostSource}
                      isLocalPathInvalid={isInvalid}
                      isEditPending={localSourcePickerPending}
                      isOnlySource={sources.length <= 1}
                      onEditLocalPath={openEditLocalSourcePicker}
                      onRemove={(target) =>
                        setDeleteTarget({
                          id: target.id,
                          label: target.path,
                        })
                      }
                    />
                  );
                })}
              </SettingsRowList>
              {addSourceButtons}
            </div>
          )}
        </SettingsSection>
        <SettingsSection
          title="Worktree Lifecycle"
          description="Shell snippets for managed worktree setup and cleanup. Use $BB_PORT, or $BB_PORT_1 through $BB_PORT_9, for per-worktree local ports."
        >
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !project ? (
            <p className="text-sm text-muted-foreground">Project not found.</p>
          ) : (
            <form
              key={lifecycleFormKey}
              className="space-y-4"
              onSubmit={saveLifecycleScripts}
            >
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-subtle-foreground"
                  htmlFor="runCommand"
                >
                  Run command
                </label>
                <Textarea
                  id="runCommand"
                  name="runCommand"
                  defaultValue={project.runCommand ?? ""}
                  disabled={updateProject.isPending}
                  placeholder="pnpm dev"
                  rows={3}
                  spellCheck={false}
                  className="min-h-20 resize-y font-mono text-xs leading-5"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-subtle-foreground"
                  htmlFor="worktreeInitScript"
                >
                  Init script
                </label>
                <Textarea
                  id="worktreeInitScript"
                  name="worktreeInitScript"
                  defaultValue={project.worktreeInitScript ?? ""}
                  disabled={updateProject.isPending}
                  placeholder="pnpm install"
                  rows={8}
                  spellCheck={false}
                  className="min-h-36 resize-y font-mono text-xs leading-5"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-subtle-foreground"
                  htmlFor="worktreeTeardownScript"
                >
                  Teardown script
                </label>
                <Textarea
                  id="worktreeTeardownScript"
                  name="worktreeTeardownScript"
                  defaultValue={project.worktreeTeardownScript ?? ""}
                  disabled={updateProject.isPending}
                  placeholder="docker compose down --volumes --remove-orphans"
                  rows={8}
                  spellCheck={false}
                  className="min-h-36 resize-y font-mono text-xs leading-5"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={updateProject.isPending}
                >
                  {updateProject.isPending ? "Saving…" : "Save commands"}
                </Button>
              </div>
            </form>
          )}
        </SettingsSection>
      </div>

      <ProjectPathDialog
        target={localSourcePicker.projectPathDialog.target}
        pending={localSourcePickerPending}
        platform={localSourcePicker.platform}
        hostId={localSourcePicker.hostId}
        hostName={localSourcePicker.hostName}
        onOpenChange={localSourcePicker.projectPathDialog.onOpenChange}
        onSubmit={localSourcePicker.submitProjectPath}
      />

      <ProjectSourceDeleteDialog
        target={deleteTarget}
        pending={deleteSource.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onDelete={(sourceId) => {
          if (!projectId) return;
          deleteSource.mutate(
            { projectId, sourceId },
            { onSuccess: () => setDeleteTarget(null) },
          );
        }}
      />
    </PageShell>
  );
}
