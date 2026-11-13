import type { DbConnection } from "../../src/connection.js";
import {
  createPromptHistoryEntry,
  listPromptHistoryPage,
  listStoredProjectPromptHistoryRows,
  listStoredThreadPromptHistoryRows,
} from "../../src/data/prompt-history.js";
import {
  getThreadConversationOutlineRecord,
  upsertThreadConversationOutlineRecord,
} from "../../src/data/thread-conversation-outlines.js";
import {
  getThreadPluginMetadata,
  insertThreadPluginMetadata,
  listPluginThreadMetadata,
  listThreadPluginMetadataRows,
  patchThreadPluginMetadata,
} from "../../src/data/thread-plugin-metadata.js";
import {
  markThreadPruningPolicyWork,
  markThreadPruningWork,
} from "../../src/data/thread-pruning-work.js";
import {
  advanceThreadPruning,
  deleteThreadScopedPruningCursors,
  findUnprunableThreadEventSequence,
  getNextThreadPruningPolicy,
  pickThreadPruningThread,
} from "../../src/data/thread-pruning.js";
import {
  deleteThreadPurgeBatch,
  nextThreadPurge,
  requestThreadPurge,
} from "../../src/data/thread-purges.js";
import {
  createThreadSection,
  deleteThreadSection,
  getThreadSectionById,
  listThreadSections,
  renameThreadSection,
} from "../../src/data/thread-sections.js";
import {
  getStoredThreadTabs,
  replaceStoredThreadTabs,
} from "../../src/data/thread-tabs.js";
import {
  applyThreadLifecycleEvent,
  applyThreadLifecycleEventInTransaction,
  archiveThread,
  countNonDeletedAssignedChildThreads,
  countThreads,
  createThread,
  deleteThread,
  getThread,
  getThreadExecutionOverride,
  getThreadStartupContext,
  hasActiveThreadAttention,
  listActiveHostThreads,
  listActiveVisiblePinnedThreadRoots,
  listActiveVisiblePinnedThreadRootsWithPendingInteractionState,
  listArchivedThreadsPendingTeardown,
  listExistingThreadIds,
  listHostThreadIds,
  listLifecycleThreadDependents,
  listLiveThreadsInEnvironment,
  listNonDeletedChildThreads,
  listNonDeletedHiddenSourceThreads,
  listRunningThreads,
  listThreadAncestors,
  listThreadDeletionTree,
  listThreadDescendants,
  listThreadEnvironmentAssignmentsOnHost,
  listThreadMentionRowsByIds,
  listThreadsWithPendingInteractionState,
  listThreadsWithPendingInteractionStateForProjects,
  listUnarchivedAssignedChildThreads,
  markThreadDeleted,
  markThreadStorageDeleted,
  pinThread,
  reorderPinnedThread,
  searchThreadsWithPendingInteractionState,
  setThreadExecutionOverride,
  setThreadStartupContext,
  unarchiveThread,
  unpinThread,
  updateThread,
  upsertThreadSearchSegmentBatch,
  upsertThreadSearchSegments,
  type ReorderPinnedThreadArgs,
} from "../../src/data/threads.js";
import type { HistoryFixture, HistoryTurn } from "../../src/history-fixture.js";
import { noopNotifier } from "../../src/notifier.js";
import { registerCostGroup, type QueryCostCase } from "./case.js";
import {
  GITHUB_PLUGIN_ID,
  INSTALLED_PLUGIN_IDS,
  seedThreads,
  type ThreadsSeed,
} from "./threads-cases-seed.js";

const THREADS = "packages/db/src/data/threads.ts";
const SECTIONS = "packages/db/src/data/thread-sections.ts";
const TABS = "packages/db/src/data/thread-tabs.ts";
const PLUGIN_METADATA = "packages/db/src/data/thread-plugin-metadata.ts";
const OUTLINES = "packages/db/src/data/thread-conversation-outlines.ts";
const PRUNING = "packages/db/src/data/thread-pruning.ts";
const PRUNING_WORK = "packages/db/src/data/thread-pruning-work.ts";
const PURGES = "packages/db/src/data/thread-purges.ts";
const PROMPT_HISTORY = "packages/db/src/data/prompt-history.ts";
const PROMPT_HISTORY_ENTRY_LIMIT = 50;
const PROMPT_HISTORY_PAGE_MAX_LIMIT = 1_000;
const PURGE_EVENT_ROWS = 64;
const PURGE_EVENT_BYTES = 512 * 1024;
const PURGE_ROWS = 128;
const FORK_HISTORY_COPY_BATCH_ROWS = 10;
const TIMELINE_WINDOW_TURNS = 90;
const THREAD_SEARCH_LIMIT_PER_GROUP_MAX = 50;

function turnAt(fixture: HistoryFixture, index: number): HistoryTurn {
  const turn = fixture.turns.at(index);
  if (turn === undefined) throw new Error(`Expected history turn ${index}`);
  return turn;
}

function first<T>(values: readonly T[], label: string): T {
  const value = values[0];
  if (value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

function outlineItemsJson(turns: number): string {
  return JSON.stringify(
    Array.from({ length: turns * 2 }, (_, item) => ({
      id: `outline-next-${item}`,
      role: item % 2 === 0 ? "user" : "assistant",
      preview: `Turn ${item}: check the failing build, fix the cause, and rerun the targeted tests.`,
      attachmentSummary: null,
    })),
  );
}

function purgeThreadRows(db: DbConnection, threadId: string): void {
  while (
    deleteThreadPurgeBatch(db, {
      maxEventBytes: PURGE_EVENT_BYTES,
      maxEventRows: PURGE_EVENT_ROWS,
      maxRows: PURGE_ROWS,
      threadId,
    }) > 0
  );
}

let reorderArgs: Omit<ReorderPinnedThreadArgs, "db" | "notifier"> | null = null;
let nextOutlineItemsJson = "";

function requireReorderArgs(): Omit<
  ReorderPinnedThreadArgs,
  "db" | "notifier"
> {
  if (reorderArgs === null) throw new Error("Expected reorder arguments");
  return reorderArgs;
}

const THREAD_CASES: readonly QueryCostCase<ThreadsSeed>[] = [
  {
    name: `${THREADS}#upsertThreadSearchSegmentBatch`,
    run: (db, fixture, seed) =>
      upsertThreadSearchSegmentBatch(db, {
        updatedAt: Date.now(),
        segments: fixture.turns
          .slice(-FORK_HISTORY_COPY_BATCH_ROWS / 2)
          .flatMap((turn, index) => [
            {
              threadId: seed.managerRootId,
              sourceKind: "user_message" as const,
              sourceKey: `event:${turn.requestSequence}`,
              sourceSeq: turn.requestSequence,
              text: `Turn ${index}: check the failing build, fix the cause, and rerun the targeted tests.`,
            },
            {
              threadId: seed.managerRootId,
              sourceKind: "assistant_message" as const,
              sourceKey: `event:${turn.completedSequence - 1}`,
              sourceSeq: turn.completedSequence - 1,
              text: `Turn ${index}: the build passes now. I changed the failing query and reran the targeted tests.`,
            },
          ]),
      }),
  },
  {
    name: `${THREADS}#createThread`,
    run: (db, fixture, seed) =>
      createThread(db, noopNotifier, {
        projectId: fixture.projectId,
        environmentId: fixture.environmentId,
        providerId: "provider-a",
        title: "Fix flaky timeline scroll test",
        titleFallback: "Fix the flaky timeline scroll test in apps/app",
        sectionId: seed.biggestSectionId,
        pinned: true,
        status: "pending",
        parentThreadId: seed.managerRootId,
        lifecycleOwnerThreadId: seed.managerRootId,
        pluginMetadata: {
          pluginId: GITHUB_PLUGIN_ID,
          metadata: { prNumber: 9001, state: "open" },
        },
        startupContext: "Continue from the parent's plan.",
      }),
  },
  {
    name: `${THREADS}#getThread`,
    run: (db, fixture) => getThread(db, fixture.threadId),
  },
  {
    name: `${THREADS}#listThreadMentionRowsByIds`,
    run: (db, _fixture, seed) =>
      listThreadMentionRowsByIds(db, seed.mentionThreadIds),
  },
  {
    name: `${THREADS}#listActiveVisiblePinnedThreadRoots`,
    run: (db) => listActiveVisiblePinnedThreadRoots(db),
  },
  {
    name: `${THREADS}#countThreads`,
    run: (db) =>
      countThreads(db, {
        groupBy: "host",
        includeArchived: true,
        includeHidden: true,
      }),
  },
  {
    name: `${THREADS}#listRunningThreads`,
    run: (db) => listRunningThreads(db),
  },
  {
    name: `${THREADS}#listArchivedThreadsPendingTeardown`,
    run: (db) => listArchivedThreadsPendingTeardown(db),
  },
  {
    name: `${THREADS}#hasActiveThreadAttention`,
    run: (db) => hasActiveThreadAttention(db),
  },
  {
    name: `${THREADS}#listLiveThreadsInEnvironment`,
    run: (db, _fixture, seed) =>
      listLiveThreadsInEnvironment(db, {
        environmentId: seed.busiestEnvironmentId,
      }),
  },
  {
    name: `${THREADS}#listThreadEnvironmentAssignmentsOnHost`,
    run: (db, _fixture, seed) =>
      listThreadEnvironmentAssignmentsOnHost(db, {
        hostId: seed.busiestHostId,
        threadIds: seed.hostAssignmentThreadIds,
      }),
  },
  {
    name: `${THREADS}#listExistingThreadIds`,
    run: (db, _fixture, seed) =>
      listExistingThreadIds(db, seed.existingLookupIds),
  },
  {
    name: `${THREADS}#listHostThreadIds`,
    run: (db, _fixture, seed) =>
      listHostThreadIds(db, { hostId: seed.busiestHostId }),
  },
  {
    name: `${THREADS}#listActiveHostThreads`,
    run: (db, _fixture, seed) =>
      listActiveHostThreads(db, { hostId: seed.busiestHostId }),
  },
  {
    name: `${THREADS}#pinThread`,
    run: (db, _fixture, seed) =>
      pinThread(db, noopNotifier, { threadId: seed.unpinnedLiveThreadId }),
  },
  {
    name: `${THREADS}#unpinThread`,
    run: (db, _fixture, seed) =>
      unpinThread(db, noopNotifier, {
        threadId: first(seed.pinnedThreadIds, "a pinned thread"),
      }),
  },
  {
    name: `${THREADS}#reorderPinnedThread`,
    prepare: (db) => {
      const roots = listActiveVisiblePinnedThreadRoots(db);
      const moved = roots.at(-1);
      const head = roots[0];
      if (moved === undefined || head === undefined || moved === head) {
        throw new Error("Expected at least two pinned roots");
      }
      reorderArgs = {
        threadId: moved.id,
        previousThreadId: null,
        nextThreadId: head.id,
      };
    },
    run: (db) =>
      reorderPinnedThread({
        db,
        notifier: noopNotifier,
        ...requireReorderArgs(),
      }),
  },
  {
    name: `${THREADS}#updateThread`,
    run: (db, fixture, seed) =>
      updateThread(db, noopNotifier, fixture.threadId, {
        title: "Make the query cost check catch history growth",
        sectionId: seed.biggestSectionId,
        lastReadAt: Date.now(),
      }),
  },
  {
    name: `${THREADS}#getThreadExecutionOverride`,
    run: (db, fixture) => getThreadExecutionOverride(db, fixture.threadId),
  },
  {
    name: `${THREADS}#setThreadExecutionOverride`,
    run: (db, fixture) =>
      setThreadExecutionOverride(db, {
        threadId: fixture.threadId,
        modelOverride: "gpt-5",
        reasoningLevelOverride: "high",
      }),
  },
  {
    name: `${THREADS}#setThreadStartupContext`,
    run: (db, fixture) =>
      setThreadStartupContext(db, {
        threadId: fixture.threadId,
        startupContext: "Resume from the last completed turn.",
      }),
  },
  {
    name: `${THREADS}#getThreadStartupContext`,
    run: (db, fixture) => getThreadStartupContext(db, fixture.threadId),
  },
  {
    name: `${THREADS}#deleteThread`,
    prepare: (db, _fixture, seed) =>
      purgeThreadRows(db, seed.deletedPurgeThreadId),
    run: (db, _fixture, seed) =>
      deleteThread(db, noopNotifier, seed.deletedPurgeThreadId),
  },
  {
    name: `${THREADS}#listThreadAncestors`,
    run: (db, _fixture, seed) => listThreadAncestors(db, seed.chainLeafIds),
  },
  {
    name: `${THREADS}#listThreadDescendants`,
    run: (db, _fixture, seed) =>
      listThreadDescendants(db, seed.descendantRootIds, {
        includeArchived: false,
        includeHidden: false,
      }),
  },
  {
    name: `${THREADS}#listLifecycleThreadDependents`,
    run: (db, _fixture, seed) =>
      listLifecycleThreadDependents(db, seed.managerRootId),
  },
  {
    name: `${THREADS}#listThreadDeletionTree`,
    run: (db, _fixture, seed) =>
      listThreadDeletionTree(db, seed.orchestratorId),
  },
  {
    name: `${THREADS}#markThreadDeleted`,
    run: (db, _fixture, seed) =>
      markThreadDeleted(db, noopNotifier, { threadId: seed.orchestratorId }),
  },
  {
    name: `${THREADS}#markThreadStorageDeleted`,
    run: (db, _fixture, seed) =>
      markThreadStorageDeleted(db, { threadId: seed.deletedPurgeThreadId }),
  },
  {
    name: `${THREADS}#archiveThread`,
    run: (db, _fixture, seed) =>
      archiveThread(db, noopNotifier, seed.managerRootId),
  },
  {
    name: `${THREADS}#unarchiveThread`,
    run: (db, _fixture, seed) =>
      unarchiveThread(db, noopNotifier, seed.archivedRootId),
  },
  {
    name: `${THREADS}#applyThreadLifecycleEventInTransaction`,
    run: (db, _fixture, seed) =>
      db.transaction((tx) =>
        applyThreadLifecycleEventInTransaction(tx, {
          threadId: seed.idleThreadId,
          event: { type: "run.preparing" },
        }),
      ),
  },
];

const THREAD_LISTING_CASES: readonly QueryCostCase<ThreadsSeed>[] = [
  {
    name: `${THREADS}#upsertThreadSearchSegments`,
    run: (db, fixture) =>
      upsertThreadSearchSegments(db, {
        updatedAt: Date.now(),
        segments: [
          {
            threadId: fixture.threadId,
            sourceKind: "user_message",
            sourceKey: `event:${fixture.latestSequence + 1}`,
            sourceSeq: fixture.latestSequence + 1,
            text: "Then rerun the targeted tests and update the docs.",
          },
        ],
      }),
  },
  {
    name: `${THREADS}#searchThreadsWithPendingInteractionState`,
    run: (db) =>
      searchThreadsWithPendingInteractionState(db, {
        query: "tests",
        limitPerGroup: THREAD_SEARCH_LIMIT_PER_GROUP_MAX,
      }),
  },
  {
    name: `${THREADS}#listThreadsWithPendingInteractionStateForProjects`,
    run: (db, _fixture, seed) =>
      listThreadsWithPendingInteractionStateForProjects(db, {
        projectIds: seed.projectIds,
        archived: false,
      }),
  },
  {
    name: `${THREADS}#listThreadsWithPendingInteractionState`,
    run: (db, _fixture, seed) =>
      listThreadsWithPendingInteractionState(db, {
        hostId: seed.busiestHostId,
        archived: false,
        includeHidden: false,
      }),
  },
  {
    name: `${THREADS}#listActiveVisiblePinnedThreadRootsWithPendingInteractionState`,
    run: (db) =>
      listActiveVisiblePinnedThreadRootsWithPendingInteractionState(db),
  },
  {
    name: `${THREADS}#countNonDeletedAssignedChildThreads`,
    run: (db, _fixture, seed) =>
      countNonDeletedAssignedChildThreads(db, {
        parentThreadId: seed.orchestratorId,
      }),
  },
  {
    name: `${THREADS}#listUnarchivedAssignedChildThreads`,
    run: (db, _fixture, seed) =>
      listUnarchivedAssignedChildThreads(db, {
        parentThreadId: seed.orchestratorId,
      }),
  },
  {
    name: `${THREADS}#listNonDeletedChildThreads`,
    run: (db, _fixture, seed) =>
      listNonDeletedChildThreads(db, { parentThreadId: seed.orchestratorId }),
  },
  {
    name: `${THREADS}#listNonDeletedHiddenSourceThreads`,
    run: (db, _fixture, seed) =>
      listNonDeletedHiddenSourceThreads(db, {
        sourceThreadId: seed.managerRootId,
      }),
  },
  {
    name: `${THREADS}#applyThreadLifecycleEvent`,
    run: (db, _fixture, seed) =>
      applyThreadLifecycleEvent(db, {
        threadId: seed.idleThreadId,
        event: { type: "run.preparing" },
      }),
  },
];

const SECTION_CASES: readonly QueryCostCase<ThreadsSeed>[] = [
  {
    name: `${SECTIONS}#getThreadSectionById`,
    run: (db, _fixture, seed) =>
      getThreadSectionById(db, seed.biggestSectionId),
  },
  {
    name: `${SECTIONS}#listThreadSections`,
    run: (db) => listThreadSections(db),
  },
  {
    name: `${SECTIONS}#createThreadSection`,
    run: (db) =>
      createThreadSection(db, noopNotifier, { name: "Release blockers" }),
  },
  {
    name: `${SECTIONS}#renameThreadSection`,
    run: (db, _fixture, seed) =>
      renameThreadSection(db, noopNotifier, {
        id: seed.biggestSectionId,
        name: "Ship before Friday",
      }),
  },
  {
    name: `${SECTIONS}#deleteThreadSection`,
    run: (db, _fixture, seed) =>
      deleteThreadSection(db, noopNotifier, { id: seed.biggestSectionId }),
  },
];

const TAB_CASES: readonly QueryCostCase<ThreadsSeed>[] = [
  {
    name: `${TABS}#getStoredThreadTabs`,
    run: (db, _fixture, seed) => getStoredThreadTabs(db, seed.tabsThreadId),
  },
  {
    name: `${TABS}#replaceStoredThreadTabs`,
    run: (db, _fixture, seed) =>
      replaceStoredThreadTabs(db, {
        expectedRevision: seed.tabsRevision,
        threadId: seed.tabsThreadId,
        tabsJson: JSON.stringify({
          activeTabId: "tab-review",
          tabs: [
            { id: "tab-timeline", kind: "timeline" },
            {
              id: "tab-review",
              kind: "diff",
              path: "packages/db/src/data/threads.ts",
            },
          ],
        }),
      }),
  },
];

const PLUGIN_METADATA_CASES: readonly QueryCostCase<ThreadsSeed>[] = [
  {
    name: `${PLUGIN_METADATA}#getThreadPluginMetadata`,
    run: (db, _fixture, seed) =>
      getThreadPluginMetadata(
        db,
        seed.pluginMetadataThreadId,
        GITHUB_PLUGIN_ID,
      ),
  },
  {
    name: `${PLUGIN_METADATA}#listThreadPluginMetadataRows`,
    run: (db, _fixture, seed) =>
      listThreadPluginMetadataRows(
        db,
        seed.pluginMetadataThreadId,
        INSTALLED_PLUGIN_IDS,
      ),
  },
  {
    name: `${PLUGIN_METADATA}#listPluginThreadMetadata`,
    run: (db, _fixture, seed) =>
      listPluginThreadMetadata(
        db,
        GITHUB_PLUGIN_ID,
        seed.pluginMetadataThreadIds,
      ),
  },
  {
    name: `${PLUGIN_METADATA}#insertThreadPluginMetadata`,
    run: (db, _fixture, seed) =>
      insertThreadPluginMetadata(db, {
        threadId: seed.pluginMetadataThreadId,
        pluginId: "browser-automation",
        metadata: { sessionId: "browser-1", url: "http://localhost:5173" },
      }),
  },
  {
    name: `${PLUGIN_METADATA}#patchThreadPluginMetadata`,
    run: (db, _fixture, seed) =>
      patchThreadPluginMetadata(db, {
        threadId: seed.pluginMetadataThreadId,
        pluginId: GITHUB_PLUGIN_ID,
        set: { state: "merged", mergedAt: Date.now() },
        remove: ["checks"],
      }),
  },
];

const OUTLINE_CASES: readonly QueryCostCase<ThreadsSeed>[] = [
  {
    name: `${OUTLINES}#getThreadConversationOutlineRecord`,
    run: (db, fixture) =>
      getThreadConversationOutlineRecord(db, fixture.threadId),
  },
  {
    name: `${OUTLINES}#upsertThreadConversationOutlineRecord`,
    prepare: (_db, fixture) => {
      nextOutlineItemsJson = outlineItemsJson(fixture.turns.length + 1);
    },
    run: (db, fixture) =>
      upsertThreadConversationOutlineRecord(db, {
        threadId: fixture.threadId,
        projectionKey: `v3:${fixture.latestSequence + 1}`,
        itemsJson: nextOutlineItemsJson,
      }),
  },
];

const PRUNING_CASES: readonly QueryCostCase<ThreadsSeed>[] = [
  {
    name: `${PRUNING}#getNextThreadPruningPolicy`,
    run: (db) => getNextThreadPruningPolicy(db, new Set()),
  },
  {
    name: `${PRUNING}#pickThreadPruningThread`,
    run: (db) =>
      pickThreadPruningThread(db, {
        excludedThreadIds: new Set(),
        policy: "resolved-items",
      }),
  },
  {
    name: `${PRUNING}#findUnprunableThreadEventSequence`,
    run: (db, fixture) =>
      findUnprunableThreadEventSequence(db, {
        threadId: fixture.threadId,
        sequenceStart: turnAt(fixture, -TIMELINE_WINDOW_TURNS).requestSequence,
        beforeSequence: fixture.latestSequence + 1,
      }),
  },
  {
    name: `${PRUNING}#advanceThreadPruning`,
    run: (db, fixture) =>
      advanceThreadPruning(db, { threadId: fixture.threadId }),
  },
  {
    name: `${PRUNING}#deleteThreadScopedPruningCursors`,
    run: (db, _fixture, seed) =>
      deleteThreadScopedPruningCursors(db, seed.scopedCursorThreadId),
  },
  {
    name: `${PRUNING_WORK}#markThreadPruningWork`,
    run: (db, fixture) =>
      markThreadPruningWork(db, [
        fixture.threadId,
        ...fixture.neighborThreadIds,
      ]),
  },
  {
    name: `${PRUNING_WORK}#markThreadPruningPolicyWork`,
    run: (db, _fixture, seed) =>
      markThreadPruningPolicyWork(db, seed.archiveTreeIds, "rate-limits"),
  },
];

const PURGE_CASES: readonly QueryCostCase<ThreadsSeed>[] = [
  {
    name: `${PURGES}#requestThreadPurge`,
    run: (db, _fixture, seed) =>
      requestThreadPurge(db, { now: Date.now(), threadId: seed.managerRootId }),
  },
  {
    name: `${PURGES}#nextThreadPurge`,
    run: (db) => nextThreadPurge(db, { excludedThreadIds: new Set() }),
  },
  {
    name: `${PURGES}#deleteThreadPurgeBatch`,
    run: (db, fixture) =>
      db.transaction((tx) =>
        deleteThreadPurgeBatch(tx, {
          maxEventBytes: PURGE_EVENT_BYTES,
          maxEventRows: PURGE_EVENT_ROWS,
          maxRows: PURGE_ROWS,
          threadId: fixture.threadId,
        }),
      ),
  },
];

const PROMPT_HISTORY_CASES: readonly QueryCostCase<ThreadsSeed>[] = [
  {
    name: `${PROMPT_HISTORY}#createPromptHistoryEntry`,
    run: (db, fixture) =>
      createPromptHistoryEntry(db, {
        projectId: fixture.projectId,
        threadId: fixture.threadId,
        scope: "thread",
        requestSequence: fixture.latestSequence,
        input: [{ type: "text", text: "Then update the docs.", mentions: [] }],
      }),
  },
  {
    name: `${PROMPT_HISTORY}#listStoredProjectPromptHistoryRows`,
    run: (db, _fixture, seed) =>
      listStoredProjectPromptHistoryRows(db, {
        projectId: seed.busiestProjectId,
        limit: PROMPT_HISTORY_ENTRY_LIMIT,
      }),
  },
  {
    name: `${PROMPT_HISTORY}#listStoredThreadPromptHistoryRows`,
    run: (db, fixture) =>
      listStoredThreadPromptHistoryRows(db, {
        threadId: fixture.threadId,
        limit: PROMPT_HISTORY_ENTRY_LIMIT,
      }),
  },
  {
    name: `${PROMPT_HISTORY}#listPromptHistoryPage`,
    run: (db, _fixture, seed) =>
      listPromptHistoryPage(db, {
        before: seed.promptHistoryCursor,
        limit: PROMPT_HISTORY_PAGE_MAX_LIMIT + 1,
      }),
  },
];

export const THREADS_COST_GROUP = registerCostGroup<ThreadsSeed>({
  name: "threads",
  seed: seedThreads,
  cases: [
    ...THREAD_CASES,
    ...THREAD_LISTING_CASES,
    ...SECTION_CASES,
    ...TAB_CASES,
    ...PLUGIN_METADATA_CASES,
    ...OUTLINE_CASES,
    ...PRUNING_CASES,
    ...PURGE_CASES,
    ...PROMPT_HISTORY_CASES,
  ],
});
