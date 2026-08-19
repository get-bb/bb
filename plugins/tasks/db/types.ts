import type { TaskSort } from "../shared/pagination.js";
import type { PresetPermissionMode } from "../shared/contract.js";

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const COMMENT_KINDS = ["user", "agent", "system"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const TASK_THREAD_LIVE_STATUSES = [
  "starting",
  "working",
  "idle",
  "completed",
  "failed",
] as const;

export type TaskThreadLiveStatus = (typeof TASK_THREAD_LIVE_STATUSES)[number];

export const PRESET_ENVIRONMENT_KINDS = [
  "project-default",
  "new-worktree",
] as const;

export type PresetEnvironmentKind = (typeof PRESET_ENVIRONMENT_KINDS)[number];

export interface Folder {
  id: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  prefix: string;
  nextTaskNumber: number;
  color: string;
  folderId: string | null;
  linkedBbProjectId: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  number: number;
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  parentTaskId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
}

export interface TaskLabel {
  taskId: string;
  labelId: string;
}

export interface Comment {
  id: string;
  taskId: string;
  kind: CommentKind;
  authorName: string;
  presetName: string | null;
  threadId: string | null;
  body: string;
  notifiedCount: number;
  createdAt: string;
}

export interface Attachment {
  id: string;
  taskId: string | null;
  commentId: string | null;
  fileName: string;
  mime: string;
  sizeBytes: number;
  blobPath: string;
  isImage: boolean;
  createdAt: string;
}

export interface TaskThread {
  id: string;
  taskId: string;
  threadId: string;
  presetName: string;
  title: string;
  liveStatus: TaskThreadLiveStatus;
  attachedAt: string;
  updatedAt: string;
}

export interface Preset {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: PresetPermissionMode;
  environmentKind: PresetEnvironmentKind;
  baseBranch: string | null;
  machineId: string | null;
  instructions: string;
  builtin: boolean;
  createdAt: string;
}

export interface CreateFolderInput {
  id?: string;
  name: string;
  parentFolderId?: string | null;
}

export interface UpdateFolderInput {
  name?: string;
  parentFolderId?: string | null;
}

/**
 * Result of deleting a folder. `deleted` is false when no row matched (the
 * folder was already gone); the moved IDs name the projects and subfolders
 * that the delete unfiled to the top level, read in the same transaction as
 * the delete so they cannot drift from what actually moved.
 */
export interface DeleteFolderResult {
  deleted: boolean;
  movedProjectIds: string[];
  movedFolderIds: string[];
}

export interface CreateProjectInput {
  id?: string;
  name: string;
  prefix: string;
  color: string;
  folderId?: string | null;
  linkedBbProjectId?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  prefix?: string;
  color?: string;
  folderId?: string | null;
  linkedBbProjectId?: string | null;
}

export interface CreateTaskInput {
  id?: string;
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  parentTaskId?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  parentTaskId?: string | null;
}

export interface ListTasksFilters {
  projectId?: string;
  statuses?: readonly TaskStatus[];
  priorities?: readonly TaskPriority[];
  labelIds?: readonly string[];
  activeOnly?: boolean;
  parentTaskId?: string | null;
  search?: string;
  sort?: TaskSort;
  limit?: number;
  cursor?: string;
}

export interface ListTasksPage {
  tasks: Task[];
  nextCursor: string | null;
}

export interface UpdateTaskPositionInput {
  status: TaskStatus;
  /** The task immediately before this task in the destination column. */
  beforeTaskId?: string | null;
  /** The task immediately after this task in the destination column. */
  afterTaskId?: string | null;
}

export interface SubtaskDoneCounts {
  total: number;
  done: number;
}

export interface CreateLabelInput {
  id?: string;
  projectId: string;
  name: string;
  color: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
}

export interface CreateCommentInput {
  id?: string;
  taskId: string;
  kind: CommentKind;
  authorName: string;
  presetName?: string | null;
  threadId?: string | null;
  body: string;
  notifiedCount?: number;
}

export interface UpdateCommentInput {
  body?: string;
  notifiedCount?: number;
}

export interface CreateAttachmentInput {
  id?: string;
  taskId?: string | null;
  commentId?: string | null;
  fileName: string;
  mime: string;
  sizeBytes: number;
  blobPath: string;
  isImage: boolean;
}

export interface UpdateAttachmentInput {
  fileName?: string;
  mime?: string;
  sizeBytes?: number;
  blobPath?: string;
  isImage?: boolean;
}

export interface UpsertTaskThreadInput {
  id?: string;
  taskId: string;
  threadId: string;
  presetName: string;
  title: string;
  liveStatus: TaskThreadLiveStatus;
}

export interface UpdateTaskThreadInput {
  presetName?: string;
  title?: string;
  liveStatus?: TaskThreadLiveStatus;
}

export interface CreatePresetInput {
  id?: string;
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: PresetPermissionMode;
  environmentKind: PresetEnvironmentKind;
  baseBranch: string | null;
  machineId: string | null;
  instructions: string;
  builtin?: boolean;
}

export interface UpdatePresetInput {
  name?: string;
  providerId?: string;
  modelId?: string;
  reasoningLevel?: string;
  permissionMode?: PresetPermissionMode;
  environmentKind?: PresetEnvironmentKind;
  baseBranch?: string | null;
  machineId?: string | null;
  instructions?: string;
  builtin?: boolean;
}
