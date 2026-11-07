import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { PluginThreadActionRegistration } from "@get-bb/plugin-sdk";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import {
  getCoreIcons,
  setCoreIcons,
  type AppIconDefinition,
} from "@bb/shared-ui/icon-registry";
import { WorkspaceOpenTargetIcon } from "@/components/workspace-open-target/WorkspaceOpenTargetIcon";

export interface ThreadWorkspaceOpen {
  preferredTarget: WorkspaceOpenTarget;
  targets: readonly WorkspaceOpenTarget[];
  openPreferred(): Promise<void>;
  openTarget(targetId: WorkspaceOpenTargetId): Promise<void>;
}

type ThreadWorkspaceOpens = ReadonlyMap<string, ThreadWorkspaceOpen>;

let opens: ThreadWorkspaceOpens = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getOpens(): ThreadWorkspaceOpens {
  return opens;
}

function setOpens(next: ThreadWorkspaceOpens): void {
  opens = next;
  for (const listener of listeners) listener();
}

function targetIconName(target: WorkspaceOpenTarget): string {
  return `bb-workspace-open-target:${target.id}`;
}

function registerTargetIcons(targets: readonly WorkspaceOpenTarget[]): void {
  const icons = new Map(getCoreIcons());
  let changed = false;
  for (const target of targets) {
    const name = targetIconName(target);
    const key = `${name}:${JSON.stringify(target.icon)}`;
    if (icons.get(name)?.key === key) continue;
    const definition: AppIconDefinition = {
      key,
      component: ({ className }) => (
        <WorkspaceOpenTargetIcon target={target} className={className} />
      ),
    };
    icons.set(name, definition);
    changed = true;
  }
  if (changed) setCoreIcons(icons);
}

function publish(threadId: string, open: ThreadWorkspaceOpen): () => void {
  registerTargetIcons(open.targets);
  setOpens(new Map(opens).set(threadId, open));
  return () => {
    if (opens.get(threadId) !== open) return;
    const next = new Map(opens);
    next.delete(threadId);
    setOpens(next);
  };
}

export function usePublishThreadWorkspaceOpen(
  threadId: string,
  open: ThreadWorkspaceOpen | null,
): void {
  const latest = useRef(open);
  useLayoutEffect(() => {
    latest.current = open;
  });
  const targetsKey =
    open === null ? null : JSON.stringify([open.preferredTarget, open.targets]);
  useLayoutEffect(() => {
    const current = latest.current;
    if (targetsKey === null || current === null) return undefined;
    return publish(threadId, {
      preferredTarget: current.preferredTarget,
      targets: current.targets,
      openPreferred: () => latest.current?.openPreferred() ?? Promise.resolve(),
      openTarget: (targetId) =>
        latest.current?.openTarget(targetId) ?? Promise.resolve(),
    });
  }, [targetsKey, threadId]);
}

export function resetThreadWorkspaceOpensForTest(): void {
  setOpens(new Map());
}

function useThreadWorkspaceOpens(): ThreadWorkspaceOpens {
  return useSyncExternalStore(subscribe, getOpens);
}

export const WORKSPACE_OPEN_THREAD_ACTION_GROUP = "0_workspace";

export const workspaceOpenThreadAction: PluginThreadActionRegistration<ThreadWorkspaceOpens> =
  {
    id: "openWorkspace",
    title: "Open workspace",
    icon: "FolderOpen",
    group: WORKSPACE_OPEN_THREAD_ACTION_GROUP,
    placement: "header",
    useData: useThreadWorkspaceOpens,
    item: ({ thread, data }) => {
      const open = data.get(thread.id);
      if (open === undefined) return null;
      return {
        label: `Open workspace in ${open.preferredTarget.label}`,
        icon: targetIconName(open.preferredTarget),
        display: "icon",
        choices: {
          split: true,
          heading: "Open Workspace",
          items: open.targets.map((target) => ({
            id: target.id,
            label: target.label,
            icon: targetIconName(target),
          })),
        },
        run: ({ value }) => {
          if (value === undefined) return open.openPreferred();
          const target = open.targets.find(
            (candidate) => candidate.id === value,
          );
          return target === undefined ? undefined : open.openTarget(target.id);
        },
      };
    },
  };
