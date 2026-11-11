import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  experimental_resolveThreadStatus as resolveThreadStatus,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useArchiveEnvironmentThreads as useArchiveEnvironmentThreads,
  experimental_useSidebarThreads as useSidebarThreads,
  ThreadTitle,
  useBbNavigate,
  useSidebarThreadDraftIds,
  useSidebarThreadRowStatuses,
  type PluginSidebarProject,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CHROME_SECTION_LABEL_CLASS } from "@/components/ui/chrome-style-tokens";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import {
  SIDEBAR_CONTROL_BUTTON_CLASS,
  SIDEBAR_GROUP_TEXT_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
} from "@/components/ui/sidebar-row-classes";
import { cn } from "@/lib/utils";
import { useNewChatEnvironment } from "../new-chat/active.js";
import { ProjectAvatar } from "../project-avatar.js";
import { toActionTarget } from "../thread-target.js";
import {
  buildWorkspaceSidebarModel,
  findWorkspaceKeyForThread,
  formatLineCount,
  resolveOpenThread,
  type Workspace,
} from "./model.js";
import {
  rememberActiveThread,
  setProjectExpanded,
  useLastActiveThreads,
  useProjectExpansion,
} from "./prefs.js";
import {
  useWorkspaceChanges,
  useWorkspacePullRequests,
  type WorkspaceChanges,
  type WorkspacePullRequest,
} from "./reads.js";

function SectionLabel({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-7 items-center gap-1 pl-2 pr-0.5",
        CHROME_SECTION_LABEL_CLASS,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </div>
  );
}

function IconButton({
  label,
  icon,
  onClick,
  className,
}: {
  label: string;
  icon: string;
  onClick(): void;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            SIDEBAR_CONTROL_BUTTON_CLASS,
            "inline-flex items-center justify-center",
            className,
          )}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
          }}
        >
          <Icon name={icon} className={COARSE_POINTER_ICON_SIZE_CLASS} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

const PULL_REQUEST_GLYPHS: Record<
  WorkspacePullRequest["state"],
  { icon: string; className: string; label: string }
> = {
  open: {
    icon: "GitPullRequest",
    className: "text-success-foreground",
    label: "Pull request open",
  },
  draft: {
    icon: "GitPullRequestDraft",
    className: "text-muted-foreground",
    label: "Draft pull request",
  },
  merged: {
    icon: "GitMerge",
    className: "text-pr-merged",
    label: "Pull request merged",
  },
  closed: {
    icon: "GitPullRequestClosed",
    className: "text-destructive",
    label: "Pull request closed",
  },
};

function WorkspaceGlyph({
  workspace,
  pullRequest,
}: {
  workspace: Workspace;
  pullRequest: WorkspacePullRequest | undefined;
}) {
  const draftIds = useSidebarThreadDraftIds();
  const rowStatuses = useSidebarThreadRowStatuses();
  const status = useMemo(() => {
    const others = workspace.threads.filter(
      (thread) => thread.id !== workspace.primary.id,
    );
    return resolveThreadStatus({
      thread: workspace.primary,
      hiddenThreads: others,
      hasUnsubmittedDraft: workspace.threads.some((thread) =>
        draftIds.has(thread.id),
      ),
      rowStatus:
        workspace.threads
          .map((thread) => rowStatuses.get(thread.id))
          .find((rowStatus) => rowStatus !== undefined) ?? null,
    });
  }, [draftIds, rowStatuses, workspace]);
  if (status.isWorking || status.indicator === "waiting-for-input") {
    return (
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        <ThreadStatusGlyph
          indicator={status.indicator}
          rowStatus={status.rowStatus}
          size="compact"
        />
      </span>
    );
  }
  if (pullRequest !== undefined) {
    const glyph =
      pullRequest.needsAttention && pullRequest.state === "open"
        ? {
            icon: "CircleX",
            className: "text-destructive",
            label: "Pull request needs attention",
          }
        : PULL_REQUEST_GLYPHS[pullRequest.state];
    return (
      <Icon
        name={glyph.icon}
        aria-label={`${glyph.label}: #${pullRequest.number}`}
        className={cn("size-3.5 shrink-0", glyph.className)}
      />
    );
  }
  return (
    <Icon
      name={workspace.environmentId === null ? "MessageSquare" : "GitBranch"}
      aria-hidden="true"
      className="size-3.5 shrink-0 text-subtle-foreground"
    />
  );
}

function ChangeCounts({ changes }: { changes: WorkspaceChanges | undefined }) {
  if (
    changes === undefined ||
    (changes.insertions === 0 && changes.deletions === 0)
  ) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums">
      {changes.insertions > 0 ? (
        <span className="text-success-foreground">
          +{formatLineCount(changes.insertions)}
        </span>
      ) : null}
      {changes.deletions > 0 ? (
        <span className="text-destructive">
          -{formatLineCount(changes.deletions)}
        </span>
      ) : null}
    </span>
  );
}

function WorkspaceRow({
  workspace,
  isActive,
  lastActiveThreadId,
  changes,
  pullRequest,
  onNavigate,
}: {
  workspace: Workspace;
  isActive: boolean;
  lastActiveThreadId: string | undefined;
  changes: WorkspaceChanges | undefined;
  pullRequest: WorkspacePullRequest | undefined;
  onNavigate(): void;
}) {
  const archiveEnvironmentThreads = useArchiveEnvironmentThreads();
  const [archiving, setArchiving] = useState(false);
  const target = resolveOpenThread(workspace, lastActiveThreadId);
  const chatCount = workspace.chats.length;
  return (
    <ThreadActionsContextMenu thread={toActionTarget(workspace.primary)}>
      <div
        data-conductor-workspace={workspace.key}
        data-active={isActive ? "true" : undefined}
        className={cn(
          SIDEBAR_ROW_BASE_CLASS,
          COARSE_POINTER_ROW_HEIGHT_CLASS,
          "group/workspace relative pl-2 pr-1",
          isActive
            ? SIDEBAR_ROW_SELECTED_STATE_CLASS
            : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
        )}
      >
        <a
          href={target.href}
          draggable={false}
          aria-label={workspace.primary.displayTitle}
          aria-current={isActive ? "page" : undefined}
          className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          onClick={onNavigate}
        />
        <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2">
          <WorkspaceGlyph workspace={workspace} pullRequest={pullRequest} />
          <span className="min-w-0 flex-1 truncate">
            <ThreadTitle threadId={workspace.primary.id} />
          </span>
        </span>
        <span
          className={cn(
            "relative flex shrink-0 items-center justify-end",
            workspace.environmentId !== null &&
              "group-hover/workspace:min-w-6 group-focus-within/workspace:min-w-6",
          )}
        >
          <span
            className={cn(
              "pointer-events-none flex items-center gap-2 pr-1",
              workspace.environmentId !== null &&
                "group-hover/workspace:invisible group-focus-within/workspace:invisible",
            )}
          >
            {chatCount > 1 ? (
              <span
                className="shrink-0 text-xs tabular-nums text-subtle-foreground"
                aria-label={`${chatCount} chats`}
              >
                {chatCount}
              </span>
            ) : null}
            <ChangeCounts changes={changes} />
          </span>
          {workspace.environmentId === null ? null : (
            <span className="absolute right-0 hidden items-center group-hover/workspace:flex group-focus-within/workspace:flex">
              <IconButton
                label={archiving ? "Archiving…" : "Archive workspace"}
                icon="Archive"
                onClick={() => {
                  const environmentId = workspace.environmentId;
                  if (environmentId === null || archiving) return;
                  setArchiving(true);
                  void archiveEnvironmentThreads(environmentId)
                    .catch(() => undefined)
                    .finally(() => setArchiving(false));
                }}
              />
            </span>
          )}
        </span>
      </div>
    </ThreadActionsContextMenu>
  );
}

function ProjectBlock({
  project,
  workspaces,
  expanded,
  activeWorkspaceKey,
  lastActive,
  changes,
  pullRequests,
  onNavigate,
}: {
  project: PluginSidebarProject;
  workspaces: readonly Workspace[];
  expanded: boolean;
  activeWorkspaceKey: string | null;
  lastActive: Readonly<Record<string, string>>;
  changes: ReadonlyMap<string, WorkspaceChanges>;
  pullRequests: ReadonlyMap<string, WorkspacePullRequest>;
  onNavigate(): void;
}) {
  const navigate = useBbNavigate();
  const name = project.isPersonal ? "Personal" : project.name;
  return (
    <div data-conductor-project={project.id} className="flex flex-col gap-px">
      <div
        className={cn(
          SIDEBAR_ROW_BASE_CLASS,
          COARSE_POINTER_ROW_HEIGHT_CLASS,
          "group/project relative pl-2 pr-1",
        )}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
          className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          onClick={() => setProjectExpanded(project.id, !expanded)}
        />
        <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2">
          <ProjectAvatar name={name} />
          <span className="min-w-0 truncate font-medium">{name}</span>
          {!expanded && workspaces.length > 0 ? (
            <span
              className={cn(
                "shrink-0 text-xs tabular-nums",
                SIDEBAR_GROUP_TEXT_CLASS,
              )}
            >
              {workspaces.length}
            </span>
          ) : null}
        </span>
        <span className="relative flex shrink-0 items-center opacity-0 transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100 [@media(hover:none)]:opacity-100">
          <IconButton
            label={`New workspace in ${name}`}
            icon="Plus"
            onClick={() => {
              setProjectExpanded(project.id, true);
              navigate.toCompose({ projectId: project.id, focusPrompt: true });
              onNavigate();
            }}
          />
        </span>
      </div>
      {expanded
        ? workspaces.map((workspace) => (
            <div key={workspace.key} className="pl-3">
              <WorkspaceRow
                workspace={workspace}
                isActive={workspace.key === activeWorkspaceKey}
                lastActiveThreadId={lastActive[workspace.key]}
                changes={
                  workspace.environmentId === null
                    ? undefined
                    : changes.get(workspace.environmentId)
                }
                pullRequest={
                  workspace.environmentId === null
                    ? undefined
                    : pullRequests.get(workspace.environmentId)
                }
                onNavigate={onNavigate}
              />
            </div>
          ))
        : null}
    </div>
  );
}

export function WorkspaceSidebar({
  activeThreadId,
  activeProjectId,
  onNavigate,
}: PluginThreadListProps) {
  const state = useSidebarThreads();
  const model = useMemo(
    () => buildWorkspaceSidebarModel(state.threads, state.projects),
    [state.threads, state.projects],
  );
  const newChatEnvironmentId = useNewChatEnvironment();
  const activeWorkspaceKey =
    activeThreadId === null && newChatEnvironmentId !== null
      ? `env:${newChatEnvironmentId}`
      : findWorkspaceKeyForThread(model, activeThreadId);
  const lastActive = useLastActiveThreads();
  const expansion = useProjectExpansion();

  useEffect(() => {
    if (activeWorkspaceKey !== null && activeThreadId !== null) {
      rememberActiveThread(activeWorkspaceKey, activeThreadId);
    }
  }, [activeThreadId, activeWorkspaceKey]);

  const environmentIds = useMemo(
    () =>
      [...model.pinned, ...model.projects.flatMap((group) => group.workspaces)]
        .map((workspace) => workspace.environmentId)
        .filter((id): id is string => id !== null),
    [model],
  );
  const changes = useWorkspaceChanges(environmentIds);
  const pullRequests = useWorkspacePullRequests(environmentIds);

  const activeProjectFromThread = model.projects.find((group) =>
    group.workspaces.some((workspace) => workspace.key === activeWorkspaceKey),
  )?.project.id;

  function isExpanded(projectId: string): boolean {
    const stored = expansion[projectId];
    if (stored !== undefined) return stored === "open";
    return (
      projectId === activeProjectFromThread || projectId === activeProjectId
    );
  }

  if (state.status === "loading" && state.threads.length === 0) {
    return (
      <div className="flex flex-col gap-1 px-2 py-2" aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-7 animate-pulse rounded-md bg-foreground/5"
          />
        ))}
      </div>
    );
  }

  return (
    <nav
      aria-label="Workspaces"
      data-conductor-sidebar=""
      className="flex flex-col gap-3 px-2 pb-4 pt-1 text-sm"
    >
      {model.pinned.length > 0 ? (
        <section className="flex flex-col gap-px">
          <SectionLabel label="Pinned" />
          {model.pinned.map((workspace) => (
            <WorkspaceRow
              key={workspace.key}
              workspace={workspace}
              isActive={workspace.key === activeWorkspaceKey}
              lastActiveThreadId={lastActive[workspace.key]}
              changes={
                workspace.environmentId === null
                  ? undefined
                  : changes.get(workspace.environmentId)
              }
              pullRequest={
                workspace.environmentId === null
                  ? undefined
                  : pullRequests.get(workspace.environmentId)
              }
              onNavigate={onNavigate}
            />
          ))}
        </section>
      ) : null}
      <section className="flex flex-col gap-0.5">
        <SectionLabel label="Projects" />
        {model.projects.map((group) => (
          <ProjectBlock
            key={group.project.id}
            project={group.project}
            workspaces={group.workspaces}
            expanded={isExpanded(group.project.id)}
            activeWorkspaceKey={activeWorkspaceKey}
            lastActive={lastActive}
            changes={changes}
            pullRequests={pullRequests}
            onNavigate={onNavigate}
          />
        ))}
      </section>
    </nav>
  );
}
