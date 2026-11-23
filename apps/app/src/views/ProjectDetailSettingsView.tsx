import { ScopedMachineEnvironmentSettings } from "@/components/settings/MachineEnvironmentSettings";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import "@bb/shared-ui/icon-extended";
import {
  findLocalPathProjectSourceForHost,
  getHostPathBasename,
  type Host,
  type LocalPathProjectSource,
  type ProjectSourceFolder,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Pill } from "@bb/shared-ui/pill";
import { ResourceOverflowMenu } from "@bb/shared-ui/resource-list";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import {
  ProjectDeleteDialog,
  type ProjectDeleteDialogTarget,
} from "@/components/dialogs/ProjectDeleteDialog";
import {
  ProjectMachineSetupDialog,
  type ProjectMachineSetupDialogTarget,
} from "@/components/dialogs/ProjectMachineSetupDialog";
import {
  ProjectRenameDialog,
  type ProjectRenameDialogTarget,
} from "@/components/dialogs/ProjectRenameDialog";
import {
  ProjectSourceDeleteDialog,
  type ProjectSourceDeleteDialogTarget,
} from "@/components/dialogs/ProjectSourceDeleteDialog";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import {
  formatGitRemote,
  pluralize,
} from "@/components/settings/ProjectsSettingsSection";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  SettingsBadge,
  SettingsDetailRow,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import {
  useAddLocalProjectSource,
  useAddProjectSourceFolder,
  useDeleteLocalProjectSource,
  useRemoveProjectSourceFolder,
  useUpdateProjectSourceFolder,
  useDeleteProject,
  useUpdateLocalProjectSource,
  useUpdateProject,
} from "@/hooks/mutations/project-mutations";
import {
  isHostPathMissing,
  useHostPathExistence,
} from "@/hooks/queries/host-path-queries";
import { selectHosts, useHosts } from "@/hooks/queries/host-queries";
import { useProjectDefaultExecutionOptions } from "@/hooks/queries/project-default-execution-options-query";
import { useProjectSourceFolders } from "@/hooks/queries/project-source-folders-query";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  useLocalPathPicker,
  type LocalPathSubmitParams,
} from "@/hooks/useLocalPathPicker";
import { PERMISSION_MODE_OPTIONS } from "@/lib/permission-mode-options";
import { formatRelativeTime } from "@/lib/relative-time";
import { getSettingsTargetPath } from "@/components/settings/settings-sections";

const CHECKOUTS_DESCRIPTION =
  "Where this project lives on each machine. A machine needs a checkout before it can run threads for this project.";

const FOLDERS_DESCRIPTION =
  "Folders outside the checkout that threads on each machine can also read and write. Changes apply from each thread's next turn.";

const DEFAULTS_DESCRIPTION =
  "What new threads in this project start with. bb remembers the last options you used here.";

interface CheckoutRowProps {
  host: Host;
  isPrimary: boolean;
  source: LocalPathProjectSource | null;
  isPathInvalid: boolean;
  isOnlySource: boolean;
  pending: boolean;
  onSetUp: () => void;
  onChangePath: () => void;
  onRemove: () => void;
}

function CheckoutRow({
  host,
  isPrimary,
  source,
  isPathInvalid,
  isOnlySource,
  pending,
  onSetUp,
  onChangePath,
  onRemove,
}: CheckoutRowProps) {
  const connected = host.status === "connected";
  return (
    <SettingsRow className="items-start">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon
            name="Laptop"
            className={cn(
              "size-4 shrink-0 text-muted-foreground",
              !connected && "opacity-60",
            )}
          />
          <MachineStatusDot connected={connected} />
          <Link
            to={getSettingsTargetPath({ machineId: host.id })}
            className="min-w-0 truncate text-sm font-medium text-foreground hover:underline"
          >
            {host.name}
          </Link>
          {isPrimary ? <SettingsBadge>primary</SettingsBadge> : null}
          {isPathInvalid ? (
            <Pill variant="destructive">Path not found</Pill>
          ) : null}
        </div>
        <div className="min-w-0 truncate font-mono text-xs text-subtle-foreground/75">
          {source === null ? (
            <span className="font-sans italic">Not set up on this machine</span>
          ) : (
            source.path
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {source === null ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || !connected}
            onClick={onSetUp}
          >
            {connected ? "Set up" : "Offline"}
          </Button>
        ) : (
          <ResourceOverflowMenu
            label={`${host.name} checkout actions`}
            items={[
              {
                label: "Change folder",
                icon: "Folder",
                disabled: !connected || pending,
                disabledReason: connected
                  ? undefined
                  : "Bring this machine online to change its folder.",
                onSelect: onChangePath,
              },
              {
                label: "Remove checkout",
                icon: "Trash2",
                tone: "destructive",
                disabled: isOnlySource || pending,
                disabledReason: isOnlySource
                  ? "A project needs at least one checkout."
                  : undefined,
                onSelect: onRemove,
              },
            ]}
          />
        )}
      </div>
    </SettingsRow>
  );
}

interface FolderCheckout {
  host: Host;
  source: LocalPathProjectSource;
}

interface FolderRowProps {
  folder: ProjectSourceFolder;
  host: Host;
  pending: boolean;
  onChange: () => void;
  onRemove: () => void;
}

function FolderRow({
  folder,
  host,
  pending,
  onChange,
  onRemove,
}: FolderRowProps) {
  const connected = host.status === "connected";
  const existence = useHostPathExistence(connected ? host.id : null, [
    folder.path,
  ]);
  return (
    <div className="flex min-w-0 items-start gap-2 py-1.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon
            name="Folder"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 truncate text-sm text-foreground">
            {getHostPathBasename(folder.path) ?? folder.path}
          </span>
          {isHostPathMissing(existence, folder.path) ? (
            <Pill variant="destructive" size="sm">
              Not found
            </Pill>
          ) : null}
        </div>
        <div className="min-w-0 truncate pl-5 font-mono text-xs text-subtle-foreground/75">
          {folder.path}
        </div>
      </div>
      <ResourceOverflowMenu
        label={`${folder.path} actions`}
        items={[
          {
            label: "Change folder",
            icon: "Folder",
            disabled: !connected || pending,
            disabledReason: connected
              ? undefined
              : "Bring this machine online to change its folder.",
            onSelect: onChange,
          },
          {
            label: "Remove folder",
            icon: "Trash2",
            tone: "destructive",
            disabled: pending,
            onSelect: onRemove,
          },
        ]}
      />
    </div>
  );
}

interface MachineFoldersRowProps {
  checkout: FolderCheckout;
  pending: boolean;
  onAdd: () => void;
  onChange: (folder: ProjectSourceFolder) => void;
}

function MachineFoldersRow({
  checkout,
  pending,
  onAdd,
  onChange,
}: MachineFoldersRowProps) {
  const { host, source } = checkout;
  const connected = host.status === "connected";
  const foldersQuery = useProjectSourceFolders({
    projectId: source.projectId,
    sourceId: source.id,
  });
  const removeFolder = useRemoveProjectSourceFolder();
  return (
    <SettingsRow className="block">
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon
          name="Laptop"
          className={cn(
            "size-4 shrink-0 text-muted-foreground",
            !connected && "opacity-60",
          )}
        />
        <MachineStatusDot connected={connected} />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {host.name}
        </span>
      </div>
      <div className="mt-2 ml-[7px] border-l border-border pl-4">
        {foldersQuery.isError ? (
          <p className="py-1.5 text-xs text-destructive" role="alert">
            Couldn't load folders.
          </p>
        ) : (
          (foldersQuery.data ?? []).map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              host={host}
              pending={pending || removeFolder.isPending}
              onChange={() => onChange(folder)}
              onRemove={() =>
                removeFolder.mutate({
                  projectId: source.projectId,
                  sourceId: source.id,
                  folderId: folder.id,
                })
              }
            />
          ))
        )}
        <button
          type="button"
          disabled={pending || !connected}
          onClick={onAdd}
          className="flex items-center gap-2 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <Icon name="Plus" className="size-3.5" />
          {connected ? "Add folder" : "Add folder (machine offline)"}
        </button>
      </div>
    </SettingsRow>
  );
}

function LoadingShell({ children }: { children: ReactNode }) {
  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <Link
          to={getSettingsTargetPath({ section: "projects" })}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="ChevronLeft" className="size-3.5" />
          Projects
        </Link>
        {children}
      </div>
    </PageShell>
  );
}

export function ProjectDetailSettingsView() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const sidebarNavigationQuery = useSidebarNavigation();
  const hostsQuery = useHosts();
  const systemConfig = useSystemConfig();
  const defaultsQuery = useProjectDefaultExecutionOptions({ projectId });
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const addLocalSource = useAddLocalProjectSource();
  const updateLocalSource = useUpdateLocalProjectSource();
  const deleteSource = useDeleteLocalProjectSource();
  const addFolder = useAddProjectSourceFolder();
  const updateFolder = useUpdateProjectSourceFolder();

  const [renameTarget, setRenameTarget] =
    useState<ProjectRenameDialogTarget | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<ProjectDeleteDialogTarget | null>(null);
  const [sourceDeleteTarget, setSourceDeleteTarget] =
    useState<ProjectSourceDeleteDialogTarget | null>(null);
  const [machineSetupTarget, setMachineSetupTarget] =
    useState<ProjectMachineSetupDialogTarget | null>(null);
  const [now] = useState(Date.now);

  const projects = sidebarNavigationQuery.data?.projects;
  const project = useMemo(
    () => projects?.find((entry) => entry.id === projectId) ?? null,
    [projectId, projects],
  );
  const projectSources = project?.sources;
  const sources = useMemo(() => projectSources ?? [], [projectSources]);
  const projectName = project?.name ?? "";
  const everyHost = useMemo(
    () => selectHosts(hostsQuery.data, "all"),
    [hostsQuery.data],
  );
  const persistentHosts = useMemo(
    () => selectHosts(hostsQuery.data, "persistent"),
    [hostsQuery.data],
  );
  const [showAllMachines, setShowAllMachines] = useState(false);
  const hosts = showAllMachines ? everyHost : persistentHosts;
  const hiddenMachineCount = everyHost.length - persistentHosts.length;
  const primaryHostId = systemConfig.data?.primaryHostId ?? null;

  const localSourcePending =
    addLocalSource.isPending ||
    updateLocalSource.isPending ||
    addFolder.isPending ||
    updateFolder.isPending;
  const localSourceSubmit = useCallback(
    ({ path, hostId, target, closeDialog }: LocalPathSubmitParams) => {
      if (!projectId) return;
      if (target.kind === "add-source") {
        addLocalSource.mutate(
          { projectId, path, hostId },
          { onSuccess: closeDialog },
        );
      } else if (target.kind === "add-folder") {
        addFolder.mutate(
          { projectId, sourceId: target.sourceId, path },
          { onSuccess: closeDialog },
        );
      } else if (target.kind === "change-folder") {
        updateFolder.mutate(
          {
            projectId,
            sourceId: target.sourceId,
            folderId: target.folderId,
            path,
          },
          { onSuccess: closeDialog },
        );
      } else if (target.kind === "update") {
        const source = sources.find((candidate) => candidate.hostId === hostId);
        if (!source) return;
        updateLocalSource.mutate(
          { projectId, sourceId: source.id, path },
          { onSuccess: closeDialog },
        );
      }
    },
    [
      addFolder,
      addLocalSource,
      projectId,
      sources,
      updateFolder,
      updateLocalSource,
    ],
  );
  const localSourcePicker = useLocalPathPicker({
    isPending: localSourcePending,
    submit: localSourceSubmit,
  });
  const pickerHostId = localSourcePicker.hostId;
  const pickerHostSourcePaths = useMemo(
    () =>
      pickerHostId
        ? sources
            .filter((source) => source.hostId === pickerHostId)
            .map((source) => source.path)
        : [],
    [pickerHostId, sources],
  );
  const pathExistence = useHostPathExistence(
    pickerHostId,
    pickerHostSourcePaths,
  );

  const openSetUp = useCallback(
    (host: Host) => {
      if (!project) return;
      if (host.id === pickerHostId) {
        localSourcePicker.openPicker({
          kind: "add-source",
          projectId: project.id,
          projectName: project.name,
        });
        return;
      }
      setMachineSetupTarget({
        projectId: project.id,
        projectName: project.name,
        gitRemoteUrl: project.gitRemoteUrl,
        hostId: host.id,
        hostName: host.name,
      });
    },
    [localSourcePicker, pickerHostId, project],
  );

  if (sidebarNavigationQuery.isError || hostsQuery.isError) {
    return (
      <LoadingShell>
        <p className="text-sm text-destructive" role="alert">
          Couldn't load this project.
        </p>
      </LoadingShell>
    );
  }

  if (projects === undefined || hostsQuery.data === undefined) {
    return (
      <LoadingShell>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </LoadingShell>
    );
  }

  if (project === null) {
    return (
      <LoadingShell>
        <p className="text-sm text-muted-foreground">
          This project no longer exists.
        </p>
      </LoadingShell>
    );
  }

  const remoteLabel =
    project.gitRemoteUrl === null
      ? null
      : formatGitRemote(project.gitRemoteUrl);
  const configuredHostIds = new Set(sources.map((source) => source.hostId));
  const checkoutHosts = hosts.flatMap((host) => {
    const source = findLocalPathProjectSourceForHost(sources, host.id);
    return source === undefined ? [] : [{ host, source }];
  });
  const configuredCount = hosts.filter((host) =>
    configuredHostIds.has(host.id),
  ).length;
  const defaults = defaultsQuery.data ?? null;
  const permissionLabel =
    defaults === null
      ? null
      : (PERMISSION_MODE_OPTIONS.find(
          (option) => option.value === defaults.permissionMode,
        )?.label ?? defaults.permissionMode);

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6 pb-10">
        <div className="space-y-3">
          <Link
            to={getSettingsTargetPath({ section: "projects" })}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <Icon name="ChevronLeft" className="size-3.5" />
            Projects
          </Link>
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Icon
                  name="FolderGit"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {project.name}
                </h1>
                {configuredCount === 0 ? (
                  <SettingsBadge>needs setup</SettingsBadge>
                ) : null}
              </div>
              <p className="mt-1 min-w-0 truncate text-xs text-subtle-foreground/75">
                {remoteLabel ?? "No git remote"}
                {" · "}
                {hosts.length > 1
                  ? `${configuredCount} of ${pluralize(hosts.length, "machine")}`
                  : pluralize(configuredCount, "machine")}
                {" · "}
                {pluralize(project.threads.length, "thread")}
              </p>
            </div>
            <ResourceOverflowMenu
              label={`${project.name} actions`}
              items={[
                {
                  label: "Rename",
                  icon: "Edit",
                  onSelect: () => {
                    updateProject.reset();
                    setRenameTarget({
                      id: project.id,
                      currentName: project.name,
                    });
                  },
                },
              ]}
            />
          </div>
        </div>

        <SettingsSection title="Checkouts" description={CHECKOUTS_DESCRIPTION}>
          {hosts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No machines are paired yet.
            </p>
          ) : (
            <SettingsRowList>
              {hosts.map((host) => {
                const source = findLocalPathProjectSourceForHost(
                  sources,
                  host.id,
                );
                const isPickerHost = host.id === pickerHostId;
                return (
                  <CheckoutRow
                    key={host.id}
                    host={host}
                    isPrimary={hosts.length > 1 && host.id === primaryHostId}
                    source={source ?? null}
                    isPathInvalid={
                      source !== undefined &&
                      isPickerHost &&
                      isHostPathMissing(pathExistence, source.path)
                    }
                    isOnlySource={sources.length <= 1}
                    pending={localSourcePending || deleteSource.isPending}
                    onSetUp={() => openSetUp(host)}
                    onChangePath={() => {
                      if (!source) return;
                      localSourcePicker.openPicker({
                        kind: "update",
                        projectId: project.id,
                        projectName,
                        currentPath: source.path,
                        hostId: host.id,
                        hostName: host.name,
                      });
                    }}
                    onRemove={() => {
                      if (!source) return;
                      setSourceDeleteTarget({
                        id: source.id,
                        label: `${host.name} · ${source.path}`,
                      });
                    }}
                  />
                );
              })}
            </SettingsRowList>
          )}
          {hiddenMachineCount > 0 ? (
            <button
              type="button"
              aria-expanded={showAllMachines}
              onClick={() => setShowAllMachines((previous) => !previous)}
              className="-ml-1 inline-flex items-center gap-1.5 self-start rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
            >
              <Icon
                name="ChevronDown"
                className={cn(
                  "size-3.5 transition-transform",
                  showAllMachines && "rotate-180",
                )}
                aria-hidden
              />
              <span>
                {showAllMachines ? "Show fewer machines" : "Show all machines"}
              </span>
            </button>
          ) : null}
        </SettingsSection>

        {checkoutHosts.length > 0 ? (
          <SettingsSection title="Folders" description={FOLDERS_DESCRIPTION}>
            <SettingsRowList>
              {checkoutHosts.map((checkout) => (
                <MachineFoldersRow
                  key={checkout.source.id}
                  checkout={checkout}
                  pending={localSourcePending}
                  onAdd={() =>
                    localSourcePicker.openPicker({
                      kind: "add-folder",
                      projectId: project.id,
                      projectName,
                      sourceId: checkout.source.id,
                      hostId: checkout.host.id,
                      hostName: checkout.host.name,
                    })
                  }
                  onChange={(folder) =>
                    localSourcePicker.openPicker({
                      kind: "change-folder",
                      projectId: project.id,
                      projectName,
                      sourceId: checkout.source.id,
                      folderId: folder.id,
                      currentPath: folder.path,
                      hostId: checkout.host.id,
                      hostName: checkout.host.name,
                    })
                  }
                />
              ))}
            </SettingsRowList>
          </SettingsSection>
        ) : null}

        <SettingsSection
          title="Thread defaults"
          description={DEFAULTS_DESCRIPTION}
        >
          {defaultsQuery.isError ? (
            <p className="text-sm text-destructive" role="alert">
              Couldn't load thread defaults.
            </p>
          ) : defaultsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : defaults === null ? (
            <p className="text-sm text-muted-foreground">
              No threads have run here yet. The first thread's options become
              the defaults.
            </p>
          ) : (
            <SettingsRowList>
              <SettingsDetailRow label="Provider">
                <span>{defaults.providerId}</span>
              </SettingsDetailRow>
              <SettingsDetailRow label="Model">
                <span className="font-mono text-xs">{defaults.model}</span>
              </SettingsDetailRow>
              <SettingsDetailRow label="Permission mode">
                <span>{permissionLabel}</span>
              </SettingsDetailRow>
              <SettingsDetailRow label="Reasoning">
                <span>{defaults.reasoningLevel}</span>
              </SettingsDetailRow>
            </SettingsRowList>
          )}
        </SettingsSection>

        <SettingsSection title="Project information">
          <SettingsRowList>
            <SettingsDetailRow label="Git remote">
              {project.gitRemoteUrl === null ? (
                <span>None detected</span>
              ) : (
                <span className="min-w-0 truncate font-mono text-xs">
                  {project.gitRemoteUrl}
                </span>
              )}
            </SettingsDetailRow>
            <SettingsDetailRow label="Project ID">
              <span className="font-mono text-xs">{project.id}</span>
            </SettingsDetailRow>
            <SettingsDetailRow label="Created">
              <span>
                {formatRelativeTime({ timestamp: project.createdAt, now })}
              </span>
            </SettingsDetailRow>
          </SettingsRowList>
        </SettingsSection>

        <ScopedMachineEnvironmentSettings projectId={project.id} />

        <SettingsSection
          title="Danger zone"
          description={`Deleting ${project.name} removes the project and every thread in it, including archived ones. Checkouts stay on disk.`}
        >
          <SettingsRowList>
            <SettingsRow>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  deleteProject.reset();
                  setDeleteTarget({ id: project.id, name: project.name });
                }}
              >
                Delete project
              </Button>
            </SettingsRow>
          </SettingsRowList>
        </SettingsSection>
      </div>

      <ProjectPathDialog
        target={localSourcePicker.projectPathDialog.target}
        pending={localSourcePending}
        platform={localSourcePicker.platform}
        hostId={localSourcePicker.hostId}
        hostName={localSourcePicker.hostName}
        onOpenChange={localSourcePicker.projectPathDialog.onOpenChange}
        onSubmit={localSourcePicker.submitProjectPath}
      />

      <ProjectMachineSetupDialog
        target={machineSetupTarget}
        onOpenChange={(open) => {
          if (!open) setMachineSetupTarget(null);
        }}
        onComplete={() => setMachineSetupTarget(null)}
      />

      <ProjectSourceDeleteDialog
        target={sourceDeleteTarget}
        pending={deleteSource.isPending}
        onOpenChange={(open) => {
          if (!open) setSourceDeleteTarget(null);
        }}
        onDelete={(sourceId) =>
          deleteSource.mutate(
            { projectId: project.id, sourceId },
            { onSuccess: () => setSourceDeleteTarget(null) },
          )
        }
      />

      <ProjectRenameDialog
        target={renameTarget}
        pending={updateProject.isPending}
        onOpenChange={(open) => {
          if (!open && !updateProject.isPending) setRenameTarget(null);
        }}
        onRename={(id, name) =>
          updateProject.mutate(
            { id, name },
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
        onDelete={(id) =>
          deleteProject.mutate(id, {
            onSuccess: () => {
              setDeleteTarget(null);
              void navigate(getSettingsTargetPath({ section: "projects" }), {
                replace: true,
              });
            },
          })
        }
      />
    </PageShell>
  );
}
