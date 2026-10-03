import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Policy } from "./contract.js";

type Thread = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["list"]>
>[number];
export type RetentionThread = Pick<
  Thread,
  | "id"
  | "parentThreadId"
  | "sourceThreadId"
  | "lifecycleOwnerThreadId"
  | "visibility"
  | "archivedAt"
  | "deletedAt"
  | "pinnedAt"
  | "updatedAt"
  | "status"
  | "environmentId"
>;
interface Candidate {
  rootId: string;
  memberIds: string[];
  oldestAt: number;
}

export function selectCandidates(
  threads: readonly RetentionThread[],
  policy: Policy,
  now: number,
) {
  const live = threads.filter((thread) => thread.deletedAt === null);
  const byId = new Map(live.map((thread) => [thread.id, thread]));
  const archiveEdges = new Map<string, RetentionThread[]>();
  const deleteEdges = new Map<string, RetentionThread[]>();
  function link(
    map: Map<string, RetentionThread[]>,
    id: string | null,
    thread: RetentionThread,
  ) {
    if (id === null) return;
    const children = map.get(id) ?? [];
    children.push(thread);
    map.set(id, children);
  }
  for (const thread of live) {
    link(deleteEdges, thread.lifecycleOwnerThreadId, thread);
    link(archiveEdges, thread.lifecycleOwnerThreadId, thread);
    link(archiveEdges, thread.parentThreadId, thread);
    if (thread.visibility === "hidden")
      link(archiveEdges, thread.sourceThreadId, thread);
  }
  function members(
    root: RetentionThread,
    edges: Map<string, RetentionThread[]>,
  ) {
    const result: RetentionThread[] = [];
    const seen = new Set<string>();
    const pending = [root];
    while (pending.length) {
      const thread = pending.pop()!;
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);
      result.push(thread);
      pending.push(...(edges.get(thread.id) ?? []));
    }
    return result;
  }
  const archive: Candidate[] = [];
  const deletion: Candidate[] = [];
  const active = (id: string | null) =>
    id !== null && byId.has(id) && byId.get(id)!.archivedAt === null;
  for (const root of live) {
    if (root.lifecycleOwnerThreadId !== null) continue;
    if (
      policy.archiveAfterDays !== null &&
      root.archivedAt === null &&
      !active(root.parentThreadId) &&
      !(root.visibility === "hidden" && active(root.sourceThreadId))
    ) {
      const group = members(root, archiveEdges).filter(
        (thread) => thread.archivedAt === null,
      );
      const cutoff = now - policy.archiveAfterDays * 86400000;
      if (
        group.every(
          (thread) =>
            thread.updatedAt < cutoff &&
            thread.pinnedAt === null &&
            !(
              thread.environmentId === null &&
              (thread.status === "starting" || thread.status === "stopping")
            ),
        )
      ) {
        archive.push({
          rootId: root.id,
          memberIds: group.map((thread) => thread.id),
          oldestAt: group.reduce(
            (latest, thread) => Math.max(latest, thread.updatedAt),
            0,
          ),
        });
      }
    }
    if (policy.deleteAfterDays !== null && root.archivedAt !== null) {
      const group = members(root, deleteEdges);
      const cutoff = now - policy.deleteAfterDays * 86400000;
      if (
        group.every(
          (thread) =>
            thread.archivedAt !== null &&
            thread.archivedAt < cutoff &&
            thread.pinnedAt === null,
        )
      ) {
        deletion.push({
          rootId: root.id,
          memberIds: group.map((thread) => thread.id),
          oldestAt: group.reduce(
            (latest, thread) => Math.max(latest, thread.archivedAt ?? 0),
            0,
          ),
        });
      }
    }
  }
  const sort = (a: Candidate, b: Candidate) =>
    a.oldestAt - b.oldestAt || a.rootId.localeCompare(b.rootId);
  return { archive: archive.sort(sort), delete: deletion.sort(sort) };
}
