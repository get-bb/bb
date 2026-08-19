import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  isRawThreadId,
  RAW_THREAD_ID_PATTERN_SOURCE,
  type PromptMentionResource,
  type ThreadListEntry,
} from "@bb/domain";
import { QueryClientContext } from "@tanstack/react-query";
import {
  THREAD_MENTION_RESOLVE_MAX_IDS,
  type ThreadResponse,
} from "@bb/server-contract";
import { PromptMentionPill } from "@/components/thread/timeline/ConversationMessageMentions";
import { useThread } from "@/hooks/queries/thread-queries";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { getThreadDisplayTitle } from "@/lib/thread-title";

/** The slice of a thread a title mention needs: its label and route. */
export type ThreadTitleMentionThread = Pick<
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

/** The resources of the nearest {@link ThreadTitleMentionResourcesProvider}. */
export function useThreadTitleMentionResources(): ThreadTitleMentionResources {
  return useContext(ThreadTitleMentionResourcesContext);
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

/** The part of the sidebar bootstrap payload title mentions read. */
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

/**
 * Build the sidebar-derived mention resources, reusing the previous maps and
 * per-thread entries whenever their values are unchanged. Sidebar refetches
 * land every turn boundary with a new payload identity, but titles, project
 * names and section names rarely change; without retention every refetch
 * gave the context a new value and re-rendered every ThreadRow, mention pill
 * and markdown link that reads it.
 */
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

/**
 * Sidebar-derived mention resources with value retention (see
 * {@link buildThreadTitleMentionResources}); the returned object only changes
 * identity when a section name, project name or thread title/route changed.
 */
export function useSidebarThreadTitleMentionResources(
  navigation: ThreadTitleMentionNavigationSource | undefined,
): ThreadTitleMentionResources {
  // Render-time cache keyed on the payload identity. The previous resources
  // are the input to the next build, and a state-based "adjust during render"
  // would loop if a caller ever handed in a fresh payload object per render,
  // so this deliberately reads and writes a ref during render (the hook is
  // small; the compiler bailout is confined to it).
  const cacheRef = useRef<{
    navigation: ThreadTitleMentionNavigationSource | undefined;
    resources: ThreadTitleMentionResources;
  } | null>(null);
  /* eslint-disable react-hooks/refs -- render-time cache, see above */
  const cached = cacheRef.current;
  if (cached !== null && cached.navigation === navigation) {
    return cached.resources;
  }
  const resources = buildThreadTitleMentionResources(
    navigation,
    cached?.resources ?? EMPTY_TITLE_MENTION_RESOURCES,
  );
  cacheRef.current = { navigation, resources };
  /* eslint-enable react-hooks/refs */
  return resources;
}

interface RawThreadMentionResolverContextValue {
  register: (threadId: string) => void;
  resourceById: ReadonlyMap<string, PromptMentionResource>;
}

const EMPTY_RAW_THREAD_MENTION_RESOLVER: RawThreadMentionResolverContextValue =
  {
    register: () => {},
    resourceById: new Map(),
  };

const RawThreadMentionResolverContext =
  createContext<RawThreadMentionResolverContextValue>(
    EMPTY_RAW_THREAD_MENTION_RESOLVER,
  );

function RawThreadMentionResolverProvider({
  children,
}: {
  children: ReactNode;
}) {
  const scheduledOrResolvedIdsRef = useRef(new Set<string>());
  const pendingIdsRef = useRef(new Set<string>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingRef = useRef<() => void>(() => {});
  const activeControllersRef = useRef(new Set<AbortController>());
  const [resourceById, setResourceById] = useState<
    ReadonlyMap<string, PromptMentionResource>
  >(new Map());

  flushPendingRef.current = () => {
    const threadIds = [...pendingIdsRef.current].slice(
      0,
      THREAD_MENTION_RESOLVE_MAX_IDS,
    );
    for (const threadId of threadIds) {
      pendingIdsRef.current.delete(threadId);
    }
    flushTimerRef.current = null;
    if (threadIds.length === 0) return;

    const controller = new AbortController();
    activeControllersRef.current.add(controller);
    void sdk.threads
      .resolveMentions({ threadIds, signal: controller.signal })
      .then((resolutions) => {
        if (controller.signal.aborted) return;
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
      })
      .catch(() => {
        for (const threadId of threadIds) {
          scheduledOrResolvedIdsRef.current.delete(threadId);
        }
      })
      .finally(() => {
        activeControllersRef.current.delete(controller);
        if (pendingIdsRef.current.size > 0 && flushTimerRef.current === null) {
          flushTimerRef.current = setTimeout(
            () => flushPendingRef.current(),
            25,
          );
        }
      });
  };

  const register = useCallback((threadId: string): void => {
    if (scheduledOrResolvedIdsRef.current.has(threadId)) {
      return;
    }

    scheduledOrResolvedIdsRef.current.add(threadId);
    pendingIdsRef.current.add(threadId);
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = setTimeout(() => flushPendingRef.current(), 25);
  }, []);

  const value = useMemo(
    () => ({ register, resourceById }),
    [register, resourceById],
  );

  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingIdsRef.current.clear();
      scheduledOrResolvedIdsRef.current.clear();
      for (const controller of activeControllersRef.current) {
        controller.abort();
      }
      activeControllersRef.current.clear();
    },
    [],
  );

  return (
    <RawThreadMentionResolverContext.Provider value={value}>
      {children}
    </RawThreadMentionResolverContext.Provider>
  );
}

interface RawThreadMentionBatchContextValue {
  register: (threadId: string) => void;
  resourceById: ReadonlyMap<string, PromptMentionResource>;
}

const EMPTY_RAW_THREAD_MENTION_BATCH: RawThreadMentionBatchContextValue = {
  register: () => {},
  resourceById: new Map(),
};

const RawThreadMentionBatchContext =
  createContext<RawThreadMentionBatchContextValue>(
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
    () => ({ register, resourceById: resolver.resourceById }),
    [register, resolver.resourceById],
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

/** Caps one title/message at 32 unique lookups and reuses the nearest resolver. */
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

  const content = (
    <ThreadTitleMentionResourcesContext.Provider value={value}>
      {children}
    </ThreadTitleMentionResourcesContext.Provider>
  );
  return resolver === EMPTY_RAW_THREAD_MENTION_RESOLVER ? (
    <RawThreadMentionResolverProvider>
      {content}
    </RawThreadMentionResolverProvider>
  ) : (
    content
  );
}

function isMentionBoundary(text: string, index: number): boolean {
  const previous = text[index - 1];
  return previous === undefined || !/[\p{L}\p{N}_.+-]/u.test(previous);
}

function isRawThreadIdBoundary(text: string, index: number): boolean {
  const previous = text[index - 1];
  return (
    previous !== "/" && previous !== "\\" && isMentionBoundary(text, index)
  );
}

function isMentionEndBoundary(text: string, index: number): boolean {
  const next = text[index];
  if (next === undefined) return true;
  if (next === ".") {
    const afterPeriod = text[index + 1];
    return afterPeriod === undefined || /[\s,;:!?)}\]"'’”]/u.test(afterPeriod);
  }
  return !/[\p{L}\p{N}_.+\/-]/u.test(next);
}

function isRawThreadIdEndBoundary(text: string, index: number): boolean {
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

function pathMentionResource(token: string): PromptMentionResource {
  const serializedPath = token.slice(1);
  const source = serializedPath.startsWith("thread-storage:")
    ? "thread-storage"
    : "workspace";
  const path =
    source === "thread-storage"
      ? serializedPath.slice("thread-storage:".length)
      : serializedPath;
  const isDirectory = path.endsWith("/");
  const normalizedPath = isDirectory ? path.slice(0, -1) : path;
  const lastSlash = normalizedPath.lastIndexOf("/");

  return {
    kind: "path",
    source,
    entryKind: isDirectory ? "directory" : "file",
    path: normalizedPath,
    label: normalizedPath.slice(lastSlash + 1) || normalizedPath,
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
  return {
    kind: "thread",
    threadId,
    projectId: thread.projectId,
    label: getThreadDisplayTitle(thread),
  };
}

function resolveTitleMentionResource(
  token: string,
  resources: ThreadTitleMentionResources,
): PromptMentionResource {
  const serializedValue = token.slice(1);
  if (serializedValue.startsWith("thread:")) {
    const threadId = serializedValue.slice("thread:".length);
    return (
      threadMentionResource(threadId, resources) ?? {
        kind: "thread",
        threadId,
        label: threadId,
      }
    );
  }

  if (serializedValue.startsWith("project:")) {
    const projectId = serializedValue.slice("project:".length);
    return {
      kind: "project",
      projectId,
      label: resources.projectNamesById.get(projectId) ?? projectId,
    };
  }

  if (serializedValue.startsWith("section:")) {
    const sectionId = serializedValue.slice("section:".length);
    return {
      kind: "section",
      sectionId,
      label: resources.sectionNamesById.get(sectionId) ?? sectionId,
    };
  }

  if (serializedValue.startsWith("folder:")) {
    const sectionId = serializedValue.slice("folder:".length);
    return {
      kind: "section",
      sectionId,
      label: resources.sectionNamesById.get(sectionId) ?? sectionId,
    };
  }

  return pathMentionResource(token);
}

interface ThreadTitleTextSegment {
  rawThreadId: string | null;
  resource: PromptMentionResource | null;
  serializedText: string | null;
  text: string;
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
        rawThreadId: null,
        resource: null,
        serializedText: null,
        text: title.slice(cursor, match.index),
      });
    }
    const resource =
      rawThreadId === null
        ? resolveTitleMentionResource(token, resources)
        : threadMentionResource(rawThreadId, resources);
    segments.push({
      rawThreadId: resource === null ? rawThreadId : null,
      resource,
      serializedText: resource === null ? null : token,
      text: resource?.label ?? token,
    });
    cursor = matchEnd;
  }

  if (segments.length === 0) {
    return [
      {
        rawThreadId: null,
        resource: null,
        serializedText: null,
        text: title,
      },
    ];
  }
  if (cursor < title.length) {
    segments.push({
      rawThreadId: null,
      resource: null,
      serializedText: null,
      text: title.slice(cursor),
    });
  }
  return segments;
}

/** Resolves serialized mentions in a thread title without requiring React context. */
export function resolveThreadTitleDisplayText(
  title: string,
  resources: ThreadTitleMentionResources,
): string {
  return threadTitleTextSegments(title, resources)
    .map((segment) => segment.text)
    .join("");
}

/** Resolves serialized mentions in a thread title to one plain display label. */
export function useThreadTitleDisplayText(title: string): string {
  const resources = useContext(ThreadTitleMentionResourcesContext);
  return useMemo(
    () => resolveThreadTitleDisplayText(title, resources),
    [resources, title],
  );
}

/**
 * Looks up a project name from the sidebar's already-loaded metadata. Returns
 * undefined outside the provider or for an unknown project.
 */
export function useSidebarProjectName(
  projectId: string | null,
): string | undefined {
  const resources = useContext(ThreadTitleMentionResourcesContext);
  return projectId === null
    ? undefined
    : resources.projectNamesById.get(projectId);
}

/** Resolves a thread mention from the sidebar's already-loaded metadata. */
export function useSidebarThreadMentionResource(
  threadId: string,
): PromptMentionResource | null {
  const resources = useContext(ThreadTitleMentionResourcesContext);
  return useMemo(
    () => threadMentionResource(threadId, resources),
    [resources, threadId],
  );
}

/** Resolves a thread mention from sidebar metadata, then the thread query. */
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
    return {
      kind: "thread",
      threadId,
      projectId: threadQuery.data.projectId,
      label: getThreadDisplayTitle(threadQuery.data),
    };
  }, [sidebarResource, threadId, threadQuery.data]);
}

/** Resolves a raw thread id from sidebar metadata or the enclosing batch. */
export function useRawThreadMentionResource(
  threadId: string,
): PromptMentionResource | null {
  const sidebarResource = useSidebarThreadMentionResource(threadId);
  const queryClient = useContext(QueryClientContext);
  const batch = useContext(RawThreadMentionBatchContext);
  const cachedThread = queryClient?.getQueryData<ThreadResponse>(
    threadQueryKey(threadId),
  );
  useEffect(() => {
    if (sidebarResource === null && cachedThread === undefined) {
      batch.register(threadId);
    }
  }, [batch, cachedThread, sidebarResource, threadId]);
  if (sidebarResource !== null) {
    return sidebarResource;
  }
  if (cachedThread !== undefined) {
    return {
      kind: "thread",
      threadId,
      projectId: cachedThread.projectId,
      label: getThreadDisplayTitle(cachedThread),
    };
  }
  return batch.resourceById.get(threadId) ?? null;
}

/** Resolves several raw ids without creating one hook/subscription per label. */
export function useRawThreadMentionResources(
  threadIds: readonly string[],
): ReadonlyMap<string, PromptMentionResource> {
  const resources = useContext(ThreadTitleMentionResourcesContext);
  const queryClient = useContext(QueryClientContext);
  const batch = useContext(RawThreadMentionBatchContext);
  useEffect(() => {
    for (const threadId of threadIds) {
      const sidebarResource = threadMentionResource(threadId, resources);
      const cachedThread = queryClient?.getQueryData<ThreadResponse>(
        threadQueryKey(threadId),
      );
      if (sidebarResource === null && cachedThread === undefined) {
        batch.register(threadId);
      }
    }
  }, [batch, queryClient, resources, threadIds]);

  return useMemo(() => {
    const resourceById = new Map<string, PromptMentionResource>();
    for (const threadId of threadIds) {
      const sidebarResource = threadMentionResource(threadId, resources);
      if (sidebarResource !== null) {
        resourceById.set(threadId, sidebarResource);
        continue;
      }
      const cachedThread = queryClient?.getQueryData<ThreadResponse>(
        threadQueryKey(threadId),
      );
      if (cachedThread !== undefined) {
        resourceById.set(threadId, {
          kind: "thread",
          threadId,
          projectId: cachedThread.projectId,
          label: getThreadDisplayTitle(cachedThread),
        });
        continue;
      }
      const batchResource = batch.resourceById.get(threadId);
      if (batchResource !== undefined) {
        resourceById.set(threadId, batchResource);
      }
    }
    return resourceById;
  }, [batch.resourceById, queryClient, resources, threadIds]);
}

function RawThreadTitleMention({ threadId }: { threadId: string }) {
  const resource = useRawThreadMentionResource(threadId);
  if (resource === null) {
    return threadId;
  }
  return (
    <PromptMentionPill
      interactive={false}
      resource={resource}
      serializedText={threadId}
    />
  );
}

function ThreadTitleMentionsContent({ title }: { title: string }) {
  const resources = useContext(ThreadTitleMentionResourcesContext);
  return threadTitleTextSegments(title, resources).map((segment, index) =>
    segment.rawThreadId !== null ? (
      <RawThreadTitleMention
        key={`${index}:${segment.rawThreadId}`}
        threadId={segment.rawThreadId}
      />
    ) : segment.resource === null || segment.serializedText === null ? (
      segment.text
    ) : (
      <span key={`${index}:${segment.serializedText}`}>
        <PromptMentionPill
          interactive={false}
          resource={segment.resource}
          serializedText={segment.serializedText}
        />
      </span>
    ),
  );
}

/** Renders serialized prompt mentions persisted in thread title fallbacks. */
export function ThreadTitleMentions({ title }: { title: string }) {
  return (
    <RawThreadMentionBatchProvider>
      <ThreadTitleMentionsContent title={title} />
    </RawThreadMentionBatchProvider>
  );
}
