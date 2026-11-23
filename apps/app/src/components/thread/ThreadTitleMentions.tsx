import {
  createContext,
  use,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type Dispatch,
  type ReactNode,
  type Ref,
  type SetStateAction,
} from "react";
import {
  isRawThreadId,
  PERSONAL_PROJECT_ID,
  RAW_THREAD_ID_PATTERN_SOURCE,
  type PromptMentionResource,
  type PromptTextMention,
  type ThreadListEntry,
} from "@bb/domain";
import {
  hashKey,
  QueryClientContext,
  type QueryClient,
} from "@tanstack/react-query";
import {
  THREAD_MENTION_RESOLVE_MAX_IDS,
  type ThreadResponse,
} from "@bb/server-contract";
import { PromptMentionPill } from "@/components/thread/timeline/ConversationMessageMentions";
import { useThread } from "@/hooks/queries/thread-queries";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { getThreadLocationPath, pathMentionResource } from "@bb/client-core";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { cn } from "@bb/shared-ui/lib/utils";

type ThreadTitleMentionThread = Pick<
  ThreadListEntry,
  "id" | "projectId" | "title" | "titleFallback"
>;

export interface ThreadTitleMentionResources {
  sectionNamesById: ReadonlyMap<string, string>;
  projectNamesById: ReadonlyMap<string, string>;
  threadById: ReadonlyMap<string, ThreadTitleMentionThread>;
}

export const EMPTY_TITLE_MENTION_RESOURCES: ThreadTitleMentionResources = {
  sectionNamesById: new Map(),
  projectNamesById: new Map(),
  threadById: new Map(),
};

const ThreadTitleMentionResourcesContext =
  createContext<ThreadTitleMentionResources>(EMPTY_TITLE_MENTION_RESOURCES);

export function useThreadTitleMentionResources(): ThreadTitleMentionResources {
  return useContext(ThreadTitleMentionResourcesContext);
}

export function useThreadRoutePath(): (
  threadId: string,
  projectId: string | undefined,
  messageSeq: number | null,
) => string {
  const { threadById } = useThreadTitleMentionResources();
  return (threadId, projectId, messageSeq) => {
    const resolvedProjectId =
      projectId ?? threadById.get(threadId)?.projectId ?? PERSONAL_PROJECT_ID;
    return getThreadLocationPath({
      projectId: resolvedProjectId,
      threadId,
      ...(messageSeq === null ? {} : { messageSeq }),
    });
  };
}

function areStringMapsEqual(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function retainStringMap(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  return areStringMapsEqual(previous, next) ? previous : next;
}

function areThreadTitleMentionThreadsEqual(
  left: ThreadTitleMentionThread,
  right: ThreadTitleMentionThread,
): boolean {
  return (
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.titleFallback === right.titleFallback
  );
}

export interface ThreadTitleMentionNavigationSource {
  sections: readonly { id: string; name: string }[];
  projects: readonly {
    id: string;
    name: string;
    threads: readonly ThreadListEntry[];
  }[];
  personalProject: {
    id: string;
    name: string;
    threads: readonly ThreadListEntry[];
  };
}

export function buildThreadTitleMentionResources(
  navigation: ThreadTitleMentionNavigationSource | undefined,
  previous: ThreadTitleMentionResources,
): ThreadTitleMentionResources {
  if (navigation === undefined) {
    return previous.threadById.size === 0 &&
      previous.projectNamesById.size === 0 &&
      previous.sectionNamesById.size === 0
      ? previous
      : EMPTY_TITLE_MENTION_RESOURCES;
  }
  const sectionNamesById = new Map<string, string>();
  for (const section of navigation.sections) {
    sectionNamesById.set(section.id, section.name);
  }
  const projectNamesById = new Map<string, string>();
  for (const project of navigation.projects) {
    projectNamesById.set(project.id, project.name);
  }
  projectNamesById.set(
    navigation.personalProject.id,
    navigation.personalProject.name,
  );
  const threadById = new Map<string, ThreadTitleMentionThread>();
  let threadsChanged = false;
  const addThread = (thread: ThreadListEntry): void => {
    const previousEntry = previous.threadById.get(thread.id);
    if (
      previousEntry !== undefined &&
      areThreadTitleMentionThreadsEqual(previousEntry, thread)
    ) {
      threadById.set(thread.id, previousEntry);
      return;
    }
    threadsChanged = true;
    threadById.set(thread.id, {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      titleFallback: thread.titleFallback,
    });
  };
  for (const project of navigation.projects) {
    for (const thread of project.threads) addThread(thread);
  }
  for (const thread of navigation.personalProject.threads) addThread(thread);
  if (threadById.size !== previous.threadById.size) threadsChanged = true;

  const next: ThreadTitleMentionResources = {
    sectionNamesById: retainStringMap(
      previous.sectionNamesById,
      sectionNamesById,
    ),
    projectNamesById: retainStringMap(
      previous.projectNamesById,
      projectNamesById,
    ),
    threadById: threadsChanged ? threadById : previous.threadById,
  };
  return next.sectionNamesById === previous.sectionNamesById &&
    next.projectNamesById === previous.projectNamesById &&
    next.threadById === previous.threadById
    ? previous
    : next;
}

export function useSidebarThreadTitleMentionResources(
  navigation: ThreadTitleMentionNavigationSource | undefined,
): ThreadTitleMentionResources {
  const [resources, setResources] = useState(() =>
    buildThreadTitleMentionResources(navigation, EMPTY_TITLE_MENTION_RESOURCES),
  );
  const next = buildThreadTitleMentionResources(navigation, resources);
  if (next !== resources) {
    setResources(next);
    return next;
  }
  return resources;
}

interface RawThreadMentionResolverContextValue {
  register: (threadId: string) => void;
  resourceById: ReadonlyMap<string, PromptMentionResource>;
  unavailableIds: ReadonlySet<string>;
}

const EMPTY_RAW_THREAD_MENTION_RESOLVER: RawThreadMentionResolverContextValue =
  {
    register: () => {},
    resourceById: new Map(),
    unavailableIds: new Set(),
  };

const RawThreadMentionResolverContext =
  createContext<RawThreadMentionResolverContextValue>(
    EMPTY_RAW_THREAD_MENTION_RESOLVER,
  );

interface RawThreadMentionQueue {
  scheduledOrResolvedIds: Set<string>;
  retriedIds: Set<string>;
  pendingIds: Set<string>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  activeControllers: Set<AbortController>;
}

function createRawThreadMentionQueue(): RawThreadMentionQueue {
  return {
    scheduledOrResolvedIds: new Set(),
    retriedIds: new Set(),
    pendingIds: new Set(),
    flushTimer: null,
    activeControllers: new Set(),
  };
}

function flushRawThreadMentionQueue(
  queue: RawThreadMentionQueue,
  setResourceById: Dispatch<
    SetStateAction<ReadonlyMap<string, PromptMentionResource>>
  >,
  setUnavailableIds: Dispatch<SetStateAction<ReadonlySet<string>>>,
): void {
  const threadIds = [...queue.pendingIds].slice(
    0,
    THREAD_MENTION_RESOLVE_MAX_IDS,
  );
  for (const threadId of threadIds) {
    queue.pendingIds.delete(threadId);
  }
  queue.flushTimer = null;
  if (threadIds.length === 0) return;

  const controller = new AbortController();
  queue.activeControllers.add(controller);
  void sdk.threads
    .resolveMentions({ threadIds, signal: controller.signal })
    .then((resolutions) => {
      if (controller.signal.aborted) return;
      const resolvedIds = new Set(
        resolutions.map((resolution) => resolution.threadId),
      );
      setResourceById((current) => {
        const next = new Map(current);
        for (const resolution of resolutions) {
          next.set(resolution.threadId, {
            kind: "thread",
            threadId: resolution.threadId,
            projectId: resolution.projectId,
            label: resolution.label,
          });
        }
        return next;
      });
      setUnavailableIds((current) => {
        const next = new Set(current);
        for (const threadId of threadIds) {
          if (resolvedIds.has(threadId)) next.delete(threadId);
          else next.add(threadId);
        }
        return next;
      });
    })
    .catch(() => {
      if (controller.signal.aborted) return;
      for (const threadId of threadIds) {
        if (queue.retriedIds.has(threadId)) continue;
        queue.retriedIds.add(threadId);
        queue.pendingIds.add(threadId);
      }
    })
    .finally(() => {
      queue.activeControllers.delete(controller);
      if (queue.pendingIds.size > 0 && queue.flushTimer === null) {
        queue.flushTimer = setTimeout(
          () =>
            flushRawThreadMentionQueue(
              queue,
              setResourceById,
              setUnavailableIds,
            ),
          25,
        );
      }
    });
}

function RawThreadMentionResolverProvider({
  children,
}: {
  children: ReactNode;
}) {
  const queueRef = useRef<RawThreadMentionQueue>(createRawThreadMentionQueue());
  const [resourceById, setResourceById] = useState<
    ReadonlyMap<string, PromptMentionResource>
  >(new Map());
  const [unavailableIds, setUnavailableIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const register = useCallback((threadId: string): void => {
    const queue = queueRef.current;
    if (queue.scheduledOrResolvedIds.has(threadId)) {
      return;
    }

    queue.scheduledOrResolvedIds.add(threadId);
    queue.pendingIds.add(threadId);
    if (queue.flushTimer !== null) {
      clearTimeout(queue.flushTimer);
    }
    queue.flushTimer = setTimeout(
      () =>
        flushRawThreadMentionQueue(queue, setResourceById, setUnavailableIds),
      25,
    );
  }, []);

  const value = useMemo(
    () => ({ register, resourceById, unavailableIds }),
    [register, resourceById, unavailableIds],
  );

  useEffect(
    () => () => {
      const queue = queueRef.current;
      if (queue.flushTimer !== null) {
        clearTimeout(queue.flushTimer);
        queue.flushTimer = null;
      }
      queue.pendingIds.clear();
      queue.scheduledOrResolvedIds.clear();
      queue.retriedIds.clear();
      for (const controller of queue.activeControllers) {
        controller.abort();
      }
      queue.activeControllers.clear();
    },
    [],
  );

  return (
    <RawThreadMentionResolverContext.Provider value={value}>
      {children}
    </RawThreadMentionResolverContext.Provider>
  );
}

const EMPTY_RAW_THREAD_MENTION_BATCH: RawThreadMentionResolverContextValue = {
  register: () => {},
  resourceById: new Map(),
  unavailableIds: new Set(),
};

const RawThreadMentionBatchContext =
  createContext<RawThreadMentionResolverContextValue>(
    EMPTY_RAW_THREAD_MENTION_BATCH,
  );

function RawThreadMentionBatchScope({ children }: { children: ReactNode }) {
  const resolver = useContext(RawThreadMentionResolverContext);
  const acceptedIdsRef = useRef(new Set<string>());
  const register = useCallback(
    (threadId: string) => {
      if (acceptedIdsRef.current.has(threadId)) return;
      if (acceptedIdsRef.current.size >= THREAD_MENTION_RESOLVE_MAX_IDS) return;
      acceptedIdsRef.current.add(threadId);
      resolver.register(threadId);
    },
    [resolver],
  );
  const value = useMemo(
    () => ({
      register,
      resourceById: resolver.resourceById,
      unavailableIds: resolver.unavailableIds,
    }),
    [register, resolver.resourceById, resolver.unavailableIds],
  );
  useEffect(
    () => () => {
      acceptedIdsRef.current.clear();
    },
    [],
  );
  return (
    <RawThreadMentionBatchContext.Provider value={value}>
      {children}
    </RawThreadMentionBatchContext.Provider>
  );
}

export function RawThreadMentionBatchProvider({
  children,
}: {
  children: ReactNode;
}) {
  const resolver = useContext(RawThreadMentionResolverContext);
  if (resolver === EMPTY_RAW_THREAD_MENTION_RESOLVER) {
    return (
      <RawThreadMentionResolverProvider>
        <RawThreadMentionBatchScope>{children}</RawThreadMentionBatchScope>
      </RawThreadMentionResolverProvider>
    );
  }
  return <RawThreadMentionBatchScope>{children}</RawThreadMentionBatchScope>;
}

const TITLE_MENTION_PATTERN = new RegExp(
  `@(?:thread:[A-Za-z0-9_-]+|project:[A-Za-z0-9_-]+|(?:section|folder):[A-Za-z0-9_-]+|(?:thread-storage:)?(?:(?:[\\p{L}\\p{N}._-]+\\/)+(?:[\\p{L}\\p{N}._-]*\\.[\\p{L}\\p{N}_-]+)?|[\\p{L}\\p{N}._-]*\\.[\\p{L}\\p{N}_-]+))|${RAW_THREAD_ID_PATTERN_SOURCE}`,
  "gu",
);

export interface ThreadTitleMentionResourcesProviderProps {
  children: ReactNode;
  sectionNamesById: ReadonlyMap<string, string>;
  projectNamesById: ReadonlyMap<string, string>;
  threadById: ReadonlyMap<string, ThreadTitleMentionThread>;
}

const ThreadTitleMentionResourcesGetterContext = createContext<
  () => ThreadTitleMentionResources
>(() => EMPTY_TITLE_MENTION_RESOURCES);

export function useThreadTitleMentionResourcesGetter(): () => ThreadTitleMentionResources {
  return useContext(ThreadTitleMentionResourcesGetterContext);
}

export function ThreadTitleMentionResourcesProvider({
  children,
  sectionNamesById,
  projectNamesById,
  threadById,
}: ThreadTitleMentionResourcesProviderProps) {
  const resolver = useContext(RawThreadMentionResolverContext);
  const value = useMemo(
    () => ({ sectionNamesById, projectNamesById, threadById }),
    [sectionNamesById, projectNamesById, threadById],
  );
  const latestValue = useRef(value);
  useLayoutEffect(() => {
    latestValue.current = value;
  }, [value]);
  const getValue = useCallback(() => latestValue.current, []);

  const content = (
    <ThreadTitleMentionResourcesGetterContext.Provider value={getValue}>
      <ThreadTitleMentionResourcesContext.Provider value={value}>
        {children}
      </ThreadTitleMentionResourcesContext.Provider>
    </ThreadTitleMentionResourcesGetterContext.Provider>
  );
  return resolver === EMPTY_RAW_THREAD_MENTION_RESOLVER ? (
    <RawThreadMentionResolverProvider>
      {content}
    </RawThreadMentionResolverProvider>
  ) : (
    content
  );
}

export function isMentionBoundary(text: string, index: number): boolean {
  const previous = text[index - 1];
  return previous === undefined || !/[\p{L}\p{N}_.+-]/u.test(previous);
}

export function isRawThreadIdBoundary(text: string, index: number): boolean {
  const previous = text[index - 1];
  return (
    previous !== "/" && previous !== "\\" && isMentionBoundary(text, index)
  );
}

export function isMentionEndBoundary(text: string, index: number): boolean {
  const next = text[index];
  if (next === undefined) return true;
  if (next === ".") {
    const afterPeriod = text[index + 1];
    return afterPeriod === undefined || /[\s,;:!?)}\]"'’”]/u.test(afterPeriod);
  }
  return !/[\p{L}\p{N}_.+\/-]/u.test(next);
}

export function isRawThreadIdEndBoundary(text: string, index: number): boolean {
  return text[index] !== "\\" && isMentionEndBoundary(text, index);
}

function hasUnsupportedPathContinuation(text: string, index: number): boolean {
  return /^\s+(?:[\p{L}\p{N}._-]+(?:\s+|\/))*[\p{L}\p{N}_-]+(?:\/|\.[\p{L}\p{N}_-]+)(?=$|[\s,;:!?)}\]])/u.test(
    text.slice(index),
  );
}

function isPathMentionToken(token: string): boolean {
  return !/^@(?:thread|project|section|folder):/u.test(token);
}

function pathMentionResourceFromToken(token: string): PromptMentionResource {
  const serializedPath = token.slice(1);
  const source = serializedPath.startsWith("thread-storage:")
    ? "thread-storage"
    : "workspace";
  const path =
    source === "thread-storage"
      ? serializedPath.slice("thread-storage:".length)
      : serializedPath;
  return pathMentionResource({
    path,
    source,
    entryKind: path.endsWith("/") ? "directory" : "file",
  });
}

function threadResourceFromThread(
  threadId: string,
  thread: ThreadTitleMentionThread,
): PromptMentionResource {
  return {
    kind: "thread",
    threadId,
    projectId: thread.projectId,
    label: getThreadDisplayTitle(thread),
  };
}

function threadMentionResource(
  threadId: string,
  resources: ThreadTitleMentionResources,
): PromptMentionResource | null {
  const thread = resources.threadById.get(threadId);
  if (!thread) {
    return null;
  }
  return threadResourceFromThread(threadId, thread);
}

const UNRESOLVED_THREAD_MENTION_LABEL = "Thread";
const UNAVAILABLE_THREAD_MENTION_LABEL = "Unavailable thread";
const SECTION_MENTION_PREFIXES = ["section:", "folder:"] as const;

function unresolvedThreadMentionResource(
  threadId: string,
  label = UNRESOLVED_THREAD_MENTION_LABEL,
): PromptMentionResource {
  return {
    kind: "thread",
    threadId,
    label,
  };
}

function resolveTitleMentionResource(
  token: string,
  resources: ThreadTitleMentionResources,
): PromptMentionResource | null {
  const serializedValue = token.slice(1);
  if (serializedValue.startsWith("thread:")) {
    const threadId = serializedValue.slice("thread:".length);
    const resource = threadMentionResource(threadId, resources);
    if (resource !== null || isRawThreadId(threadId)) {
      return resource;
    }
    return { kind: "thread", threadId, label: threadId };
  }

  if (serializedValue.startsWith("project:")) {
    const projectId = serializedValue.slice("project:".length);
    return {
      kind: "project",
      projectId,
      label: resources.projectNamesById.get(projectId) ?? projectId,
    };
  }

  const sectionPrefix = SECTION_MENTION_PREFIXES.find((prefix) =>
    serializedValue.startsWith(prefix),
  );
  if (sectionPrefix !== undefined) {
    const sectionId = serializedValue.slice(sectionPrefix.length);
    return {
      kind: "section",
      sectionId,
      label: resources.sectionNamesById.get(sectionId) ?? sectionId,
    };
  }

  return pathMentionResourceFromToken(token);
}

interface ThreadTitleTextSegment {
  unresolvedThreadId: string | null;
  resource: PromptMentionResource | null;
  serializedText: string | null;
  text: string;
}

function serializedThreadMentionId(token: string): string | null {
  const prefix = "@thread:";
  return token.startsWith(prefix) ? token.slice(prefix.length) : null;
}

function mayContainTitleMention(title: string): boolean {
  TITLE_MENTION_PATTERN.lastIndex = 0;
  const found = TITLE_MENTION_PATTERN.test(title);
  TITLE_MENTION_PATTERN.lastIndex = 0;
  return found;
}

function threadTitleTextSegments(
  title: string,
  resources: ThreadTitleMentionResources,
): ThreadTitleTextSegment[] {
  const segments: ThreadTitleTextSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  TITLE_MENTION_PATTERN.lastIndex = 0;
  while ((match = TITLE_MENTION_PATTERN.exec(title)) !== null) {
    const token = match[0];
    const matchEnd = match.index + token.length;
    const rawThreadId = isRawThreadId(token) ? token : null;
    if (
      !(rawThreadId === null
        ? isMentionBoundary(title, match.index)
        : isRawThreadIdBoundary(title, match.index)) ||
      !(rawThreadId === null
        ? isMentionEndBoundary(title, matchEnd)
        : isRawThreadIdEndBoundary(title, matchEnd)) ||
      (rawThreadId === null &&
        isPathMentionToken(token) &&
        hasUnsupportedPathContinuation(title, matchEnd))
    ) {
      continue;
    }
    if (match.index > cursor) {
      segments.push({
        unresolvedThreadId: null,
        resource: null,
        serializedText: null,
        text: title.slice(cursor, match.index),
      });
    }
    const serializedThreadId =
      rawThreadId === null ? serializedThreadMentionId(token) : null;
    const resource =
      rawThreadId === null
        ? resolveTitleMentionResource(token, resources)
        : threadMentionResource(rawThreadId, resources);
    const unresolvedThreadId =
      resource === null ? (rawThreadId ?? serializedThreadId) : null;
    segments.push({
      unresolvedThreadId,
      resource,
      serializedText:
        resource === null && unresolvedThreadId === null ? null : token,
      text:
        resource?.label ??
        (serializedThreadId === null ? token : UNRESOLVED_THREAD_MENTION_LABEL),
    });
    cursor = matchEnd;
  }

  if (segments.length === 0) {
    return [
      {
        unresolvedThreadId: null,
        resource: null,
        serializedText: null,
        text: title,
      },
    ];
  }
  if (cursor < title.length) {
    segments.push({
      unresolvedThreadId: null,
      resource: null,
      serializedText: null,
      text: title.slice(cursor),
    });
  }
  return segments;
}

export function resolveSerializedPromptMentions(
  text: string,
  resources: ThreadTitleMentionResources,
): PromptTextMention[] {
  const mentions: PromptTextMention[] = [];
  let cursor = 0;
  for (const segment of threadTitleTextSegments(text, resources)) {
    const token = segment.serializedText ?? segment.text;
    const end = cursor + token.length;
    if (/^@(?:thread|project|section):/u.test(token)) {
      const resource =
        segment.resource ??
        (segment.unresolvedThreadId === null
          ? null
          : unresolvedThreadMentionResource(segment.unresolvedThreadId));
      if (resource !== null) mentions.push({ start: cursor, end, resource });
    }
    cursor = end;
  }
  return mentions;
}

export function resolveThreadTitleDisplayText(
  title: string,
  resources: ThreadTitleMentionResources,
): string {
  return threadTitleTextSegments(title, resources)
    .map((segment) => segment.text)
    .join("");
}

export function useResolveThreadTitle(): (title: string) => string {
  const resources = useContext(ThreadTitleMentionResourcesContext);
  return useCallback(
    (title: string) => resolveThreadTitleDisplayText(title, resources),
    [resources],
  );
}

function useUnavailableRawThreadMentionIds(): ReadonlySet<string> {
  const batch = useContext(RawThreadMentionBatchContext);
  const resolver = useContext(RawThreadMentionResolverContext);
  return batch === EMPTY_RAW_THREAD_MENTION_BATCH
    ? resolver.unavailableIds
    : batch.unavailableIds;
}

export function useThreadTitleDisplayText(title: string): string {
  const resources = useContext(ThreadTitleMentionResourcesContext);
  const unavailableThreadIds = useUnavailableRawThreadMentionIds();
  const segments = useMemo(
    () => threadTitleTextSegments(title, resources),
    [resources, title],
  );
  const unresolvedThreadIds = useMemo(() => {
    const threadIds = new Set<string>();
    for (const segment of segments) {
      if (segment.unresolvedThreadId !== null) {
        threadIds.add(segment.unresolvedThreadId);
      }
    }
    return [...threadIds];
  }, [segments]);
  const resolvedThreadsById = useRawThreadMentionResources(unresolvedThreadIds);
  return useMemo(
    () =>
      segments
        .map((segment) =>
          segment.unresolvedThreadId === null
            ? segment.text
            : (resolvedThreadsById.get(segment.unresolvedThreadId)?.label ??
              (segment.serializedText?.startsWith("@thread:") === true &&
              unavailableThreadIds.has(segment.unresolvedThreadId)
                ? UNAVAILABLE_THREAD_MENTION_LABEL
                : segment.text)),
        )
        .join(""),
    [resolvedThreadsById, segments, unavailableThreadIds],
  );
}

export function useSidebarThreadMentionResource(
  threadId: string,
): PromptMentionResource | null {
  const resources = useContext(ThreadTitleMentionResourcesContext);
  return useMemo(
    () => threadMentionResource(threadId, resources),
    [resources, threadId],
  );
}

export function useThreadMentionResource(
  threadId: string,
): PromptMentionResource | null {
  const sidebarResource = useSidebarThreadMentionResource(threadId);
  const threadQuery = useThread(threadId, {
    enabled: sidebarResource === null,
  });

  return useMemo<PromptMentionResource | null>(() => {
    if (sidebarResource !== null) {
      return sidebarResource;
    }
    if (threadQuery.data === undefined) {
      return null;
    }
    return threadResourceFromThread(threadId, threadQuery.data);
  }, [sidebarResource, threadId, threadQuery.data]);
}

type CachedThreads = readonly (ThreadResponse | undefined)[];

const NO_CACHED_THREADS: CachedThreads = [];

function subscribeToNothing(): () => void {
  return () => {};
}

function getNoCachedThreads(): CachedThreads {
  return NO_CACHED_THREADS;
}

function createCachedThreadsStore(
  queryClient: QueryClient,
  threadIds: readonly string[],
) {
  const queryKeys = threadIds.map((threadId) => threadQueryKey(threadId));
  const queryHashes = new Set(queryKeys.map((queryKey) => hashKey(queryKey)));
  let snapshot: CachedThreads = NO_CACHED_THREADS;
  return {
    getSnapshot(): CachedThreads {
      const next = queryKeys.map((queryKey) =>
        queryClient.getQueryData<ThreadResponse>(queryKey),
      );
      if (
        next.length === snapshot.length &&
        next.every((thread, index) => thread === snapshot[index])
      ) {
        return snapshot;
      }
      snapshot = next;
      return snapshot;
    },
    subscribe(onChange: () => void): () => void {
      return queryClient.getQueryCache().subscribe((event) => {
        if (queryHashes.has(event.query.queryHash)) {
          onChange();
        }
      });
    },
  };
}

function useCachedThreads(threadIds: readonly string[]): CachedThreads {
  const queryClient = useContext(QueryClientContext);
  const store = useMemo(
    () =>
      queryClient === undefined || threadIds.length === 0
        ? null
        : createCachedThreadsStore(queryClient, threadIds),
    [queryClient, threadIds],
  );
  return useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    store?.getSnapshot ?? getNoCachedThreads,
  );
}

export function useRawThreadMentionResource(
  threadId: string,
): PromptMentionResource | null {
  const sidebarResource = useSidebarThreadMentionResource(threadId);
  const threadIds = useMemo(() => [threadId], [threadId]);
  const batch = useContext(RawThreadMentionBatchContext);
  const [cachedThread] = useCachedThreads(threadIds);
  useEffect(() => {
    if (sidebarResource === null && cachedThread === undefined) {
      batch.register(threadId);
    }
  }, [batch, cachedThread, sidebarResource, threadId]);
  if (sidebarResource !== null) {
    return sidebarResource;
  }
  if (cachedThread !== undefined) {
    return threadResourceFromThread(threadId, cachedThread);
  }
  return batch.resourceById.get(threadId) ?? null;
}

export function useRawThreadMentionResources(
  threadIds: readonly string[],
): ReadonlyMap<string, PromptMentionResource> {
  const resources = useContext(ThreadTitleMentionResourcesContext);
  const batch = useContext(RawThreadMentionBatchContext);
  const resolver = useContext(RawThreadMentionResolverContext);
  const resolutionContext =
    batch === EMPTY_RAW_THREAD_MENTION_BATCH ? resolver : batch;
  const cachedThreads = useCachedThreads(threadIds);
  useEffect(() => {
    let registeredCount = 0;
    for (const [index, threadId] of threadIds.entries()) {
      const sidebarResource = threadMentionResource(threadId, resources);
      const cachedThread = cachedThreads[index];
      if (
        sidebarResource === null &&
        cachedThread === undefined &&
        registeredCount < THREAD_MENTION_RESOLVE_MAX_IDS
      ) {
        resolutionContext.register(threadId);
        registeredCount += 1;
      }
    }
  }, [cachedThreads, resolutionContext, resources, threadIds]);

  return useMemo(() => {
    const resourceById = new Map<string, PromptMentionResource>();
    for (const [index, threadId] of threadIds.entries()) {
      const sidebarResource = threadMentionResource(threadId, resources);
      if (sidebarResource !== null) {
        resourceById.set(threadId, sidebarResource);
        continue;
      }
      const cachedThread = cachedThreads[index];
      if (cachedThread !== undefined) {
        resourceById.set(
          threadId,
          threadResourceFromThread(threadId, cachedThread),
        );
        continue;
      }
      const batchResource = resolutionContext.resourceById.get(threadId);
      if (batchResource !== undefined) {
        resourceById.set(threadId, batchResource);
      }
    }
    return resourceById;
  }, [cachedThreads, resolutionContext.resourceById, resources, threadIds]);
}

interface ResolvingThreadTitleMentionProps {
  renderFallbackPill: boolean;
  serializedText: string;
  threadId: string;
}

function ResolvingThreadTitleMention({
  renderFallbackPill,
  serializedText,
  threadId,
}: ResolvingThreadTitleMentionProps) {
  const resource = useRawThreadMentionResource(threadId);
  const unavailableIds = useUnavailableRawThreadMentionIds();
  if (resource === null) {
    return renderFallbackPill ? (
      <PromptMentionPill
        interactive={false}
        resource={unresolvedThreadMentionResource(
          threadId,
          unavailableIds.has(threadId)
            ? UNAVAILABLE_THREAD_MENTION_LABEL
            : UNRESOLVED_THREAD_MENTION_LABEL,
        )}
        serializedText={serializedText}
      />
    ) : (
      <span className="truncate">{threadId}</span>
    );
  }
  return (
    <PromptMentionPill
      interactive={false}
      resource={resource}
      serializedText={serializedText}
    />
  );
}

interface ThreadTitleHighlightRange {
  start: number;
  end: number;
}

const THREAD_TITLE_HIGHLIGHT_CLASS =
  "rounded-sm bg-[var(--sidebar-search-match)] py-px text-foreground";

export function highlightedText(
  text: string,
  offset: number,
  ranges: readonly ThreadTitleHighlightRange[],
): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    const start = Math.max(cursor, Math.min(range.start - offset, text.length));
    const end = Math.max(start, Math.min(range.end - offset, text.length));
    if (end <= start) continue;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <mark key={`${start}:${end}`} className={THREAD_TITLE_HIGHLIGHT_CLASS}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (nodes.length === 0) return text;
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

interface ThreadTitleMentionsProps {
  title: string;
  highlightRanges?: readonly ThreadTitleHighlightRange[];
}

function ThreadTitleMentionsContent({
  title,
  highlightRanges = [],
}: ThreadTitleMentionsProps) {
  const resources = mayContainTitleMention(title)
    ? use(ThreadTitleMentionResourcesContext)
    : EMPTY_TITLE_MENTION_RESOURCES;
  const segments = threadTitleTextSegments(title, resources);
  const segmentOffsets: number[] = [];
  let offset = 0;
  for (const segment of segments) {
    segmentOffsets.push(offset);
    offset += (segment.serializedText ?? segment.text).length;
  }
  return segments.map((segment, index) => {
    const segmentOffset = segmentOffsets[index] ?? 0;
    return segment.unresolvedThreadId !== null &&
      segment.serializedText !== null ? (
      <ResolvingThreadTitleMention
        key={`${index}:${segment.unresolvedThreadId}`}
        renderFallbackPill={segment.serializedText.startsWith("@thread:")}
        serializedText={segment.serializedText}
        threadId={segment.unresolvedThreadId}
      />
    ) : segment.resource === null || segment.serializedText === null ? (
      <span key={`${index}:text`} className="truncate whitespace-pre">
        {highlightedText(segment.text, segmentOffset, highlightRanges)}
      </span>
    ) : (
      <PromptMentionPill
        key={`${index}:${segment.serializedText}`}
        interactive={false}
        resource={segment.resource}
        serializedText={segment.serializedText}
      />
    );
  });
}

export function ThreadTitleMentions({
  title,
  highlightRanges,
}: ThreadTitleMentionsProps) {
  return (
    <RawThreadMentionBatchProvider>
      <ThreadTitleMentionsContent
        title={title}
        highlightRanges={highlightRanges}
      />
    </RawThreadMentionBatchProvider>
  );
}

interface ThreadTitleProps extends Omit<
  ComponentPropsWithoutRef<"span">,
  "children" | "title"
> {
  title: string;
  inline?: boolean;
  tooltip?: boolean;
  highlightRanges?: readonly ThreadTitleHighlightRange[];
  ref?: Ref<HTMLSpanElement>;
}

export function ThreadTitle({
  title,
  inline = false,
  tooltip = false,
  highlightRanges,
  className,
  ...spanProps
}: ThreadTitleProps) {
  const displayTitle = useThreadTitleDisplayText(title);
  return (
    <span
      {...spanProps}
      className={cn(!inline && "bb-thread-title", className)}
      title={tooltip ? displayTitle : undefined}
    >
      <ThreadTitleMentions title={title} highlightRanges={highlightRanges} />
    </span>
  );
}
