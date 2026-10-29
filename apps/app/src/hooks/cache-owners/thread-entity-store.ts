import {
  notifyManager,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  KeyedCollection,
  beginOptimisticMutation,
  confirmKeyedEntity,
  insertKeyedEntry,
  keyedEntities,
  optimisticKeyedUpdate,
  readKeyedEntity,
  registerKeyedViews,
  writeKeyedEntity,
  type KeyedView,
  type KeyedViewSlot,
  type TaggedOptimisticUpdate,
} from "@bb/query-tags";
import {
  threadWithRuntimeSchema,
  type ThreadListEntry,
  type ThreadWithRuntime,
} from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";
import {
  ARCHIVED_THREADS_LIST_KIND,
  allThreadDetailBootstrapQueryKeyPrefix,
  allThreadQueryKeyPrefix,
  sidebarNavigationQueryKey,
  threadSearchQueryKeyPrefix,
  threadsQueryKey,
} from "../queries/query-keys";

type Fields = Record<string, unknown>;
type ListFacetKey = Exclude<keyof ThreadListEntry, keyof ThreadWithRuntime>;
type DetailFacetKey = Exclude<keyof ThreadResponse, keyof ThreadWithRuntime>;
type Facet = "list" | "detail";

export interface ThreadEntity {
  thread: Partial<ThreadWithRuntime>;
  list: Partial<Pick<ThreadListEntry, ListFacetKey>> | null;
  detail: Partial<Pick<ThreadResponse, DetailFacetKey>> | null;
}

const LIST_FACET: Record<ListFacetKey, true> = {
  activity: true,
  queuedWork: true,
  pinSortKey: true,
  hasPendingInteraction: true,
  environmentHostId: true,
  environmentName: true,
  environmentBranchName: true,
  environmentPath: true,
  environmentProviderId: true,
  environmentIsWorktree: true,
  environmentWorkspaceDisplayKind: true,
};
const DETAIL_FACET: Record<DetailFacetKey, true> = {
  activeBackgroundAgentCount: true,
  canRestoreEnvironment: true,
  canEditMessages: true,
  canSpawnChild: true,
  queuedMessageCount: true,
};
const THREAD_KEYS = new Set(Object.keys(threadWithRuntimeSchema.shape));
const FACET_KEYS: Record<Facet, ReadonlySet<string>> = {
  list: new Set(Object.keys(LIST_FACET)),
  detail: new Set(Object.keys(DETAIL_FACET)),
};

type Membership = "active" | "archived" | "any";

interface ViewFamily {
  facet: Facet;
  membership(queryKey: QueryKey): Membership;
  slots(data: unknown): KeyedViewSlot[] | undefined;
  rebuild(
    data: unknown,
    items: ReadonlyMap<string, readonly unknown[]>,
  ): unknown;
  threadOf(item: unknown): Fields | undefined;
  withThread(item: unknown, thread: Fields): unknown;
}

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function threadRow(item: unknown): Fields | undefined {
  return isRecord(item) && typeof item.id === "string" ? item : undefined;
}

const ROW_ITEMS = {
  threadOf: threadRow,
  withThread: (_item: unknown, thread: Fields) => thread,
};

const SIDEBAR: ViewFamily = {
  facet: "list",
  membership: () => "active",
  slots(data) {
    if (!isRecord(data) || !isRecord(data.personalProject)) return undefined;
    const projects = Array.isArray(data.projects) ? data.projects : [];
    return [
      { key: "personal", items: projectThreads(data.personalProject) },
      ...projects.map((project, index) => ({
        key: projectSlot(project, index),
        items: projectThreads(project),
      })),
    ];
  },
  rebuild(data, items) {
    if (!isRecord(data) || !isRecord(data.personalProject)) return data;
    const personal = items.get("personal");
    const projects = Array.isArray(data.projects) ? data.projects : [];
    return {
      ...data,
      personalProject:
        personal === undefined
          ? data.personalProject
          : { ...data.personalProject, threads: personal },
      projects: projects.map((project: unknown, index) => {
        const threads = items.get(projectSlot(project, index));
        return isRecord(project) && threads !== undefined
          ? { ...project, threads }
          : project;
      }),
    };
  },
  ...ROW_ITEMS,
};

function projectSlot(project: unknown, index: number): string {
  return isRecord(project) && typeof project.id === "string"
    ? `project:${project.id}`
    : `project-index:${index}`;
}

function projectThreads(project: unknown): readonly unknown[] {
  return isRecord(project) && Array.isArray(project.threads)
    ? project.threads
    : [];
}

const THREAD_LISTS: ViewFamily = {
  facet: "list",
  membership(queryKey) {
    const scope = queryKey[1];
    if (scope === ARCHIVED_THREADS_LIST_KIND) return "archived";
    if (isRecord(scope) && typeof scope.archived === "boolean")
      return scope.archived ? "archived" : "active";
    return "any";
  },
  slots(data) {
    if (Array.isArray(data)) return [{ key: "rows", items: data }];
    if (isRecord(data) && Array.isArray(data.pages))
      return data.pages.map((page: unknown, index) => ({
        key: `page:${index}`,
        items: Array.isArray(page) ? page : [],
      }));
    if (isRecord(data) && Array.isArray(data.threads))
      return [{ key: "threads", items: data.threads }];
    return undefined;
  },
  rebuild(data, items) {
    if (Array.isArray(data)) return items.get("rows") ?? data;
    if (isRecord(data) && Array.isArray(data.pages))
      return {
        ...data,
        pages: data.pages.map(
          (page: unknown, index) => items.get(`page:${index}`) ?? page,
        ),
      };
    const threads = items.get("threads");
    if (isRecord(data) && threads !== undefined) return { ...data, threads };
    return data;
  },
  ...ROW_ITEMS,
};

const SEARCH: ViewFamily = {
  facet: "list",
  membership: () => "any",
  slots(data) {
    if (!isRecord(data)) return undefined;
    return ["active", "archived"].map((key) => {
      const group = data[key];
      return {
        key,
        items:
          isRecord(group) && Array.isArray(group.results) ? group.results : [],
      };
    });
  },
  rebuild(data, items) {
    if (!isRecord(data)) return data;
    const next: Fields = { ...data };
    for (const key of ["active", "archived"]) {
      const group = data[key];
      const results = items.get(key);
      if (isRecord(group) && results !== undefined)
        next[key] = { ...group, results };
    }
    return next;
  },
  threadOf: (item) => (isRecord(item) ? threadRow(item.thread) : undefined),
  withThread: (item, thread) => (isRecord(item) ? { ...item, thread } : item),
};

const DETAIL: ViewFamily = {
  facet: "detail",
  membership: () => "any",
  slots: (data) =>
    threadRow(data) === undefined
      ? undefined
      : [{ key: "detail", items: [data] }],
  rebuild: (data, items) => items.get("detail")?.[0] ?? data,
  ...ROW_ITEMS,
};

function familyOf(queryKey: QueryKey): ViewFamily | undefined {
  const [head] = queryKey;
  if (head === sidebarNavigationQueryKey()[0])
    return queryKey.length === 1 ? SIDEBAR : undefined;
  if (head === threadsQueryKey()[0])
    return queryKey.length > 1 ? THREAD_LISTS : undefined;
  if (head === threadSearchQueryKeyPrefix()[0]) return SEARCH;
  if (
    head === allThreadQueryKeyPrefix()[0] ||
    head === allThreadDetailBootstrapQueryKeyPrefix()[0]
  )
    return queryKey.length === 2 ? DETAIL : undefined;
  return undefined;
}

function pick(source: Fields, keys: ReadonlySet<string>): Fields {
  const picked: Fields = {};
  for (const key of Object.keys(source))
    if (keys.has(key)) picked[key] = source[key];
  return picked;
}

function withFields<T extends object>(
  current: T | null,
  fields: Fields,
): T | null {
  const keys = Object.keys(fields);
  if (keys.length === 0) return current;
  const base: Fields = current === null ? {} : { ...current };
  if (
    current !== null &&
    keys.every((key) => Object.is(Reflect.get(current, key), fields[key]))
  )
    return current;
  for (const key of keys) base[key] = fields[key];
  return base as T;
}

function mergeEntity(
  current: ThreadEntity,
  threadFields: Fields,
  facet: Facet,
  facetFields: Fields,
): ThreadEntity {
  const thread = withFields(current.thread, threadFields) ?? current.thread;
  const facetValue = withFields(current[facet], facetFields);
  if (thread === current.thread && facetValue === current[facet])
    return current;
  return { ...current, thread, [facet]: facetValue };
}

function isMember(entity: ThreadEntity, membership: Membership): boolean {
  if (entity.thread.deletedAt != null) return false;
  if (membership === "any" || !("archivedAt" in entity.thread)) return true;
  const archived = entity.thread.archivedAt != null;
  return membership === "archived" ? archived : !archived;
}

function isNewer(incoming: unknown, current: unknown, fresh: boolean): boolean {
  if (typeof incoming !== "number" || typeof current !== "number") return true;
  if (incoming !== current) return incoming > current;
  return fresh;
}

export const THREAD_ENTITIES = new KeyedCollection<ThreadEntity>("threads");

function threadView(family: ViewFamily): KeyedView<ThreadEntity> {
  const { facet } = family;
  return {
    collection: THREAD_ENTITIES,
    slots: (data) => family.slots(data),
    rebuild: (data, items) => family.rebuild(data, items),
    keyOf(item) {
      const thread = family.threadOf(item);
      return thread === undefined ? undefined : String(thread.id);
    },
    read(item, current, fresh) {
      const source = family.threadOf(item) ?? {};
      const threadFields = pick(source, THREAD_KEYS);
      const facetFields = pick(source, FACET_KEYS[facet]);
      if (current === undefined)
        return {
          thread: threadFields,
          list: facet === "list" ? facetFields : null,
          detail: facet === "detail" ? facetFields : null,
        };
      if (isNewer(threadFields.updatedAt, current.thread.updatedAt, fresh))
        return mergeEntity(current, threadFields, facet, facetFields);
      return current[facet] === null
        ? mergeEntity(current, {}, facet, facetFields)
        : current;
    },
    write(item, prior, current) {
      const next = family.threadOf(item) ?? {};
      const previous = family.threadOf(prior) ?? {};
      const changed: Fields = {};
      for (const key of Object.keys(next))
        if (!Object.is(next[key], previous[key])) changed[key] = next[key];
      return mergeEntity(
        current,
        pick(changed, THREAD_KEYS),
        facet,
        pick(changed, FACET_KEYS[facet]),
      );
    },
    render(item, entity) {
      const source = family.threadOf(item);
      if (source === undefined || !isRecord(item)) return item;
      return family.withThread(item, {
        ...source,
        ...entity.thread,
        ...entity[facet],
      });
    },
    shows: (entity, queryKey) => isMember(entity, family.membership(queryKey)),
  };
}

const VIEWS = new Map(
  [SIDEBAR, THREAD_LISTS, SEARCH, DETAIL].map((family) => [
    family,
    threadView(family),
  ]),
);

function threadViewOf(queryKey: QueryKey): KeyedView<ThreadEntity> | undefined {
  const family = familyOf(queryKey);
  return family === undefined ? undefined : VIEWS.get(family);
}

export function registerThreadEntityViews(client: QueryClient): void {
  registerKeyedViews(client, threadViewOf);
}

export function patchThreadEntity(
  client: QueryClient,
  threadId: string,
  change: Fields,
  updatedAt?: number,
): void {
  registerThreadEntityViews(client);
  const threadFields = pick(change, THREAD_KEYS);
  const listFields = pick(change, FACET_KEYS.list);
  writeKeyedEntity(client, THREAD_ENTITIES, threadId, (current) =>
    current === undefined ||
    (updatedAt !== undefined &&
      (current.thread.updatedAt ?? Number.NEGATIVE_INFINITY) > updatedAt)
      ? current
      : mergeEntity(current, threadFields, "list", listFields),
  );
}

function confirmThreadRow(
  client: QueryClient,
  row: ThreadWithRuntime,
): boolean {
  return confirmKeyedEntity(client, THREAD_ENTITIES, row.id, (entity) =>
    !isNewer(row.updatedAt, entity.thread.updatedAt, true)
      ? undefined
      : mergeEntity(
          entity,
          pick(row, THREAD_KEYS),
          "detail",
          entity.detail === null ? {} : pick(row, FACET_KEYS.detail),
        ),
  );
}

export function getThreadEntity(
  client: QueryClient,
  threadId: string,
): ThreadEntity | undefined {
  registerThreadEntityViews(client);
  return readKeyedEntity(client, THREAD_ENTITIES, threadId);
}

function threadEntities(client: QueryClient): ThreadEntity[] {
  registerThreadEntityViews(client);
  return keyedEntities(client, THREAD_ENTITIES);
}

export function findThreadEntityIds(
  client: QueryClient,
  matches: (thread: Partial<ThreadWithRuntime>) => boolean,
): string[] {
  return threadEntities(client).flatMap(({ thread }) =>
    thread.id !== undefined && matches(thread) ? [thread.id] : [],
  );
}

export function findThreadTreeIds(
  client: QueryClient,
  matchesRoot: (thread: Partial<ThreadWithRuntime>) => boolean,
): string[] {
  const threads = threadEntities(client).map(({ thread }) => thread);
  const childrenByParent = new Map<string, string[]>();
  const threadIds = new Set<string>();
  for (const thread of threads) {
    if (thread.id === undefined) continue;
    if (matchesRoot(thread)) threadIds.add(thread.id);
    if (thread.parentThreadId != null) {
      const children = childrenByParent.get(thread.parentThreadId) ?? [];
      children.push(thread.id);
      childrenByParent.set(thread.parentThreadId, children);
    }
  }
  for (const threadId of threadIds)
    for (const childId of childrenByParent.get(threadId) ?? [])
      threadIds.add(childId);
  return [...threadIds];
}

export function insertThreadIntoSidebar(
  client: QueryClient,
  threadId: string,
): void {
  registerThreadEntityViews(client);
  insertKeyedEntry(
    client,
    sidebarNavigationQueryKey(),
    THREAD_ENTITIES,
    threadId,
    (data, entity) => {
      if (entity.list === null || !isRecord(data)) return undefined;
      const personal = data.personalProject;
      return {
        slot:
          isRecord(personal) && personal.id === entity.thread.projectId
            ? "personal"
            : `project:${String(entity.thread.projectId)}`,
        item: { ...entity.thread, ...entity.list },
      };
    },
  );
}

export interface ThreadEntityPrediction<Result = unknown> {
  threadIds: readonly string[];
  succeed(result?: Result): void;
  confirm(
    rows: readonly ThreadWithRuntime[],
    readBack: (threadId: string) => Promise<unknown>,
  ): void;
  fail(): void;
}

export function beginThreadEntityPrediction<Result = unknown>(
  client: QueryClient,
  {
    threadIds,
    update,
    extra = [],
  }: {
    threadIds: readonly string[];
    update: (
      entity: ThreadEntity,
      threadId: string,
      result: { value: Result } | undefined,
    ) => ThreadEntity;
    extra?: readonly TaggedOptimisticUpdate[];
  },
): ThreadEntityPrediction<Result> {
  registerThreadEntityViews(client);
  const prediction = beginOptimisticMutation(client, [
    ...threadIds.map((threadId) =>
      optimisticKeyedUpdate<ThreadEntity, Result>(
        THREAD_ENTITIES,
        threadId,
        (entity, result) => update(entity, threadId, result),
      ),
    ),
    ...extra,
  ]);
  return {
    threadIds,
    succeed(result) {
      prediction.accept(result);
      prediction.settle();
    },
    confirm(rows, readBack) {
      notifyManager.batch(() => {
        prediction.accept();
        prediction.settle();
        const confirmed = new Set(
          rows
            .filter((row) => confirmThreadRow(client, row))
            .map((row) => row.id),
        );
        for (const threadId of threadIds)
          if (!confirmed.has(threadId)) void readBack(threadId);
      });
    },
    fail: prediction.rollback,
  };
}
