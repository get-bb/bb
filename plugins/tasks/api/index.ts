import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  createTasksStore,
  type Attachment as StoredAttachment,
  type Comment as StoredComment,
  type Task as StoredTask,
  type TasksStore,
} from "../db";
import {
  AttachmentReferencedError,
  deleteAttachmentById,
  removeAttachmentBlobs,
} from "../attachments";
import { deliverCommentToLatestAgent } from "../steer";
import { displayName } from "../shared/display-name";
import { errorMessage } from "../shared/errors";
import { isSideChatShapedThread } from "../shared/side-chat";
import {
  tasksRpcContract,
  type Attachment as AttachmentMetadata,
  type SidebarProjectSummary,
  type Task,
  type TaskPullRequest,
  type TasksDomainError,
  type CommentProvider,
} from "../shared/contract";
import {
  FOLDERS_TAG,
  PRESETS_TAG,
  PROJECTS_TAG,
  commentsTag,
  labelsTag,
  projectTag,
  projectTasksChangedTags,
  projectTasksTag,
  pullRequestsTag,
  taskChangedTags,
  threadsChangedTags,
  ALL_TASKS_TAG,
  TASK_META_TAG,
} from "../shared/tags";

interface TaskLabelIdRow {
  task_id: string;
  label_id: string;
}

interface CountRow {
  count: number;
}

interface PrefixRow {
  found: number;
}

interface SummaryRow {
  project_id: string;
  task_count: number;
  active_agent_count: number;
}

const MAX_THREAD_SEARCH_RESULTS = 10;
const ACTIVE_PULL_REQUEST_REFRESH_MS = 60_000;
const activePullRequestTasks = new WeakMap<TasksApiStore, Set<string>>();

function tasksWithActivePullRequests(store: TasksApiStore): Set<string> {
  let tasks = activePullRequestTasks.get(store);
  if (tasks === undefined) {
    tasks = new Set();
    activePullRequestTasks.set(store, tasks);
  }
  return tasks;
}

function isActivePullRequest(pullRequest: TaskPullRequest): boolean {
  return pullRequest.state === "open" || pullRequest.state === "draft";
}

export interface TasksApiStore {
  readonly tasks: TasksStore;
  transaction<T>(operation: () => T): T;
  taskLabelIds(taskIds: readonly string[]): Map<string, string[]>;
  projectTaskCount(projectId: string): number;
  projectPrefixExists(prefix: string, excludingProjectId: string): boolean;
  openTaskCount(): number;
  sidebarSummary(): SidebarProjectSummary[];
}

export function createStore(bb: BbPluginApi): TasksApiStore {
  const database = bb.storage.database();
  const tasks = createTasksStore(database);

  return {
    tasks,
    transaction<T>(operation: () => T): T {
      return database.transaction(operation)();
    },
    taskLabelIds(taskIds: readonly string[]): Map<string, string[]> {
      const labelsByTask = new Map<string, string[]>();
      for (const taskId of taskIds) labelsByTask.set(taskId, []);

      for (let offset = 0; offset < taskIds.length; offset += 500) {
        const ids = taskIds.slice(offset, offset + 500);
        if (ids.length === 0) continue;
        const placeholders = ids.map(() => "?").join(", ");
        const rows = database
          .prepare<string[], TaskLabelIdRow>(
            `
              SELECT task_id, label_id
              FROM task_labels
              WHERE task_id IN (${placeholders})
              ORDER BY task_id, label_id
            `,
          )
          .all(...ids);
        for (const row of rows)
          labelsByTask.get(row.task_id)?.push(row.label_id);
      }
      return labelsByTask;
    },
    projectTaskCount(projectId: string): number {
      return (
        database
          .prepare<[string], CountRow>(
            "SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?",
          )
          .get(projectId)?.count ?? 0
      );
    },
    projectPrefixExists(prefix: string, excludingProjectId: string): boolean {
      return Boolean(
        database
          .prepare<[string, string], PrefixRow>(
            `
              SELECT 1 AS found FROM projects
              WHERE prefix = ? COLLATE NOCASE AND id <> ?
              LIMIT 1
            `,
          )
          .get(prefix, excludingProjectId),
      );
    },
    openTaskCount(): number {
      return (
        database
          .prepare<[], CountRow>(
            `
              SELECT COUNT(*) AS count
              FROM tasks
              WHERE status NOT IN ('done', 'canceled')
            `,
          )
          .get()?.count ?? 0
      );
    },
    sidebarSummary(): SidebarProjectSummary[] {
      return database
        .prepare<[], SummaryRow>(
          `
            SELECT
              p.id AS project_id,
              COUNT(DISTINCT t.id) AS task_count,
              COUNT(DISTINCT CASE
                WHEN tt.live_status IN ('starting', 'working') THEN tt.thread_id
              END) AS active_agent_count
            FROM projects p
            LEFT JOIN tasks t
              ON t.project_id = p.id
              AND t.parent_task_id IS NULL
            LEFT JOIN task_threads tt ON tt.task_id = t.id
            GROUP BY p.id
            ORDER BY p.name COLLATE NOCASE, p.id
          `,
        )
        .all()
        .map((row) => ({
          projectId: row.project_id,
          taskCount: row.task_count,
          activeAgentCount: row.active_agent_count,
        }));
    },
  };
}

class TasksDomainFailure extends Error {
  constructor(readonly detail: TasksDomainError) {
    super(detail.message);
    this.name = "TasksDomainFailure";
  }
}

function fail(code: TasksDomainError["code"], message: string): never {
  throw new TasksDomainFailure({ code, message });
}

function taskFailure(error: TasksDomainFailure) {
  return { ok: false as const, error: error.detail };
}

function invalidate(bb: BbPluginApi, tags: readonly string[]): void {
  bb.rpc.experimental_invalidate([...new Set(tags)]);
}

export function invalidateTaskChanged(
  bb: BbPluginApi,
  task: { id: string; projectId: string },
): void {
  invalidate(bb, taskChangedTags(task));
}

export function invalidateComments(bb: BbPluginApi, taskId: string): void {
  invalidate(bb, [commentsTag(taskId)]);
}

export function invalidateThreads(bb: BbPluginApi, taskId: string): void {
  invalidate(bb, threadsChangedTags(taskId));
}

export function invalidateProjects(bb: BbPluginApi): void {
  invalidate(bb, [PROJECTS_TAG]);
}

export function invalidateFolders(
  bb: BbPluginApi,
  options: { projectsMoved: boolean },
): void {
  invalidate(bb, [
    FOLDERS_TAG,
    ...(options.projectsMoved ? [PROJECTS_TAG] : []),
  ]);
}

export function invalidateProjectTasks(
  bb: BbPluginApi,
  projectId: string,
): void {
  invalidate(bb, projectTasksChangedTags(projectId));
}

function apiTask(store: TasksApiStore, task: StoredTask): Task {
  return {
    ...task,
    labelIds: store.taskLabelIds([task.id]).get(task.id) ?? [],
  };
}

function apiTasks(store: TasksApiStore, tasks: StoredTask[]): Task[] {
  const labelsByTask = store.taskLabelIds(tasks.map((task) => task.id));
  return tasks.map((task) => ({
    ...task,
    labelIds: labelsByTask.get(task.id) ?? [],
  }));
}

function validateTaskParent(
  store: TasksApiStore,
  projectId: string,
  parentTaskId: string | null,
  ownTaskId?: string,
): void {
  if (parentTaskId === null) return;
  if (parentTaskId === ownTaskId) {
    fail("task_parent_invalid", "A task cannot be its own parent");
  }

  const parent = store.tasks.getTask(parentTaskId);
  if (!parent) throw new Error(`Task not found: ${parentTaskId}`);
  if (parent.projectId !== projectId) {
    fail(
      "subtask_project_mismatch",
      "A sub-task must belong to the same project as its parent",
    );
  }
  if (parent.parentTaskId !== null) {
    fail(
      "subtask_depth_exceeded",
      "Tasks support at most one level of sub-tasks",
    );
  }
  if (ownTaskId && store.tasks.listSubtasks(ownTaskId).length > 0) {
    fail(
      "subtask_depth_exceeded",
      "A task with sub-tasks cannot itself become a sub-task",
    );
  }
}

function validateTaskLabels(
  store: TasksApiStore,
  projectId: string,
  labelIds: readonly string[],
): void {
  for (const labelId of labelIds) {
    const label = store.tasks.getLabel(labelId);
    if (!label || label.projectId !== projectId) {
      fail(
        "label_project_mismatch",
        `Task labels must belong to the task project: ${labelId}`,
      );
    }
  }
}

function replaceTaskLabels(
  store: TasksApiStore,
  taskId: string,
  labelIds: readonly string[],
): void {
  const current = new Set(
    store.tasks.listTaskLabels(taskId).map((link) => link.labelId),
  );
  const next = new Set(labelIds);
  for (const labelId of current) {
    if (!next.has(labelId)) store.tasks.removeTaskLabel(taskId, labelId);
  }
  for (const labelId of next) {
    if (!current.has(labelId)) store.tasks.addTaskLabel(taskId, labelId);
  }
}

function labelsChanged(
  before: readonly string[],
  after: readonly string[],
): boolean {
  if (before.length !== after.length) return true;
  const afterSet = new Set(after);
  return before.some((labelId) => !afterSet.has(labelId));
}

function labelChangeBody(
  store: TasksApiStore,
  taskId: string,
  authorName: string,
): string {
  const names = store.tasks
    .listLabelsForTask(taskId)
    .map((label) => label.name)
    .sort((left, right) => left.localeCompare(right));
  return names.length === 0
    ? `Labels cleared by ${authorName}`
    : `Labels changed to ${names.join(", ")} by ${authorName}`;
}

function writeSystemComments(
  store: TasksApiStore,
  taskId: string,
  authorName: string,
  bodies: readonly string[],
): void {
  for (const body of bodies) {
    store.tasks.createComment({
      taskId,
      kind: "system",
      authorName,
      body,
    });
  }
}

function attachmentMetadata(attachment: StoredAttachment): AttachmentMetadata {
  return {
    id: attachment.id,
    taskId: attachment.taskId,
    commentId: attachment.commentId,
    fileName: attachment.fileName,
    mime: attachment.mime,
    sizeBytes: attachment.sizeBytes,
    isImage: attachment.isImage,
    createdAt: attachment.createdAt,
  };
}

function attachmentsForTasks(
  store: TasksStore,
  taskIds: readonly string[],
): StoredAttachment[] {
  return taskIds.flatMap((taskId) => [
    ...store.listAttachmentsForTask(taskId),
    ...store
      .listComments(taskId)
      .flatMap((comment) => store.listAttachmentsForComment(comment.id)),
  ]);
}

interface AgentThreadInfo {
  title: string | null;
  providerId: string;
}

async function resolveAgentThreadInfo(
  bb: BbPluginApi,
  comments: readonly StoredComment[],
): Promise<Map<string, AgentThreadInfo>> {
  const threadIds = new Set<string>();
  for (const comment of comments) {
    if (comment.kind === "agent" && comment.threadId !== null) {
      threadIds.add(comment.threadId);
    }
  }
  const infos = new Map<string, AgentThreadInfo>();
  await Promise.all(
    [...threadIds].map(async (threadId) => {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        const isSideChat = isSideChatShapedThread(thread);
        const title = isSideChat
          ? undefined
          : [thread.title, thread.titleFallback].find(
              (candidate) => candidate !== null && candidate.trim() !== "",
            );
        infos.set(threadId, {
          title: title ?? null,
          providerId: thread.providerId,
        });
      } catch {}
    }),
  );
  return infos;
}

async function resolveProviderBadges(
  bb: BbPluginApi,
  threadInfo: ReadonlyMap<string, AgentThreadInfo>,
): Promise<Map<string, CommentProvider>> {
  const providerIds = new Set(
    [...threadInfo.values()].map((info) => info.providerId),
  );
  const badges = new Map<string, CommentProvider>();
  if (providerIds.size === 0) return badges;
  let providers: Awaited<ReturnType<typeof bb.sdk.providers.list>>;
  try {
    providers = await bb.sdk.providers.list();
  } catch {
    return badges;
  }
  for (const provider of providers) {
    if (providerIds.has(provider.id)) {
      badges.set(provider.id, {
        id: provider.id,
        name: provider.displayName,
        logoUrl: provider.logoUrl,
        icon: provider.icon ?? null,
        strings: { iconTint: provider.strings?.iconTint ?? null },
      });
    }
  }
  return badges;
}

interface CreateCommentInput {
  taskId: string;
  kind: StoredComment["kind"];
  authorName: string;
  presetName: string | null;
  threadId: string | null;
  body: string;
  notify: boolean;
  awaitDelivery: boolean;
}

export async function createComment(
  bb: BbPluginApi,
  store: TasksApiStore,
  input: CreateCommentInput,
): Promise<StoredComment> {
  const comment = store.transaction(() =>
    store.tasks.createComment({
      taskId: input.taskId,
      kind: input.kind,
      authorName: input.authorName,
      presetName: input.presetName,
      threadId: input.threadId,
      body: input.body,
    }),
  );

  invalidateComments(bb, input.taskId);
  if (!input.notify) return comment;

  const deliver = async (): Promise<StoredComment> => {
    const notifiedCount = await deliverCommentToLatestAgent(bb, store.tasks, {
      taskId: comment.taskId,
      commentId: comment.id,
      body: comment.body,
      authorName: comment.authorName,
    });
    const updated = store.transaction(() =>
      store.tasks.updateComment(comment.id, { notifiedCount }),
    );
    invalidateComments(bb, input.taskId);
    return updated;
  };

  if (input.awaitDelivery) return deliver();
  void deliver().catch((error) => {
    bb.log.warn(
      `failed to update comment notification ${comment.id}: ${errorMessage(error)}`,
    );
  });
  return comment;
}

interface TaskPullRequestsResult {
  pullRequests: TaskPullRequest[];
  unavailableThreadIds: string[];
}

const GITHUB_PR_STATUS_PLUGIN_ID = "bb--github-pr-status";
const PULL_REQUEST_KEYS_PER_READ = 200;

const environmentPullRequestsSchema = z.record(
  z.string(),
  z.discriminatedUnion("outcome", [
    z.object({
      outcome: z.literal("available"),
      pullRequest: z.object({
        url: z.string().url(),
        number: z.number().int().positive(),
        title: z.string(),
        state: z.enum(["open", "draft", "merged", "closed"]),
        updatedAt: z.string(),
      }),
    }),
    z.object({ outcome: z.literal("absent") }),
    z.object({ outcome: z.literal("unavailable"), message: z.string() }),
  ]),
);
type EnvironmentPullRequests = z.infer<typeof environmentPullRequestsSchema>;

async function readEnvironmentPullRequests(
  bb: BbPluginApi,
  environmentIds: readonly string[],
): Promise<EnvironmentPullRequests> {
  const rows: EnvironmentPullRequests = {};
  for (
    let start = 0;
    start < environmentIds.length;
    start += PULL_REQUEST_KEYS_PER_READ
  ) {
    const keys = environmentIds.slice(
      start,
      start + PULL_REQUEST_KEYS_PER_READ,
    );
    try {
      Object.assign(
        rows,
        await bb.sdk.plugins.callRpc({
          pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
          method: "pullRequests",
          input: { keys },
          outputSchema: environmentPullRequestsSchema,
        }),
      );
    } catch (error) {
      bb.log.debug(`pull request lookup failed: ${errorMessage(error)}`);
    }
  }
  return rows;
}

async function listTaskPullRequests(
  bb: BbPluginApi,
  store: TasksApiStore,
  taskId: string,
): Promise<TaskPullRequestsResult> {
  const taskThreads = store.tasks.listTaskThreads(taskId);

  const unavailable = new Set<string>();
  const threadIdsByEnvironment = new Map<string, string[]>();
  await Promise.all(
    taskThreads.map(async (taskThread) => {
      try {
        const thread = await bb.sdk.threads.get({
          threadId: taskThread.threadId,
        });
        if (!thread.environmentId) return;
        const group = threadIdsByEnvironment.get(thread.environmentId) ?? [];
        group.push(taskThread.threadId);
        threadIdsByEnvironment.set(thread.environmentId, group);
      } catch {
        unavailable.add(taskThread.threadId);
      }
    }),
  );

  const byUrl = new Map<string, TaskPullRequest>();
  const rows = await readEnvironmentPullRequests(bb, [
    ...threadIdsByEnvironment.keys(),
  ]);
  for (const [environmentId, threadIds] of threadIdsByEnvironment) {
    const result = rows[environmentId];
    if (result === undefined || result.outcome === "unavailable") {
      for (const threadId of threadIds) unavailable.add(threadId);
      continue;
    }
    if (result.outcome === "absent") continue;
    const { pullRequest } = result;
    const existing = byUrl.get(pullRequest.url);
    if (!existing) {
      byUrl.set(pullRequest.url, { ...pullRequest, threadIds: [...threadIds] });
      continue;
    }
    const threadIdUnion = [...existing.threadIds, ...threadIds];
    if (pullRequest.updatedAt.localeCompare(existing.updatedAt) > 0) {
      byUrl.set(pullRequest.url, { ...pullRequest, threadIds: threadIdUnion });
    } else {
      existing.threadIds = threadIdUnion;
    }
  }

  const threadOrder = new Map(
    taskThreads.map((taskThread, index) => [taskThread.threadId, index]),
  );
  const orderByThread = (threadId: string) =>
    threadOrder.get(threadId) ?? Number.MAX_SAFE_INTEGER;
  const pullRequests = [...byUrl.values()].map((pullRequest) => ({
    ...pullRequest,
    threadIds: [...pullRequest.threadIds].sort(
      (left, right) => orderByThread(left) - orderByThread(right),
    ),
  }));

  return {
    pullRequests: pullRequests.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
    unavailableThreadIds: [...unavailable].sort(
      (left, right) => orderByThread(left) - orderByThread(right),
    ),
  };
}

export function registerHandlers(
  bb: BbPluginApi,
  store: TasksApiStore,
): PluginRpcHandlers<typeof tasksRpcContract> {
  return {
    createFolder(input) {
      const folder = store.tasks.createFolder(input);
      invalidateFolders(bb, { projectsMoved: false });
      return { folder };
    },
    renameFolder(input) {
      const folder = store.tasks.updateFolder(input.folderId, {
        name: input.name,
      });
      invalidateFolders(bb, { projectsMoved: false });
      return { folder };
    },
    moveFolder(input) {
      const folder = store.tasks.updateFolder(input.folderId, {
        parentFolderId: input.parentFolderId,
      });
      invalidateFolders(bb, { projectsMoved: false });
      return { folder };
    },
    deleteFolder(input) {
      const result = store.tasks.deleteFolder(input.folderId);
      if (result.deleted) invalidateFolders(bb, { projectsMoved: true });
      return result;
    },
    listFolders() {
      return { folders: store.tasks.listFolders() };
    },
    createProject(input) {
      const project = store.tasks.createProject(input);
      invalidateProjects(bb);
      return { project };
    },
    updateProject(input) {
      const { projectId, ...changes } = input;
      const project = store.tasks.updateProject(projectId, changes);
      invalidateProjects(bb);
      return { project };
    },
    renameProjectPrefix(input) {
      try {
        if (store.projectPrefixExists(input.prefix, input.projectId)) {
          fail(
            "project_prefix_conflict",
            `Project prefix is already in use: ${input.prefix}`,
          );
        }
        const project = store.tasks.updateProject(input.projectId, {
          prefix: input.prefix,
        });
        invalidateProjectTasks(bb, project.id);
        return { ok: true, project };
      } catch (error) {
        if (error instanceof TasksDomainFailure) return taskFailure(error);
        throw error;
      }
    },
    async deleteProject(input) {
      try {
        if (!input.force && store.projectTaskCount(input.projectId) > 0) {
          fail(
            "project_not_empty",
            "A project must be empty before it can be deleted; pass force: true to delete its tasks",
          );
        }
        const taskIds = store.tasks
          .listTasks({ projectId: input.projectId })
          .map((task) => task.id);
        const attachments = attachmentsForTasks(store.tasks, taskIds);
        const deleted = store.tasks.deleteProject(input.projectId);
        if (deleted) {
          await removeAttachmentBlobs(bb, store.tasks, attachments);
          invalidateProjectTasks(bb, input.projectId);
        }
        return { ok: true, deleted };
      } catch (error) {
        if (error instanceof TasksDomainFailure) return taskFailure(error);
        throw error;
      }
    },
    listProjects(input) {
      return { projects: store.tasks.listProjects(input.folderId) };
    },
    createTask(input) {
      try {
        validateTaskParent(store, input.projectId, input.parentTaskId);
        validateTaskLabels(store, input.projectId, input.labelIds);
        const task = store.transaction(() => {
          const created = store.tasks.createTask({
            projectId: input.projectId,
            title: input.title,
            description: input.description,
            status: input.status,
            priority: input.priority,
            dueDate: input.dueDate,
            parentTaskId: input.parentTaskId,
          });
          replaceTaskLabels(store, created.id, input.labelIds);
          return apiTask(store, created);
        });
        invalidateTaskChanged(bb, task);
        return { ok: true, task };
      } catch (error) {
        if (error instanceof TasksDomainFailure) return taskFailure(error);
        throw error;
      }
    },
    getTask(input) {
      const task = store.tasks.getTask(input.taskId);
      return { task: task ? apiTask(store, task) : null };
    },
    getTaskByKey(input) {
      const task = store.tasks.getTaskByKey(input.taskKey);
      return { task: task ? apiTask(store, task) : null };
    },
    updateTask(input) {
      try {
        const current = store.tasks.getTask(input.taskId);
        if (!current) throw new Error(`Task not found: ${input.taskId}`);
        const parentTaskId =
          input.parentTaskId === undefined
            ? current.parentTaskId
            : input.parentTaskId;
        validateTaskParent(store, current.projectId, parentTaskId, current.id);
        if (input.labelIds) {
          validateTaskLabels(store, current.projectId, input.labelIds);
        }

        const result = store.transaction(() => {
          const beforeLabelIds = store.tasks
            .listTaskLabels(current.id)
            .map((link) => link.labelId);
          const updated = store.tasks.updateTask(current.id, {
            title: input.title,
            description: input.description,
            status: input.status,
            priority: input.priority,
            dueDate: input.dueDate,
            parentTaskId: input.parentTaskId,
          });
          if (input.labelIds) {
            replaceTaskLabels(store, current.id, input.labelIds);
          }

          const bodies: string[] = [];
          if (updated.status !== current.status) {
            bodies.push(
              `Status changed to ${displayName(updated.status)} by ${input.authorName}`,
            );
          }
          if (updated.priority !== current.priority) {
            bodies.push(
              `Priority changed to ${displayName(updated.priority)} by ${input.authorName}`,
            );
          }
          if (updated.dueDate !== current.dueDate) {
            bodies.push(
              updated.dueDate === null
                ? `Due date removed by ${input.authorName}`
                : `Due date changed to ${updated.dueDate} by ${input.authorName}`,
            );
          }
          if (input.labelIds && labelsChanged(beforeLabelIds, input.labelIds)) {
            bodies.push(labelChangeBody(store, current.id, input.authorName));
          }
          writeSystemComments(store, current.id, input.authorName, bodies);
          return {
            task: apiTask(store, updated),
            systemCommentsWritten: bodies.length,
          };
        });

        invalidate(bb, [
          ...taskChangedTags(result.task),
          ...(result.task.parentTaskId === current.parentTaskId
            ? []
            : [TASK_META_TAG]),
          ...(result.systemCommentsWritten > 0
            ? [commentsTag(result.task.id)]
            : []),
        ]);
        return { ok: true, task: result.task };
      } catch (error) {
        if (error instanceof TasksDomainFailure) return taskFailure(error);
        throw error;
      }
    },
    async deleteTask(input) {
      const task = store.tasks.getTask(input.taskId);
      const subtasks = task ? store.tasks.listSubtasks(task.id) : [];
      const attachments = attachmentsForTasks(store.tasks, [input.taskId]);
      const deleted = store.tasks.deleteTask(input.taskId);
      if (deleted && task) {
        await removeAttachmentBlobs(bb, store.tasks, attachments);
        invalidate(bb, [
          ...taskChangedTags(task),
          ...subtasks.flatMap(taskChangedTags),
          ...(subtasks.length > 0 ? [TASK_META_TAG] : []),
        ]);
      }
      return { deleted };
    },
    listTasks(input) {
      const page = store.tasks.listTasksPage({
        projectId: input.projectId,
        statuses: input.statuses,
        priorities: input.priorities,
        labelIds: input.labelIds,
        activeOnly: input.activeOnly,
        parentTaskId: input.parentTaskId,
        search: input.search,
        sort: input.sort,
        limit: input.limit,
        cursor: input.cursor,
      });
      return {
        tasks: apiTasks(store, page.tasks),
        nextCursor: page.nextCursor,
      };
    },
    listAllTasks(input) {
      return {
        tasks: apiTasks(
          store,
          store.tasks.listTasks({
            projectId: input.projectId,
            statuses: input.statuses,
            priorities: input.priorities,
            labelIds: input.labelIds,
            activeOnly: input.activeOnly,
            parentTaskId: input.parentTaskId,
            search: input.search,
            sort: input.sort,
          }),
        ),
      };
    },
    boardMove(input) {
      const current = store.tasks.getTask(input.taskId);
      if (!current) throw new Error(`Task not found: ${input.taskId}`);
      const result = store.transaction(() => {
        const moved = store.tasks.updatePosition(current.id, {
          status: input.status,
          beforeTaskId: input.beforeTaskId,
          afterTaskId: input.afterTaskId,
        });
        const statusChanged = moved.status !== current.status;
        if (statusChanged) {
          writeSystemComments(store, current.id, input.authorName, [
            `Status changed to ${displayName(moved.status)} by ${input.authorName}`,
          ]);
        }
        return { task: apiTask(store, moved), statusChanged };
      });
      invalidateTaskChanged(bb, result.task);
      if (result.statusChanged) invalidateComments(bb, result.task.id);
      return { ok: true, task: result.task };
    },
    moveTaskToProject(input) {
      const current = store.tasks.getTask(input.taskId);
      if (!current) throw new Error(`Task not found: ${input.taskId}`);
      const result = store.transaction(() => {
        const outcome = store.tasks.moveTaskToProject(
          current.id,
          input.projectId,
        );
        for (const { previousKey, task } of outcome.moved) {
          writeSystemComments(store, task.id, input.authorName, [
            `Moved from ${previousKey} to ${task.key} by ${input.authorName}`,
          ]);
        }
        return { task: apiTask(store, outcome.task), moved: outcome.moved };
      });
      if (result.moved.length > 0) {
        invalidate(bb, [
          PROJECTS_TAG,
          TASK_META_TAG,
          ...taskChangedTags(current),
          ...result.moved.flatMap(({ task }) => [
            ...taskChangedTags(task),
            commentsTag(task.id),
          ]),
        ]);
      }
      return { ok: true, task: result.task };
    },
    createLabel(input) {
      const label = store.tasks.createLabel(input);
      invalidate(bb, [labelsTag(label.projectId)]);
      return { label };
    },
    updateLabel(input) {
      const label = store.tasks.updateLabel(input.labelId, {
        name: input.name,
        color: input.color,
      });
      invalidate(bb, [labelsTag(label.projectId)]);
      return { label };
    },
    deleteLabel(input) {
      const label = store.tasks.getLabel(input.labelId);
      const deleted = store.tasks.deleteLabel(input.labelId);
      if (deleted && label) {
        invalidate(bb, [
          labelsTag(label.projectId),
          projectTag(label.projectId),
          ALL_TASKS_TAG,
          projectTasksTag(label.projectId),
        ]);
      }
      return { deleted };
    },
    listLabels(input) {
      return { labels: store.tasks.listLabels(input.projectId) };
    },
    labelsByProject(input) {
      return Object.fromEntries(
        input.keys.map((projectId) => [
          projectId,
          store.tasks.listLabels(projectId),
        ]),
      );
    },
    async createComment(input) {
      const comment = await createComment(bb, store, {
        taskId: input.taskId,
        kind: "user",
        authorName: "You",
        presetName: null,
        threadId: null,
        body: input.body,
        notify: input.notify,
        awaitDelivery: false,
      });
      return { comment };
    },
    async listComments(input) {
      const comments = store.tasks.listComments(input.taskId);
      const threadInfo = await resolveAgentThreadInfo(bb, comments);
      const providerBadges = await resolveProviderBadges(bb, threadInfo);
      return {
        comments: comments.map((comment) => {
          const info =
            comment.kind === "agent" && comment.threadId !== null
              ? threadInfo.get(comment.threadId)
              : undefined;
          return {
            ...comment,
            threadTitle: info?.title ?? null,
            provider:
              info === undefined
                ? null
                : (providerBadges.get(info.providerId) ?? {
                    id: info.providerId,
                    name: info.providerId,
                    logoUrl: null,
                    icon: null,
                    strings: { iconTint: null },
                  }),
          };
        }),
      };
    },
    listAttachments(input) {
      const attachments =
        "taskId" in input
          ? store.tasks.listAttachmentsForTask(input.taskId)
          : "commentId" in input
            ? store.tasks.listAttachmentsForComment(input.commentId)
            : store.tasks.listAttachmentsForTaskComments(
                input.commentsOfTaskId,
              );
      return {
        attachments: attachments.map(attachmentMetadata),
      };
    },
    async deleteAttachment(input) {
      try {
        const attachment = await deleteAttachmentById(
          bb,
          store.tasks,
          input.attachmentId,
          {
            removeDescriptionReferences: input.removeDescriptionReferences,
          },
        );
        return attachment
          ? {
              ok: true,
              deleted: true,
              attachment: attachmentMetadata(attachment),
            }
          : { ok: true, deleted: false, attachment: null };
      } catch (error) {
        if (error instanceof AttachmentReferencedError) {
          return {
            ok: false,
            error: {
              code: "attachment_referenced",
              message: error.message,
            },
          };
        }
        throw error;
      }
    },
    listTaskThreads(input) {
      return { taskThreads: store.tasks.listTaskThreads(input.taskId) };
    },
    listTaskCardMeta(input) {
      return { cards: store.tasks.listTaskCardMeta(input.projectId ?? null) };
    },
    async listTaskPullRequests(input) {
      const result = await listTaskPullRequests(bb, store, input.taskId);
      if (result.pullRequests.some(isActivePullRequest))
        tasksWithActivePullRequests(store).add(input.taskId);
      else tasksWithActivePullRequests(store).delete(input.taskId);
      return result;
    },
    createPreset(input) {
      const preset = store.tasks.createPreset({ ...input, builtin: false });
      invalidate(bb, [PRESETS_TAG]);
      return { preset };
    },
    updatePreset(input) {
      const { presetId, ...changes } = input;
      const preset = store.tasks.updatePreset(
        presetId,
        changes.environmentKind === "project-default"
          ? { ...changes, baseBranch: null, machineId: null }
          : changes,
      );
      invalidate(bb, [PRESETS_TAG]);
      return { preset };
    },
    deletePreset(input) {
      const deleted = store.tasks.deletePreset(input.presetId);
      if (deleted) invalidate(bb, [PRESETS_TAG]);
      return { deleted };
    },
    listPresets() {
      return { presets: store.tasks.listPresets() };
    },
    async listMachines() {
      const machines = await bb.sdk.hosts.list();
      return {
        machines: machines.map((machine) => ({
          id: machine.id,
          name: machine.name,
        })),
      };
    },
    async searchThreads(input) {
      const query = input.query.trim();
      const limit = Math.min(input.limit ?? MAX_THREAD_SEARCH_RESULTS, 10);
      const candidates =
        query.length >= 2
          ? await bb.sdk.threads.search({
              query,
              limitPerGroup: String(MAX_THREAD_SEARCH_RESULTS),
            })
          : null;
      const threads = candidates
        ? [...candidates.active.results, ...candidates.archived.results].map(
            (result) => result.thread,
          )
        : (
            await bb.sdk.threads.list({
              limit: MAX_THREAD_SEARCH_RESULTS,
            })
          ).filter((thread) => {
            if (query.length === 0) return true;
            const title = thread.title ?? thread.titleFallback ?? "";
            return title
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase());
          });
      return {
        threads: threads
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, limit)
          .map((thread) => ({
            id: thread.id,
            title: thread.title ?? thread.titleFallback ?? "Untitled thread",
            status: thread.status,
          })),
      };
    },
    async listBbProjects() {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      return {
        bbProjects: projects.map((project) => ({
          id: project.id,
          name: project.name,
        })),
      };
    },
    sidebarOpenTaskCount() {
      return { openTaskCount: store.openTaskCount() };
    },
    sidebarSummary() {
      return { projects: store.sidebarSummary() };
    },
  };
}

export function registerTasksApi(bb: BbPluginApi, store: TasksApiStore): void {
  bb.rpc.register(tasksRpcContract, registerHandlers(bb, store));
  bb.rpc.experimental_whileWatched("listTaskPullRequests", (read, signal) => {
    if (!("input" in read)) return;
    const { taskId } = tasksRpcContract.listTaskPullRequests.input.parse(
      read.input,
    );
    const timer = setInterval(() => {
      if (tasksWithActivePullRequests(store).has(taskId))
        invalidate(bb, [pullRequestsTag(taskId)]);
    }, ACTIVE_PULL_REQUEST_REFRESH_MS);
    signal.addEventListener("abort", () => clearInterval(timer), {
      once: true,
    });
  });
}
