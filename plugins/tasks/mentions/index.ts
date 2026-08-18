import type { BbPluginApi, PluginMentionItem } from "@get-bb/plugin-sdk";

import type { TasksApiStore } from "../api";
import type { Attachment, Comment, Task, TaskThread } from "../db";

const SEARCH_LIMIT = 10;
const RECENT_COMMENT_LIMIT = 5;

type PluginDatabase = ReturnType<BbPluginApi["storage"]["database"]>;

interface MentionTaskRow {
  id: string;
  key: string;
  title: string;
  project_name: string;
  status: Task["status"];
}

interface AttachmentManifestRow {
  id: string;
  file_name: string;
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function displayName(value: string): string {
  return value
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function searchTasks(
  database: PluginDatabase,
  query: string,
  bbProjectId: string | null,
): PluginMentionItem[] {
  const normalizedQuery = query.trim();
  const search = `%${escapeLike(normalizedQuery)}%`;
  const rows = database
    .prepare<{ bbProjectId: string | null; search: string }, MentionTaskRow>(
      `
        SELECT
          t.id,
          p.prefix || '-' || t.number AS key,
          t.title,
          p.name AS project_name,
          t.status
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE @search = '%%'
          OR (p.prefix || '-' || t.number) LIKE @search ESCAPE '\\'
          OR CAST(t.number AS TEXT) LIKE @search ESCAPE '\\'
          OR t.title LIKE @search ESCAPE '\\'
        ORDER BY
          CASE
            WHEN @bbProjectId IS NOT NULL
              AND p.linked_bb_project_id = @bbProjectId THEN 0
            ELSE 1
          END,
          t.updated_at DESC,
          t.id DESC
        LIMIT ${SEARCH_LIMIT}
      `,
    )
    .all({ bbProjectId, search });

  return rows.map((row) => ({
    id: row.id,
    title: `${row.key} · ${row.title}`,
    subtitle: `${row.project_name} · ${displayName(row.status)}`,
  }));
}

function attachmentManifest(
  database: PluginDatabase,
  taskId: string,
): AttachmentManifestRow[] {
  return database
    .prepare<[string, string], AttachmentManifestRow>(
      `
        SELECT a.id, a.file_name
        FROM attachments a
        LEFT JOIN comments c ON c.id = a.comment_id
        WHERE a.task_id = ? OR c.task_id = ?
        ORDER BY a.created_at, a.id
      `,
    )
    .all(taskId, taskId);
}

function formatSubtasks(subtasks: readonly Task[]): string {
  if (subtasks.length === 0) return "None.";
  return subtasks
    .map(
      (subtask) =>
        `- ${subtask.key} · ${subtask.title} — ${displayName(subtask.status)}`,
    )
    .join("\n");
}

function formatAttachments(
  attachments: readonly Pick<Attachment, "id" | "fileName">[],
): string {
  if (attachments.length === 0) return "None.";
  return attachments
    .map(
      (attachment) =>
        `- ${attachment.id} · ${attachment.fileName}\n` +
        `  Fetch with: bb tasks attachment get ${attachment.id} --out <path>`,
    )
    .join("\n");
}

function formatComments(comments: readonly Comment[]): string {
  if (comments.length === 0) return "None.";
  return comments
    .map(
      (comment) =>
        `### ${comment.authorName} · ${displayName(comment.kind)} · ${comment.createdAt}\n\n${comment.body}`,
    )
    .join("\n\n");
}

function formatThreads(threads: readonly TaskThread[]): string {
  if (threads.length === 0) return "None.";
  return threads
    .map(
      (thread) =>
        `- ${thread.threadId} · ${thread.title} · ${displayName(thread.liveStatus)}`,
    )
    .join("\n");
}

function buildTaskContext(
  store: TasksApiStore,
  database: PluginDatabase,
  taskId: string,
): string {
  const task = store.tasks.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const project = store.tasks.getProject(task.projectId);
  if (!project) throw new Error(`Project not found: ${task.projectId}`);

  const labels = store.tasks.listLabelsForTask(task.id);
  const comments = store.tasks
    .listComments(task.id)
    .slice(-RECENT_COMMENT_LIMIT);
  const attachments = attachmentManifest(database, task.id).map(
    (attachment) => ({
      id: attachment.id,
      fileName: attachment.file_name,
    }),
  );

  return `# ${task.key} · ${task.title}

## Task details

- Status: ${displayName(task.status)}
- Priority: ${displayName(task.priority)}
- Labels: ${labels.length > 0 ? labels.map((label) => label.name).join(", ") : "None"}
- Due: ${task.dueDate ?? "None"}
- Project: ${project.name}

## Description

${task.description.trim() || "No description provided."}

## Sub-tasks

${formatSubtasks(store.tasks.listSubtasks(task.id))}

## Attachments

${formatAttachments(attachments)}

## Last 5 comments

${formatComments(comments)}

## Attached threads

${formatThreads(store.tasks.listTaskThreads(task.id))}

## Action contract

You can act on this task with the bb tasks CLI. If you begin working on it, first run: bb tasks attach ${task.key} (attaches THIS thread so the task shows you as working). Comment substantive updates via bb tasks comment ${task.key} --body ... and set status via bb tasks update ${task.key} --status ...
`;
}

export function registerMentions(bb: BbPluginApi, store: TasksApiStore): void {
  const database = bb.storage.database();

  bb.ui.registerMentionProvider({
    id: "task",
    label: "Tasks",
    search({ query, projectId }) {
      return searchTasks(database, query, projectId);
    },
    resolve(itemId) {
      return { context: buildTaskContext(store, database, itemId) };
    },
  });
}
