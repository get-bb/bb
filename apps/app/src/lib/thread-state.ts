import type { ThreadWithRuntime } from "@bb/domain";
import type {
  ExperimentalThread,
  ExperimentalThreadState,
} from "@get-bb/plugin-sdk";
import { useThread } from "@/hooks/queries/thread-queries";
import { BbHttpError } from "@/lib/sdk";
import { useSidebarThreadEntry } from "./sidebar-thread-entries";

const LOADING: ExperimentalThreadState = { status: "loading", thread: null };
const NOT_FOUND: ExperimentalThreadState = { status: "notFound", thread: null };
const ERROR: ExperimentalThreadState = { status: "error", thread: null };

const readyBySource = new WeakMap<ThreadWithRuntime, ExperimentalThreadState>();

function readyState(source: ThreadWithRuntime): ExperimentalThreadState {
  const cached = readyBySource.get(source);
  if (cached !== undefined) return cached;
  const thread: ExperimentalThread = {
    id: source.id,
    projectId: source.projectId,
    environmentId: source.environmentId,
    providerId: source.providerId,
    title: source.title,
    titleFallback: source.titleFallback,
    sectionId: source.sectionId,
    status: source.status,
    parentThreadId: source.parentThreadId,
    lifecycleOwnerThreadId: source.lifecycleOwnerThreadId,
    sourceThreadId: source.sourceThreadId,
    originKind: source.originKind,
    originPluginId: source.originPluginId,
    visibility: source.visibility,
    parentNotifications: source.parentNotifications,
    archivedAt: source.archivedAt,
    pinnedAt: source.pinnedAt,
    deletedAt: source.deletedAt,
    lastReadAt: source.lastReadAt,
    latestAttentionAt: source.latestAttentionAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    runtime: source.runtime,
  };
  const state: ExperimentalThreadState = { status: "ready", thread };
  readyBySource.set(source, state);
  return state;
}

export function useThreadState(threadId: string): ExperimentalThreadState {
  const held = useSidebarThreadEntry(threadId);
  const query = useThread(held === null ? threadId : "");
  if (threadId === "") return NOT_FOUND;
  if (held !== null) return readyState(held);
  if (query.data !== undefined) return readyState(query.data);
  if (query.error === null) return LOADING;
  return query.error instanceof BbHttpError && query.error.status === 404
    ? NOT_FOUND
    : ERROR;
}
