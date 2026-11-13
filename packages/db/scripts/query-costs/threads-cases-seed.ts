import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type JsonObject,
  type PromptHistoryScope,
  type ThreadStatus,
} from "@bb/domain";
import { sql } from "drizzle-orm";
import type { DbConnection } from "../../src/connection.js";
import { createEnvironment } from "../../src/data/environments.js";
import {
  appendStoredThreadEventsInTransaction,
  type AppendStoredThreadEventArgs,
} from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createPromptHistoryEntry } from "../../src/data/prompt-history.js";
import { createTerminalSession } from "../../src/data/terminal-sessions.js";
import { upsertThreadConversationOutlineRecord } from "../../src/data/thread-conversation-outlines.js";
import { createPromptHistoryEntryId, createThreadId } from "../../src/ids.js";
import { insertThreadPluginMetadata } from "../../src/data/thread-plugin-metadata.js";
import {
  advanceThreadPruning,
  pickThreadPruningThread,
  THREAD_PRUNING_POLICIES,
} from "../../src/data/thread-pruning.js";
import { requestThreadPurge } from "../../src/data/thread-purges.js";
import { createThreadSection } from "../../src/data/thread-sections.js";
import { replaceStoredThreadTabs } from "../../src/data/thread-tabs.js";
import {
  archiveThread,
  createThread,
  pinThread,
  upsertThreadSearchSegmentBatch,
  type UpsertThreadSearchSegmentInput,
} from "../../src/data/threads.js";
import type { HistoryFixture } from "../../src/history-fixture.js";
import { noopNotifier } from "../../src/notifier.js";
import { scaled } from "./case.js";

const THREADS = 10_000;
const ORCHESTRATOR_CHILDREN = 300;
const WORKTREE_ENVIRONMENTS = 2_000;
const THREAD_TABS = 7_000;
const PROMPT_HISTORY_ENTRIES = 50_000;
const RUNNING_THREADS = 8;
const STARTING_THREADS = 3;
const ARCHIVED_TEARDOWN_THREADS = 4;
const ARCHIVED_TERMINAL_SESSIONS = 6;
const GROUP_SIZE = 20;
const ARCHIVED_GROUP_SHARE = 0.55;
const SECTIONS = 20;
const ROOT_SLOT = 0;
const OWNED_HELPER_SLOT = 1;
const FAN_OUT_SLOTS = [1, 2, 3, 4, 5];
const CHAIN_START_SLOT = 6;
const CHAIN_END_SLOT = 11;
const FORK_SLOT = 12;
const PINNED_SLOT = 13;
const SECTIONED_SLOTS = [13, 14, 15];
const LIVE_GROUP_DELETED_SLOT = 16;
const LIVE_GROUP_ARCHIVED_SLOTS = [17, 18, 19];
const ARCHIVED_GROUP_DELETED_SLOTS = [18, 19];
const THREAD_SPACING_MS = 30 * 60_000;
const BATCH_THREADS = 400;
const BULK_ROWS = 2_000;
const DAY_MS = 24 * 60 * 60_000;
const REQUEST_ID_BASE = 50_000_000;
const SYNTHETIC_REQUEST_SEQUENCE_BASE = 1_000_000;
const PROJECT_WEIGHTS = [40, 15, 10, 8, 7, 6, 5, 4, 3, 2];
const PROJECT_HOSTS = [0, 0, 0, 0, 1, 0, 2, 0, 1, 0];
const PROVIDERS = ["provider-a", "provider-b", "provider-a", "provider-c", "provider-b"];
export const GITHUB_PLUGIN_ID = "github-pr-status";
export const LINEAR_PLUGIN_ID = "linear";
export const INSTALLED_PLUGIN_IDS = [
  GITHUB_PLUGIN_ID,
  LINEAR_PLUGIN_ID,
  "browser-automation",
  "git",
  "docs",
  "tasks",
  "composer",
  "environment-git-worktree",
];
const VERBS = [
  "Fix",
  "Investigate",
  "Refactor",
  "Speed up",
  "Add tests for",
  "Document",
  "Remove",
  "Migrate",
];
const SUBJECTS = [
  "flaky timeline scroll test",
  "sidebar thread search ranking",
  "query plan regression in events",
  "worktree cleanup on archive",
  "prompt history pagination",
  "plugin metadata patch route",
  "Connect tunnel reconnect loop",
  "desktop auto-update relaunch",
  "pinned thread reorder drag",
  "provider retry after overload",
  "composer attachment upload",
  "markdown editor focus loss",
];
const AREAS = [
  "apps/server",
  "packages/db",
  "apps/app",
  "the daemon",
  "the plugin SDK",
];

interface ThreadSpec {
  id: string | null;
  index: number;
  group: number;
  slot: number;
  projectIndex: number;
  environmentId: string | null;
  providerId: string;
  title: string | null;
  titleFallback: string;
  sectionId: string | null;
  status: ThreadStatus;
  parentIndex: number | null;
  ownerIndex: number | null;
  fork: boolean;
  hidden: boolean;
  pinned: boolean;
  archived: boolean;
  deleted: boolean;
  purge: boolean;
  turns: number;
  pluginMetadata: { pluginId: string; metadata: JsonObject } | null;
}

interface SeededThread {
  id: string;
  spec: ThreadSpec;
  requestSequences: number[];
}

export interface ThreadsSeed {
  projectIds: string[];
  busiestProjectId: string;
  busiestHostId: string;
  busiestEnvironmentId: string;
  biggestSectionId: string;
  sectionIds: string[];
  orchestratorId: string;
  managerRootId: string;
  archivedRootId: string;
  idleThreadId: string;
  unpinnedLiveThreadId: string;
  pinnedThreadIds: string[];
  chainLeafIds: string[];
  descendantRootIds: string[];
  mentionThreadIds: string[];
  existingLookupIds: string[];
  hostAssignmentThreadIds: string[];
  deletedPurgeThreadId: string;
  purgeThreadIds: string[];
  tabsThreadId: string;
  tabsRevision: number;
  pluginMetadataThreadIds: string[];
  pluginMetadataThreadId: string;
  scopedCursorThreadId: string;
  archiveTreeIds: string[];
  promptHistoryCursor: {
    createdAt: number;
    requestSequence: number;
    id: string;
  };
  liveThreadCount: number;
  threadCount: number;
  searchSegmentCount: number;
  promptHistoryCount: number;
}

function pick<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length];
  if (value === undefined) throw new Error("Expected a value to pick");
  return value;
}

function weightedProjectIndex(group: number): number {
  const total = PROJECT_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  let slot = (group * 37) % total;
  for (const [index, weight] of PROJECT_WEIGHTS.entries()) {
    if (slot < weight) return index;
    slot -= weight;
  }
  return 0;
}

function titleFor(index: number): string {
  return `${pick(VERBS, index)} ${pick(SUBJECTS, index * 7 + 3)}`;
}

function promptFor(index: number, turn: number): string {
  return `${pick(VERBS, index + turn)} the ${pick(SUBJECTS, index * 7 + 3 + turn)} in ${pick(AREAS, index + turn)}. Reproduce it first, then fix the cause and rerun the targeted tests before you report back.`;
}

function replyFor(index: number, turn: number): string {
  return `I traced the ${pick(SUBJECTS, index * 7 + 3 + turn)} to a stale cache in ${pick(AREAS, index + turn)}. The fix keeps one source of truth, and the targeted tests pass now.`;
}

function buildSpecs(
  scale: number,
  environmentIdsByProject: readonly (readonly string[])[],
  sectionIds: readonly string[],
): ThreadSpec[] {
  const total = scaled(THREADS, scale);
  const orchestratorChildren = scaled(ORCHESTRATOR_CHILDREN, scale);
  const groups = Math.floor((total - orchestratorChildren) / GROUP_SIZE);
  const archivedGroups = Math.floor(groups * ARCHIVED_GROUP_SHARE);
  const specs: ThreadSpec[] = [];
  const environmentFor = (projectIndex: number, index: number) => {
    const environments = environmentIdsByProject[projectIndex];
    if (environments === undefined) throw new Error("Expected environments");
    return index % 4 === 0
      ? pick(environments, 0)
      : pick(
          environments,
          1 + (Math.floor(index / 4) % (environments.length - 1)),
        );
  };
  const base = (
    index: number,
    group: number,
    slot: number,
    projectIndex: number,
  ): ThreadSpec => ({
    id: createThreadId(),
    index,
    group,
    slot,
    projectIndex,
    environmentId: environmentFor(projectIndex, index),
    providerId: pick(PROVIDERS, index),
    title: index % 10 < 7 ? titleFor(index) : null,
    titleFallback: promptFor(index, 0).slice(0, 80),
    sectionId: null,
    status: "idle",
    parentIndex: null,
    ownerIndex: null,
    fork: false,
    hidden: false,
    pinned: false,
    archived: false,
    deleted: false,
    purge: false,
    turns: 1 + (index % 4 === 0 ? 1 : 0),
    pluginMetadata:
      index % 10 === 3
        ? {
            pluginId: GITHUB_PLUGIN_ID,
            metadata: {
              prNumber: 7000 + index,
              url: `https://github.com/get-bb/bb/pull/${7000 + index}`,
              state: index % 4 === 0 ? "merged" : "open",
              checks: "passing",
            },
          }
        : null,
  });
  for (let group = 0; group < groups; group += 1) {
    const projectIndex = weightedProjectIndex(group);
    const archivedGroup = group < archivedGroups;
    const rootIndex = group * GROUP_SIZE;
    for (let slot = 0; slot < GROUP_SIZE; slot += 1) {
      const index = rootIndex + slot;
      const spec = base(index, group, slot, projectIndex);
      if (FAN_OUT_SLOTS.includes(slot)) spec.parentIndex = rootIndex;
      if (slot === OWNED_HELPER_SLOT) {
        spec.ownerIndex = rootIndex;
        spec.hidden = true;
      }
      if (slot >= CHAIN_START_SLOT && slot <= CHAIN_END_SLOT) {
        const parentIndex = slot === CHAIN_START_SLOT ? rootIndex : index - 1;
        spec.parentIndex = parentIndex;
        spec.ownerIndex = parentIndex;
      }
      if (slot === FORK_SLOT) {
        spec.parentIndex = rootIndex;
        spec.fork = true;
        spec.hidden = group % 2 === 0;
      }
      if (SECTIONED_SLOTS.includes(slot)) {
        spec.sectionId = pick(sectionIds, group % 7 === 0 ? 0 : group);
      }
      if (archivedGroup) {
        spec.archived = true;
        spec.deleted =
          group % 2 === 0 && ARCHIVED_GROUP_DELETED_SLOTS.includes(slot);
        spec.pinned = slot === PINNED_SLOT && group % 10 === 0;
      } else {
        spec.archived = LIVE_GROUP_ARCHIVED_SLOTS.includes(slot);
        spec.deleted = slot === LIVE_GROUP_DELETED_SLOT && group % 3 === 0;
        spec.pinned =
          (slot === PINNED_SLOT && group % 8 === 0) ||
          (group % 16 === 0 && (slot === ROOT_SLOT || slot === 2));
      }
      spec.purge = spec.deleted && group % 4 < 2;
      specs.push(spec);
    }
  }
  const orchestrator = specs.at(-GROUP_SIZE);
  if (orchestrator === undefined) throw new Error("Expected an orchestrator");
  for (let child = 0; child < orchestratorChildren; child += 1) {
    const index = specs.length;
    const spec = base(
      index,
      groups,
      GROUP_SIZE + child,
      orchestrator.projectIndex,
    );
    spec.id = null;
    spec.environmentId = orchestrator.environmentId;
    spec.parentIndex = child % 10 === 9 ? index - 1 : orchestrator.index;
    spec.archived = child % 10 < 7;
    specs.push(spec);
  }
  assignStatuses(specs);
  return specs;
}

function assignStatuses(specs: ThreadSpec[]): void {
  const scale = specs.length / THREADS;
  const live = specs.filter((spec) => !spec.archived && !spec.deleted);
  const newestLive = [...live].reverse();
  let cursor = 0;
  const take = (count: number, status: ThreadStatus) => {
    for (let taken = 0; taken < count; taken += 1) {
      const spec = newestLive[cursor];
      cursor += 1;
      if (spec !== undefined && spec.slot !== ROOT_SLOT) spec.status = status;
    }
  };
  take(scaled(RUNNING_THREADS, scale), "active");
  take(scaled(STARTING_THREADS, scale), "starting");
  take(2, "stopping");
  for (const spec of live) {
    if (spec.index % 97 === 5) spec.status = "error";
    if (spec.index % 211 === 7 && spec.slot !== ROOT_SLOT) {
      spec.status = "pending";
      spec.environmentId = null;
      spec.turns = 0;
    }
  }
  const archived = specs.filter(
    (spec) => spec.archived && !spec.deleted && spec.slot >= 13,
  );
  for (
    let index = 0;
    index < scaled(ARCHIVED_TEARDOWN_THREADS, scale);
    index += 1
  ) {
    const spec = archived[archived.length - 1 - index * 3];
    if (spec !== undefined)
      spec.status = index % 2 === 0 ? "active" : "stopping";
  }
}

interface SeedPlace {
  hostIds: string[];
  projectIds: string[];
  environmentIdsByProject: string[][];
}

interface ThreadTimes {
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
}

function seedPlaces(
  db: DbConnection,
  fixture: HistoryFixture,
  scale: number,
): SeedPlace {
  const hostIds = [
    fixture.hostId,
    upsertHost(db, noopNotifier, { name: "threads-remote" }).id,
    upsertHost(db, noopNotifier, { name: "threads-cloud" }).id,
  ];
  const projectIds = [fixture.projectId];
  for (let index = 1; index < PROJECT_WEIGHTS.length; index += 1) {
    const { project } = createProject(db, noopNotifier, {
      name: `threads-project-${index}`,
      source: {
        type: "local_path",
        hostId: pick(hostIds, pick(PROJECT_HOSTS, index)),
        path: `/workspace/project-${index}`,
      },
    });
    projectIds.push(project.id);
  }
  const worktreesPerProject = PROJECT_WEIGHTS.map((weight) =>
    Math.max(
      2,
      Math.round((scaled(WORKTREE_ENVIRONMENTS, scale) * weight) / 100),
    ),
  );
  const environmentIdsByProject = db.transaction((tx) =>
    projectIds.map((projectId, projectIndex) => {
      const hostId = pick(hostIds, pick(PROJECT_HOSTS, projectIndex));
      const main =
        projectIndex === 0
          ? fixture.environmentId
          : createEnvironment(tx, noopNotifier, {
              projectId,
              hostId,
              path: `/workspace/project-${projectIndex}`,
              providerOwnsPath: false,
              isGitRepo: true,
              status: "ready",
            }).id;
      const ids = [main];
      const worktrees = worktreesPerProject[projectIndex] ?? 2;
      for (let worktree = 0; worktree < worktrees; worktree += 1) {
        ids.push(
          createEnvironment(tx, noopNotifier, {
            projectId,
            hostId,
            path: `/worktrees/project-${projectIndex}/wt-${worktree}`,
            providerOwnsPath: true,
            isGitRepo: true,
            branchName: `bb/wt-${worktree}`,
            status: worktree % 5 === 0 ? "destroyed" : "ready",
          }).id,
        );
      }
      return ids;
    }),
  );
  return { hostIds, projectIds, environmentIdsByProject };
}

function seedSections(db: DbConnection): string[] {
  const ids: string[] = [];
  for (let index = 0; index < SECTIONS; index += 1) {
    const result = createThreadSection(db, noopNotifier, {
      name: `${pick(VERBS, index)} backlog ${index}`,
    });
    ids.push(result.section.id);
  }
  return ids;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size));
  }
  return result;
}

function timesFor(
  spec: ThreadSpec,
  firstCreatedAt: number,
  now: number,
): ThreadTimes {
  const createdAt = firstCreatedAt + spec.index * THREAD_SPACING_MS;
  const updatedAt = createdAt + spec.turns * 10 * 60_000;
  const archivedAt = spec.archived
    ? Math.min(now, updatedAt + 2 * DAY_MS)
    : null;
  return {
    createdAt,
    updatedAt,
    archivedAt,
    deletedAt:
      spec.deleted && archivedAt !== null
        ? Math.min(now, archivedAt + DAY_MS)
        : null,
  };
}

function titleSegments(
  threadId: string,
  spec: ThreadSpec,
): UpsertThreadSearchSegmentInput[] {
  return [
    {
      threadId,
      sourceKind: "title",
      sourceKey: "title",
      sourceSeq: null,
      text: spec.title ?? "",
    },
    {
      threadId,
      sourceKind: "title_fallback",
      sourceKey: "title_fallback",
      sourceSeq: null,
      text: spec.titleFallback,
    },
  ];
}

function insertBulkThreads(
  db: DbConnection,
  specs: readonly ThreadSpec[],
  projectIds: readonly string[],
  firstCreatedAt: number,
): void {
  const now = Date.now();
  const idOf = (index: number | null) =>
    index === null ? null : (specs[index]?.id ?? null);
  const rows = specs.flatMap((spec) => {
    if (spec.id === null) return [];
    const times = timesFor(spec, firstCreatedAt, now);
    const parentId = idOf(spec.parentIndex);
    return [
      {
        id: spec.id,
        projectId: pick(projectIds, spec.projectIndex),
        environmentId: spec.environmentId,
        providerId: spec.providerId,
        title: spec.title,
        titleFallback: spec.titleFallback,
        sectionId: spec.sectionId,
        status: spec.status,
        startupContext:
          spec.status === "starting" ? "Resume the migration." : null,
        parentThreadId: spec.fork ? null : parentId,
        sourceThreadId: spec.fork ? parentId : null,
        lifecycleOwnerThreadId: idOf(spec.ownerIndex),
        originKind: spec.fork ? "fork" : null,
        visibility: spec.hidden ? "hidden" : "visible",
        ...times,
      },
    ];
  });
  db.transaction(() => {
    for (const chunk of chunks(rows, BULK_ROWS)) {
      db.run(sql`INSERT INTO threads (
          id, project_id, environment_id, provider_id, title, title_fallback,
          section_id, status, status_changed_at, startup_context,
          parent_thread_id, source_thread_id, lifecycle_owner_thread_id,
          origin_kind, visibility, parent_notifications, archived_at,
          deleted_at, last_read_at, latest_attention_at, created_at, updated_at
        )
        SELECT
          row.value ->> '$.id', row.value ->> '$.projectId',
          row.value ->> '$.environmentId', row.value ->> '$.providerId',
          row.value ->> '$.title', row.value ->> '$.titleFallback',
          row.value ->> '$.sectionId', row.value ->> '$.status',
          row.value ->> '$.updatedAt', row.value ->> '$.startupContext',
          row.value ->> '$.parentThreadId', row.value ->> '$.sourceThreadId',
          row.value ->> '$.lifecycleOwnerThreadId', row.value ->> '$.originKind',
          row.value ->> '$.visibility', 'auto', row.value ->> '$.archivedAt',
          row.value ->> '$.deletedAt', row.value ->> '$.updatedAt',
          row.value ->> '$.updatedAt', row.value ->> '$.createdAt',
          row.value ->> '$.updatedAt'
        FROM json_each(${JSON.stringify(chunk)}) AS row
        ORDER BY row.key`);
    }
    const segments = specs.flatMap((spec) =>
      spec.id === null ? [] : titleSegments(spec.id, spec),
    );
    for (const chunk of chunks(segments, BULK_ROWS)) {
      upsertThreadSearchSegmentBatch(db, { segments: chunk, updatedAt: now });
    }
    for (const spec of specs) {
      if (spec.id === null || spec.pluginMetadata === null) continue;
      insertThreadPluginMetadata(db, {
        threadId: spec.id,
        pluginId: spec.pluginMetadata.pluginId,
        metadata: spec.pluginMetadata.metadata,
      });
    }
  });
}

function createRealThreads(
  db: DbConnection,
  specs: ThreadSpec[],
  projectIds: readonly string[],
): void {
  db.transaction(() => {
    for (const spec of specs) {
      if (spec.id !== null) continue;
      const parent =
        spec.parentIndex === null ? undefined : specs[spec.parentIndex];
      const owner =
        spec.ownerIndex === null ? undefined : specs[spec.ownerIndex];
      const thread = createThread(db, noopNotifier, {
        projectId: pick(projectIds, spec.projectIndex),
        environmentId: spec.environmentId,
        providerId: spec.providerId,
        title: spec.title,
        titleFallback: spec.titleFallback,
        sectionId: spec.sectionId,
        status: spec.status,
        parentThreadId: parent?.id ?? null,
        lifecycleOwnerThreadId: owner?.id ?? null,
        visibility: spec.hidden ? "hidden" : "visible",
        pluginMetadata: spec.pluginMetadata,
      });
      spec.id = thread.id;
    }
  });
}

function seededThreads(specs: readonly ThreadSpec[]): SeededThread[] {
  return specs.map((spec) => {
    if (spec.id === null) throw new Error("Expected every thread to exist");
    return { id: spec.id, spec, requestSequences: [] };
  });
}

function turnEvents(
  threadId: string,
  index: number,
  turn: number,
  requestNumber: number,
): AppendStoredThreadEventArgs[] {
  const providerThreadId = `threads-provider-${index}`;
  const turnId = `threads-${index}-t${turn}`;
  const scope = turnScope(turnId);
  const requestId = encodeClientTurnRequestIdNumber({ value: requestNumber });
  const agentMessageId = `${turnId}-agent`;
  return [
    {
      threadId,
      scope: threadScope(),
      type: "client/turn/requested",
      data: {
        direction: "outbound",
        source: "tell",
        initiator: "user",
        senderThreadId: null,
        requestId,
        input: [{ type: "text", text: promptFor(index, turn), mentions: [] }],
        target: turn === 0 ? { kind: "thread-start" } : { kind: "new-turn" },
        request: { method: "turn/start", params: {} },
        execution: {
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
          serviceTier: "default",
        },
      },
    },
    {
      threadId,
      providerThreadId,
      scope,
      type: "turn/started",
      data: { providerThreadId },
    },
    {
      threadId,
      providerThreadId,
      scope,
      type: "item/completed",
      data: {
        providerThreadId,
        item: {
          type: "agentMessage",
          id: agentMessageId,
          text: replyFor(index, turn),
        },
      },
    },
    {
      threadId,
      providerThreadId,
      scope,
      type: "turn/completed",
      data: {
        providerThreadId,
        status: "completed",
        providerCheckpointId: `${turnId}-checkpoint`,
      },
    },
  ];
}

function seedTurns(db: DbConnection, threads: readonly SeededThread[]): void {
  let requestNumber = REQUEST_ID_BASE;
  for (const batch of chunks(threads, BATCH_THREADS)) {
    db.transaction(
      (tx) => {
        const events: AppendStoredThreadEventArgs[] = [];
        const requests: { thread: SeededThread; position: number }[] = [];
        for (const thread of batch) {
          for (let turn = 0; turn < thread.spec.turns; turn += 1) {
            requests.push({ thread, position: events.length });
            events.push(
              ...turnEvents(thread.id, thread.spec.index, turn, requestNumber),
            );
            requestNumber += 1;
          }
        }
        const sequences = appendStoredThreadEventsInTransaction(tx, events);
        for (const { thread, position } of requests) {
          const sequence = sequences[position];
          if (sequence === undefined) {
            throw new Error("Expected a request sequence");
          }
          thread.requestSequences.push(sequence);
        }
      },
      { behavior: "immediate" },
    );
  }
}

function settleThreads(
  db: DbConnection,
  threads: readonly SeededThread[],
  firstCreatedAt: number,
): void {
  db.transaction(() => {
    for (const thread of threads) {
      if (thread.spec.archived && thread.spec.slot >= GROUP_SIZE) {
        archiveThread(db, noopNotifier, thread.id);
      }
    }
    for (const thread of threads) {
      if (!thread.spec.pinned) continue;
      pinThread(db, noopNotifier, {
        threadId: thread.id,
        pinnedAt: timesFor(thread.spec, firstCreatedAt, Date.now()).updatedAt,
      });
    }
    for (const thread of threads) {
      if (thread.spec.purge) {
        requestThreadPurge(db, { now: Date.now(), threadId: thread.id });
      }
    }
  });
}

function tabsJson(index: number): string {
  return JSON.stringify({
    activeTabId: `tab-${index}-0`,
    tabs: [
      { id: `tab-${index}-0`, kind: "timeline" },
      {
        id: `tab-${index}-1`,
        kind: "file",
        path: "apps/server/src/routes/threads/base.ts",
      },
      {
        id: `tab-${index}-2`,
        kind: "diff",
        path: "packages/db/src/data/threads.ts",
      },
      {
        id: `tab-${index}-3`,
        kind: "plugin",
        pluginId: GITHUB_PLUGIN_ID,
        view: "pr",
      },
    ],
  });
}

function outlineItemsJson(count: number, label: number): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, item) => ({
      id: `outline-${label}-${item}`,
      role: item % 2 === 0 ? "user" : "assistant",
      preview: promptFor(label, item).slice(0, 120),
      attachmentSummary:
        item % 9 === 0 ? { imageCount: 1, fileCount: 0 } : null,
    })),
  );
}

function seedThreadState(
  db: DbConnection,
  fixture: HistoryFixture,
  threads: readonly SeededThread[],
  scale: number,
): void {
  const now = Date.now();
  const tabCount = scaled(THREAD_TABS, scale);
  const withTabs = threads
    .filter((thread) => !thread.spec.deleted && thread.spec.index % 10 < 7)
    .slice(-tabCount);
  const withOutlines = threads.filter(
    (thread) => thread.spec.index % 2 === 0 && thread.spec.turns > 0,
  );
  const real = (thread: SeededThread) => thread.spec.slot >= GROUP_SIZE;
  db.transaction(() => {
    for (const chunk of chunks(
      withTabs.filter((t) => !real(t)),
      BULK_ROWS,
    )) {
      db.run(sql`INSERT INTO thread_tabs (thread_id, tabs_json, revision, updated_at)
        SELECT row.value ->> '$.threadId', row.value ->> '$.tabsJson', 1, ${now}
        FROM json_each(${JSON.stringify(
          chunk.map((thread) => ({
            threadId: thread.id,
            tabsJson: tabsJson(thread.spec.index),
          })),
        )}) AS row`);
    }
    for (const thread of withTabs.filter(real)) {
      replaceStoredThreadTabs(db, {
        expectedRevision: 0,
        tabsJson: tabsJson(thread.spec.index),
        threadId: thread.id,
      });
    }
    upsertThreadConversationOutlineRecord(db, {
      threadId: fixture.threadId,
      projectionKey: `v3:${fixture.latestSequence}`,
      itemsJson: outlineItemsJson(fixture.turns.length * 2, 0),
    });
    for (const chunk of chunks(
      withOutlines.filter((t) => !real(t)),
      BULK_ROWS,
    )) {
      db.run(sql`INSERT INTO thread_conversation_outlines (thread_id, projection_key, items_json)
        SELECT row.value ->> '$.threadId', row.value ->> '$.projectionKey', row.value ->> '$.itemsJson'
        FROM json_each(${JSON.stringify(
          chunk.map((thread) => ({
            threadId: thread.id,
            projectionKey: `v3:${thread.requestSequences.at(-1) ?? 0}`,
            itemsJson: outlineItemsJson(
              thread.spec.turns * 2,
              thread.spec.index,
            ),
          })),
        )}) AS row`);
    }
    for (const thread of withOutlines.filter(real)) {
      upsertThreadConversationOutlineRecord(db, {
        threadId: thread.id,
        projectionKey: `v3:${thread.requestSequences.at(-1) ?? 0}`,
        itemsJson: outlineItemsJson(thread.spec.turns * 2, thread.spec.index),
      });
    }
    for (const thread of threads) {
      if (thread.spec.index % 30 === 3 && !thread.spec.deleted) {
        insertThreadPluginMetadata(db, {
          threadId: thread.id,
          pluginId: LINEAR_PLUGIN_ID,
          metadata: { issue: `BB-${thread.spec.index}`, state: "In Progress" },
        });
      }
    }
  });
}

interface PromptHistoryRow {
  id: string;
  projectId: string;
  threadId: string;
  scope: PromptHistoryScope;
  requestSequence: number;
  input: string;
  createdAt: number;
}

function promptScope(
  spec: ThreadSpec,
  turn: number,
): PromptHistoryScope | null {
  if (turn > 0) return "thread";
  return spec.parentIndex === null ? "project" : null;
}

function promptInput(text: string): string {
  return JSON.stringify([{ type: "text", text, mentions: [] }]);
}

function seedPromptHistory(
  db: DbConnection,
  fixture: HistoryFixture,
  threads: readonly SeededThread[],
  projectIds: readonly string[],
  firstCreatedAt: number,
  scale: number,
): number {
  const target = scaled(PROMPT_HISTORY_ENTRIES, scale);
  const rows: PromptHistoryRow[] = fixture.turns.map((turn, index) => ({
    id: createPromptHistoryEntryId(),
    projectId: fixture.projectId,
    threadId: fixture.threadId,
    scope: index === 0 ? "project" : "thread",
    requestSequence: turn.requestSequence,
    input: promptInput(promptFor(index, 0)),
    createdAt: firstCreatedAt + index * 60_000,
  }));
  let realCount = 0;
  db.transaction(() => {
    for (const thread of threads) {
      thread.requestSequences.forEach((requestSequence, turn) => {
        const scope = promptScope(thread.spec, turn);
        if (scope === null) return;
        const entry = {
          projectId: pick(projectIds, thread.spec.projectIndex),
          threadId: thread.id,
          scope,
          requestSequence,
          createdAt:
            firstCreatedAt +
            thread.spec.index * THREAD_SPACING_MS +
            turn * 600_000,
        };
        const text = promptFor(thread.spec.index, turn);
        if (thread.spec.slot >= GROUP_SIZE) {
          createPromptHistoryEntry(db, {
            ...entry,
            input: [{ type: "text", text, mentions: [] }],
          });
          realCount += 1;
        } else {
          rows.push({
            ...entry,
            id: createPromptHistoryEntryId(),
            input: promptInput(text),
          });
        }
      });
    }
    const owners = threads.filter(
      (thread) => thread.spec.turns > 0 && !thread.spec.deleted,
    );
    for (let extra = 0; rows.length + realCount < target; extra += 1) {
      const thread = pick(owners, extra * 13);
      rows.push({
        id: createPromptHistoryEntryId(),
        projectId: pick(projectIds, thread.spec.projectIndex),
        threadId: thread.id,
        scope: "thread",
        requestSequence: SYNTHETIC_REQUEST_SEQUENCE_BASE + extra,
        input: promptInput(promptFor(thread.spec.index, extra)),
        createdAt:
          firstCreatedAt + thread.spec.index * THREAD_SPACING_MS + extra,
      });
    }
    for (const chunk of chunks(rows, BULK_ROWS)) {
      db.run(sql`INSERT INTO prompt_history_entries
          (id, project_id, thread_id, scope, request_sequence, input, created_at)
        SELECT
          row.value ->> '$.id', row.value ->> '$.projectId',
          row.value ->> '$.threadId', row.value ->> '$.scope',
          row.value ->> '$.requestSequence', row.value ->> '$.input',
          row.value ->> '$.createdAt'
        FROM json_each(${JSON.stringify(chunk)}) AS row`);
    }
  });
  return rows.length + realCount;
}

function seedTerminalSessions(
  db: DbConnection,
  threads: readonly SeededThread[],
  hostId: string,
): void {
  const archived = threads.filter(
    (thread) =>
      thread.spec.archived &&
      !thread.spec.deleted &&
      thread.spec.environmentId !== null,
  );
  for (let index = 0; index < ARCHIVED_TERMINAL_SESSIONS; index += 1) {
    const thread = pick(archived, index * 41);
    createTerminalSession(db, {
      cols: 120,
      rows: 40,
      daemonSessionId: null,
      environmentId: thread.spec.environmentId,
      hostId,
      initialCwd: "/workspace/bb",
      status: index % 2 === 0 ? "running" : "exited",
      threadId: thread.id,
      title: "pnpm dev",
    });
  }
}

function seedPruning(
  db: DbConnection,
  threads: readonly SeededThread[],
): string {
  for (const policy of THREAD_PRUNING_POLICIES) {
    pickThreadPruningThread(db, { excludedThreadIds: new Set(), policy });
  }
  const live = threads.filter(
    (thread) =>
      !thread.spec.archived && !thread.spec.deleted && thread.spec.turns > 0,
  );
  const realLive = live.filter((thread) => thread.spec.slot >= GROUP_SIZE);
  for (const thread of realLive) {
    for (let pass = 0; pass < THREAD_PRUNING_POLICIES.length; pass += 1) {
      advanceThreadPruning(db, { threadId: thread.id });
    }
  }
  const now = Date.now();
  const cursors = live
    .filter((thread) => thread.spec.slot < GROUP_SIZE)
    .flatMap((thread) =>
      THREAD_PRUNING_POLICIES.map((policy) => ({
        policy,
        threadId: thread.id,
      })),
    );
  db.transaction(() => {
    for (const chunk of chunks(cursors, BULK_ROWS)) {
      db.run(sql`INSERT INTO thread_pruning_cursors (policy, scope, thread_id, version, updated_at)
        SELECT row.value ->> '$.policy', row.value ->> '$.threadId', row.value ->> '$.threadId', 1, ${now}
        FROM json_each(${JSON.stringify(chunk)}) AS row`);
    }
  });
  const scopedThread = realLive.at(-1);
  if (scopedThread === undefined) {
    throw new Error("Expected a scoped pruning thread");
  }
  return scopedThread.id;
}

function requireThread(
  threads: readonly SeededThread[],
  predicate: (thread: SeededThread) => boolean,
  label: string,
): SeededThread {
  const found = [...threads].reverse().find(predicate);
  if (found === undefined) throw new Error(`Expected a seeded ${label}`);
  return found;
}

function countRows(db: DbConnection, table: string): number {
  return (
    db.$client.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

export function seedThreads(
  db: DbConnection,
  fixture: HistoryFixture,
  scale: number,
): ThreadsSeed {
  const places = seedPlaces(db, fixture, scale);
  const sectionIds = seedSections(db);
  const specs = buildSpecs(scale, places.environmentIdsByProject, sectionIds);
  const firstCreatedAt = Date.now() - specs.length * THREAD_SPACING_MS;
  insertBulkThreads(db, specs, places.projectIds, firstCreatedAt);
  createRealThreads(db, specs, places.projectIds);
  const threads = seededThreads(specs);
  seedTurns(db, threads);
  settleThreads(db, threads, firstCreatedAt);
  seedThreadState(db, fixture, threads, scale);
  const promptHistoryCount = seedPromptHistory(
    db,
    fixture,
    threads,
    places.projectIds,
    firstCreatedAt,
    scale,
  );
  seedTerminalSessions(db, threads, fixture.hostId);
  const scopedCursorThreadId = seedPruning(db, threads);

  const live = (thread: SeededThread) =>
    !thread.spec.archived && !thread.spec.deleted;
  const firstRealChild = threads.find(
    (thread) => thread.spec.slot >= GROUP_SIZE,
  );
  const orchestrator =
    firstRealChild?.spec.parentIndex === null ||
    firstRealChild?.spec.parentIndex === undefined
      ? undefined
      : threads[firstRealChild.spec.parentIndex];
  if (orchestrator === undefined) throw new Error("Expected the orchestrator");
  const managerRoot = requireThread(
    threads,
    (thread) =>
      live(thread) &&
      thread.spec.slot === ROOT_SLOT &&
      thread.id !== orchestrator.id,
    "live manager root",
  );
  const archiveTreeIds = threads
    .filter(
      (thread) =>
        thread.spec.group === managerRoot.spec.group &&
        (thread.spec.ownerIndex !== null || thread.spec.slot === ROOT_SLOT),
    )
    .map((thread) => thread.id);
  const pinned = threads.filter(
    (thread) => live(thread) && thread.spec.pinned && !thread.spec.hidden,
  );
  const deletedPurge = requireThread(
    threads,
    (thread) => thread.spec.purge && thread.spec.turns > 0,
    "purged thread",
  );
  const chainLeafIds = threads
    .filter(
      (thread) => thread.spec.slot === CHAIN_END_SLOT && !thread.spec.deleted,
    )
    .slice(-200)
    .map((thread) => thread.id);
  const descendantRootIds = [
    orchestrator.id,
    ...threads
      .filter(
        (thread) =>
          thread.spec.slot === ROOT_SLOT && thread.id !== orchestrator.id,
      )
      .slice(-199)
      .map((thread) => thread.id),
  ];
  const mentionThreadIds = threads
    .filter((_, index) => index % 311 === 17)
    .slice(0, 32)
    .map((thread) => thread.id);
  const existingLookupIds = threads
    .filter((_, index) => index % 7 === 3)
    .slice(0, 700)
    .map((thread) => thread.id);
  for (let missing = existingLookupIds.length; missing < 1_000; missing += 1) {
    existingLookupIds.push(`thr_missing${String(missing).padStart(6, "0")}`);
  }
  const busiestProjectEnvironments = new Set(places.environmentIdsByProject[0]);
  const hostAssignmentThreadIds = threads
    .filter(
      (thread) =>
        live(thread) &&
        thread.spec.environmentId !== null &&
        busiestProjectEnvironments.has(thread.spec.environmentId),
    )
    .slice(-50)
    .map((thread) => thread.id);
  const pluginMetadataThreadIds = threads
    .filter(
      (thread) => thread.spec.pluginMetadata !== null && !thread.spec.deleted,
    )
    .slice(-200)
    .map((thread) => thread.id);
  const pluginMetadataThreadId = requireThread(
    threads,
    (thread) => live(thread) && thread.spec.index % 30 === 3,
    "thread with two plugin namespaces",
  ).id;
  const tabsThread = requireThread(
    threads,
    (thread) => live(thread) && thread.spec.index % 10 < 7,
    "thread with tabs",
  );
  const promptHistoryCursor = db.$client
    .prepare(
      `SELECT created_at AS createdAt, request_sequence AS requestSequence, id
       FROM prompt_history_entries
       ORDER BY created_at DESC, request_sequence DESC, id DESC
       LIMIT 1 OFFSET ?`,
    )
    .get(
      Math.floor(promptHistoryCount * 0.9),
    ) as ThreadsSeed["promptHistoryCursor"];

  return {
    projectIds: places.projectIds,
    busiestProjectId: fixture.projectId,
    busiestHostId: fixture.hostId,
    busiestEnvironmentId: fixture.environmentId,
    biggestSectionId: pick(sectionIds, 0),
    sectionIds,
    orchestratorId: orchestrator.id,
    managerRootId: managerRoot.id,
    archivedRootId: requireThread(
      threads,
      (thread) =>
        thread.spec.archived &&
        !thread.spec.deleted &&
        thread.spec.parentIndex === null &&
        thread.spec.ownerIndex === null &&
        thread.spec.slot >= 13 &&
        thread.spec.slot < GROUP_SIZE &&
        thread.spec.status === "idle",
      "archived root",
    ).id,
    idleThreadId: requireThread(
      threads,
      (thread) =>
        live(thread) && thread.spec.status === "idle" && thread.spec.turns > 0,
      "idle thread",
    ).id,
    unpinnedLiveThreadId: requireThread(
      threads,
      (thread) => live(thread) && !thread.spec.pinned && !thread.spec.hidden,
      "unpinned live thread",
    ).id,
    pinnedThreadIds: pinned.map((thread) => thread.id),
    chainLeafIds,
    descendantRootIds,
    mentionThreadIds,
    existingLookupIds,
    hostAssignmentThreadIds,
    deletedPurgeThreadId: deletedPurge.id,
    purgeThreadIds: threads
      .filter((thread) => thread.spec.purge)
      .map((thread) => thread.id),
    tabsThreadId: tabsThread.id,
    tabsRevision: 1,
    pluginMetadataThreadIds,
    pluginMetadataThreadId,
    scopedCursorThreadId,
    archiveTreeIds,
    promptHistoryCursor,
    liveThreadCount: threads.filter(live).length,
    threadCount: threads.length,
    searchSegmentCount: countRows(db, "thread_search_segments"),
    promptHistoryCount,
  };
}
