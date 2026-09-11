import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";

export interface WorkspaceFixture {
  id: string;
  name: string;
  agentThreadId: string;
  context: string;
}

const definitions: Array<[string, string, string | null]> = [
  ["launch", "Launch Atlas checkout", null],
  ["requirements", "Define requirements", "launch"],
  ["interviews", "Customer interviews", "requirements"],
  ["scope", "Scope and success criteria", "requirements"],
  ["build", "Build checkout", "launch"],
  ["payments", "Payments integration", "build"],
  ["retry", "Retry failed payments", "payments"],
  ["receipts", "Receipt UI", "build"],
  ["prepare", "Prepare launch", "launch"],
  ["notes", "Release notes", "prepare"],
  ["help", "Help centre article", "prepare"],
  ["mobile", "Coordinate mobile refresh", null],
  ["navigation", "Refresh mobile navigation", "mobile"],
  ["investigation", "Investigate flaky build", null],
  ["reproduce", "Reproduce on Linux", "investigation"],
];

export const workspaceThreads = definitions.map(([id, title, parent]) =>
  makeThreadListEntry({
    id: `thr_workspace_${id}`,
    title,
    titleFallback: title,
    projectId: "proj_workspace_story",
    parentThreadId: parent ? `thr_workspace_${parent}` : null,
    lastReadAt: 300,
    latestAttentionAt: 200,
    ...(id === "retry"
      ? {
          status: "active",
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
        }
      : {}),
    ...(id === "receipts" ? { hasPendingInteraction: true } : {}),
  }),
);

export const workspaces: WorkspaceFixture[] = [
  {
    id: "workspace_atlas",
    name: "Atlas checkout launch",
    agentThreadId: "thr_workspace_launch",
    context:
      "Ship Atlas checkout. Keep requirements, implementation decisions, and launch preparation together.",
  },
  {
    id: "workspace_mobile",
    name: "Mobile refresh",
    agentThreadId: "thr_workspace_mobile",
    context: "Improve navigation and readability on compact screens.",
  },
];

export function threadAncestors(threads: ThreadListEntry[], id: string) {
  const ancestors: string[] = [];
  let current = threads.find((thread) => thread.id === id);
  while (current && !ancestors.includes(current.id)) {
    ancestors.push(current.id);
    current = threads.find((thread) => thread.id === current?.parentThreadId);
  }
  return ancestors;
}

export function branchThreads(threads: ThreadListEntry[], id: string) {
  return threads.filter((thread) =>
    threadAncestors(threads, thread.id).includes(id),
  );
}

export function canMoveThread(
  threads: ThreadListEntry[],
  id: string,
  parentId: string | null,
) {
  if (parentId && threadAncestors(threads, parentId).includes(id)) return false;
  const next = threads.map((thread) =>
    thread.id === id ? { ...thread, parentThreadId: parentId } : thread,
  );
  return branchThreads(next, id).every(
    (thread) => threadAncestors(next, thread.id).length <= 4,
  );
}

export function handOverWorkspace(
  threads: ThreadListEntry[],
  currentId: string,
  nextId: string,
) {
  if (currentId === nextId) return threads;
  return threads.map((thread) => {
    if (thread.id === nextId) return { ...thread, parentThreadId: null };
    if (thread.id === currentId || thread.parentThreadId === currentId) {
      return { ...thread, parentThreadId: nextId };
    }
    return thread;
  });
}
