import {
  adoptThreadEventRewriteGeneration,
  getAppSettings,
  getExperiments,
  getLatestStoredConversationOutlineSequence,
  getLatestThreadSequence,
  getProject,
  getThread,
  getThreadEventRewriteGeneration,
  type DbConnection,
} from "@bb/db";
import {
  DEFAULT_COMPLETED_TURN_DISPLAY,
  type CompletedTurnDisplay,
  type ProviderComposerCommand,
  type Thread,
} from "@bb/domain";
import type {
  ThreadConversationOutlineItem,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import type { MainThreadCost } from "../../system/event-loop-work.js";
import type { ThreadTimelineWindowRequest } from "../thread-timeline-windows.js";
import {
  buildThreadConversationOutlineProjectionKey,
  buildThreadTimelineWithProfile,
  projectThreadConversationOutlineItems,
  resolveThreadTimelineSurface,
  type ThreadTimelineBuildProfile,
} from "../timeline.js";
import {
  buildThreadTimelineCacheKey,
  buildThreadTimelineCacheRevision,
  createThreadTimelineCache,
} from "../timeline-cache.js";
import {
  DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  shortenTimelineResponseOutputs,
} from "../timeline-output-shortening.js";
import { reuseUnchangedTimelineWindowParts } from "../timeline-window-reuse.js";
import { timelineWindowTag } from "../timeline-window-tag.js";

export interface ThreadReadProviderFacts {
  completedTurnDisplay: CompletedTurnDisplay;
  displayName: string;
  extensionStateKinds: string[];
  planCommand: ProviderComposerCommand | null;
  supportsManualCompaction: boolean;
}

export interface ThreadReadScope {
  providers: Readonly<Record<string, ThreadReadProviderFacts>>;
  rewriteGeneration: number;
  threadId: string;
}

export type ThreadReadRequest =
  | ({ kind: "conversation-outline" } & ThreadReadScope)
  | ({
      kind: "timeline-window";
      eventBudget: number;
      window: ThreadTimelineWindowRequest;
    } & ThreadReadScope);

export interface ThreadConversationOutlineReadResult {
  kind: "conversation-outline";
  outline: {
    items: ThreadConversationOutlineItem[];
    maxSeq: number;
  } | null;
}

export interface ThreadTimelineBuildCost {
  cost: MainThreadCost;
  profile: ThreadTimelineBuildProfile;
}

export interface ThreadTimelineWindowReadResult {
  kind: "timeline-window";
  window: {
    build: ThreadTimelineBuildCost | null;
    response: ThreadTimelineResponse;
  } | null;
}

export type ThreadReadResult =
  | ThreadConversationOutlineReadResult
  | ThreadTimelineWindowReadResult;

export type ThreadReadResultFor<TRequest extends ThreadReadRequest> =
  TRequest extends { kind: "conversation-outline" }
    ? ThreadConversationOutlineReadResult
    : ThreadTimelineWindowReadResult;

const CONVERSATION_OUTLINE_CACHE_MAX_ENTRIES = 128;

interface ConnectionReadCaches {
  outlines: Map<
    string,
    { key: string; items: ThreadConversationOutlineItem[] }
  >;
  timelines: ReturnType<typeof createThreadTimelineCache>;
}

const readCaches = new WeakMap<DbConnection, ConnectionReadCaches>();

function connectionReadCaches(db: DbConnection): ConnectionReadCaches {
  let caches = readCaches.get(db);
  if (caches === undefined) {
    caches = { outlines: new Map(), timelines: createThreadTimelineCache() };
    readCaches.set(db, caches);
  }
  return caches;
}

export function clearThreadReadCaches(db: DbConnection): void {
  readCaches.delete(db);
}

function findPublicThread(db: DbConnection, threadId: string): Thread | null {
  const thread = getThread(db, threadId);
  if (thread === null || thread.deletedAt !== null) return null;
  return getProject(db, thread.projectId)?.deletedAt === null ? thread : null;
}

function threadCompletedTurnDisplay(
  db: DbConnection,
  thread: Thread,
  provider: ThreadReadProviderFacts | undefined,
): CompletedTurnDisplay {
  return (
    getAppSettings(db).providerCompletedTurnDisplay[thread.providerId] ??
    provider?.completedTurnDisplay ??
    DEFAULT_COMPLETED_TURN_DISPLAY
  );
}

function readConversationOutline(
  db: DbConnection,
  request: Extract<ThreadReadRequest, { kind: "conversation-outline" }>,
): ThreadConversationOutlineReadResult {
  const thread = findPublicThread(db, request.threadId);
  if (thread === null) return { kind: "conversation-outline", outline: null };
  const provider = request.providers[thread.providerId];
  const options = {
    completedTurnDisplay: threadCompletedTurnDisplay(db, thread, provider),
    includeClearedContextHistory:
      getAppSettings(db).keepHistoryAfterContextClear,
    maxSeq: getLatestThreadSequence(db, { threadId: thread.id }),
    ...(provider === undefined
      ? {}
      : { providerDisplayName: provider.displayName }),
  };
  const outlineSequence = getLatestStoredConversationOutlineSequence(db, {
    threadId: thread.id,
  });
  const key = buildThreadConversationOutlineProjectionKey(
    thread,
    outlineSequence,
    options,
  );
  const { outlines } = connectionReadCaches(db);
  const cached = outlines.get(thread.id);
  outlines.delete(thread.id);
  if (cached !== undefined && cached.key === key) {
    outlines.set(thread.id, cached);
    return {
      kind: "conversation-outline",
      outline: { items: cached.items, maxSeq: options.maxSeq },
    };
  }
  const items = projectThreadConversationOutlineItems(db, thread, options);
  outlines.set(thread.id, { key, items });
  while (outlines.size > CONVERSATION_OUTLINE_CACHE_MAX_ENTRIES) {
    const oldest = outlines.keys().next().value;
    if (oldest === undefined) break;
    outlines.delete(oldest);
  }
  return {
    kind: "conversation-outline",
    outline: { items, maxSeq: options.maxSeq },
  };
}

function readTimelineWindow(
  db: DbConnection,
  request: Extract<ThreadReadRequest, { kind: "timeline-window" }>,
): ThreadTimelineWindowReadResult {
  const thread = findPublicThread(db, request.threadId);
  if (thread === null) return { kind: "timeline-window", window: null };
  const provider = request.providers[thread.providerId];
  const settings = getAppSettings(db);
  const { window } = request;
  const maxSeq = getLatestThreadSequence(db, { threadId: thread.id });
  const surfaceOptions = {
    compactionOfferEnabled:
      getExperiments(db).compactExpiredCache &&
      (provider?.supportsManualCompaction ?? false),
    extensionStateKinds: provider?.extensionStateKinds ?? [],
    planCommand: provider?.planCommand ?? null,
    completedTurnDisplay: threadCompletedTurnDisplay(db, thread, provider),
    deferContent: window.deferContent,
    includeClearedContextHistory: settings.keepHistoryAfterContextClear,
    includeDiagnosticOperations: settings.showDiagnosticEvents,
    includeNestedRows: window.includeNestedRows,
    maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
    providerDisplayName: provider?.displayName,
    summarizeShellCommands: settings.summarizeShellCommands,
  };
  let build: ThreadTimelineBuildCost | null = null;
  const response = connectionReadCaches(db).timelines.getOrBuild(
    thread.id,
    buildThreadTimelineCacheKey({
      threadId: thread.id,
      page: window.page,
      deferContent: window.deferContent,
      includeNestedRows: window.includeNestedRows,
    }),
    buildThreadTimelineCacheRevision({
      maxSeq,
      page: window.page,
      rewriteGeneration: getThreadEventRewriteGeneration(thread.id),
      status: thread.status,
      surface: resolveThreadTimelineSurface(db, thread, surfaceOptions)
        .cacheKey,
    }),
    (previous) => {
      const built = buildThreadTimelineWithProfile(db, thread, {
        ...surfaceOptions,
        eventBudget: request.eventBudget,
        maxSeq,
        page: window.page,
      });
      build = { cost: built.cost, profile: built.profile };
      const reused = reuseUnchangedTimelineWindowParts(
        shortenTimelineResponseOutputs(built.response, {
          maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
          preview: !window.includeNestedRows,
        }),
        previous,
      );
      return {
        expiresAt: built.expiresAt,
        response: { ...reused, tag: timelineWindowTag(reused) },
      };
    },
  );
  return { kind: "timeline-window", window: { build, response } };
}

export function runThreadRead(
  db: DbConnection,
  request: ThreadReadRequest,
): ThreadReadResult {
  adoptThreadEventRewriteGeneration(
    request.threadId,
    request.rewriteGeneration,
  );
  return db.transaction(
    () => {
      switch (request.kind) {
        case "conversation-outline":
          return readConversationOutline(db, request);
        case "timeline-window":
          return readTimelineWindow(db, request);
      }
    },
    { behavior: "deferred" },
  );
}
