import { useMemo } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  ThreadTitle,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { ProjectAvatar } from "../project-avatar.js";
import { findWorkspace, projectDisplayName } from "../workspace.js";

export interface WorkspaceBreadcrumbProps {
  projectId: string;
  environmentId: string | null;
  threadId: string | null;
}

export function WorkspaceBreadcrumb({
  projectId,
  environmentId,
  threadId,
}: WorkspaceBreadcrumbProps) {
  const { threads, projects } = useSidebarThreads();
  const workspace = useMemo(
    () =>
      environmentId === null
        ? null
        : findWorkspace(threads, projects, environmentId, threadId),
    [environmentId, projects, threadId, threads],
  );
  const project = projects.find((entry) => entry.id === projectId);
  const projectName =
    workspace?.projectName ??
    (project === undefined ? null : projectDisplayName(project));

  return (
    <span
      data-conductor-breadcrumb=""
      className="flex min-w-0 items-center gap-1.5 text-sm"
    >
      {projectName === null ? null : (
        <>
          <ProjectAvatar name={projectName} />
          <span className="shrink-0 truncate text-muted-foreground">
            {projectName}
          </span>
          <Icon
            name="ChevronRight"
            aria-hidden="true"
            className="size-3.5 shrink-0 text-subtle-foreground"
          />
        </>
      )}
      <span
        className="min-w-0 truncate text-foreground"
        title={workspace?.branchName ?? undefined}
      >
        {workspace !== null ? (
          workspace.label
        ) : threadId === null ? null : (
          <ThreadTitle threadId={threadId} />
        )}
      </span>
    </span>
  );
}
