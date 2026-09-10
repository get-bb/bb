import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import "@bb/shared-ui/icon-extended";
import {
  findLocalPathProjectSourceForHost,
  type Host,
  type LocalPathProjectSource,
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
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import {
  useAddLocalProjectSource,
  useDeleteLocalProjectSource,
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
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  useLocalPathPicker,
  type LocalPathSubmitParams,
} from "@/hooks/useLocalPathPicker";
import { PERMISSION_MODE_OPTIONS } from "@/lib/permission-mode-options";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  getSettingsMachineRoutePath,
  getSettingsRoutePath,
} from "@/lib/route-paths";

const CHECKOUTS_DESCRIPTION =
  "Where this project lives on each machine. A machine needs a checkout before it can run threads for this project.";

const DEFAULTS_DESCRIPTION =
  "What new threads in this project start with. bb remembers the last options you used here.";

interface DetailRowProps {
  label: string;
  children: ReactNode;
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <SettingsRow className="flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="shrink-0 text-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 text-left text-subtle-foreground sm:ml-auto sm:justify-end sm:text-right">
        {children}
      </div>
    </SettingsRow>
  );
}

interface CheckoutRowProps {
  host: Host;
  isPrimary: boolean;
  source: LocalPathProjectSource | null;
  isPathInvalid: boolean;
  canEditPath: boolean;
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
  canEditPath,
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
            to={getSettingsMachineRoutePath(host.id)}
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
                disabled: !canEditPath || pending,
                disabledReason: canEditPath
                  ? undefined
                  : "Folders on other machines are changed from that machine.",
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

function LoadingShell({ children }: { children: ReactNode }) {
  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <Link
          to={getSettingsRoutePath("projects")}
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

  const [renameTarget, setRenameTarget] =
    useState<ProjectRenameDialogTarget | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<ProjectDeleteDialogTarget | null>(null);
  const [sourceDeleteTarget, setSourceDeleteTarget] =
    useState<ProjectSourceDeleteDialogTarget | null>(null);
  const [machineSetupTarget, setMachineSetupTarget] =
    useState<ProjectMachineSetupDialogTarget | null>(null);

  const projects = sidebarNavigationQuery.data?.projects;
  const project = projects?.find((entry) => entry.id === projectId) ?? null;
  const projectSources = project?.sources;
  const sources = useMemo(() => projectSources ?? [], [projectSources]);
  const projectName = project?.name ?? "";
  const hosts = useMemo(
    () => selectHosts(hostsQuery.data),
    [hostsQuery.data],
  );
  const primaryHostId = systemConfig.data?.primaryHostId ?? null;

  const localSourcePending =
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
        const source = sources.find((candidate) => candidate.hostId === hostId);
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
  const configuredCount = new Set(sources.map((source) => source.hostId)).size;
  const defaults = defaultsQuery.data ?? null;
  const permissionLabel =
    defaults === null
      ? null
      : (PERMISSION_MODE_OPTIONS.find(
          (option) => option.value === defaults.permissionMode,
        )?.label ?? defaults.permissionMode);
  const now = Date.now();

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6 pb-10">
        <div className="space-y-3">
          <Link
            to={getSettingsRoutePath("projects")}
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
                    canEditPath={isPickerHost}
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
        </SettingsSection>

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
              <DetailRow label="Provider">
                <span>{defaults.providerId}</span>
              </DetailRow>
              <DetailRow label="Model">
                <span className="font-mono text-xs">{defaults.model}</span>
              </DetailRow>
              <DetailRow label="Permission mode">
                <span>{permissionLabel}</span>
              </DetailRow>
              <DetailRow label="Reasoning">
                <span>{defaults.reasoningLevel}</span>
              </DetailRow>
            </SettingsRowList>
          )}
        </SettingsSection>

        <SettingsSection title="Project information">
          <SettingsRowList>
            <DetailRow label="Git remote">
              {project.gitRemoteUrl === null ? (
                <span>None detected</span>
              ) : (
                <span className="min-w-0 truncate font-mono text-xs">
                  {project.gitRemoteUrl}
                </span>
              )}
            </DetailRow>
            <DetailRow label="Project ID">
              <span className="font-mono text-xs">{project.id}</span>
            </DetailRow>
            <DetailRow label="Created">
              <span>
                {formatRelativeTime({ timestamp: project.createdAt, now })}
              </span>
            </DetailRow>
          </SettingsRowList>
        </SettingsSection>

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
              navigate(getSettingsRoutePath("projects"), { replace: true });
            },
          })
        }
      />
    </PageShell>
  );
}
