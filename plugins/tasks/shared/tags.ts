export const FOLDERS_TAG = "folders";
export const PROJECTS_TAG = "projects";
export const PRESETS_TAG = "presets";
export const ALL_TASKS_TAG = "tasks";
export const ACTIVE_TASKS_TAG = "active-tasks";
export const TASK_META_TAG = "task-meta";

export const projectTag = (projectId: string) => `project:${projectId}`;
export const projectTasksTag = (projectId: string) => `tasks:${projectId}`;
export const labelsTag = (projectId: string) => `labels:${projectId}`;
export const taskTag = (taskId: string) => `task:${taskId}`;
export const commentsTag = (taskId: string) => `comments:${taskId}`;
export const commentTag = (commentId: string) => `comment:${commentId}`;
export const attachmentsTag = (taskId: string) => `attachments:${taskId}`;
export const threadsTag = (taskId: string) => `threads:${taskId}`;
export const pullRequestsTag = (taskId: string) => `pull-requests:${taskId}`;

interface TaskRef {
  id: string;
  projectId: string;
}

export function taskListTags(input: {
  projectId?: string;
  activeOnly: boolean;
}): string[] {
  return [
    input.projectId === undefined
      ? ALL_TASKS_TAG
      : projectTasksTag(input.projectId),
    ...(input.activeOnly ? [ACTIVE_TASKS_TAG] : []),
  ];
}

export function taskReadTags(task: TaskRef | null): string[] {
  return task === null
    ? [ALL_TASKS_TAG]
    : [taskTag(task.id), projectTag(task.projectId)];
}

export function taskChangedTags(task: TaskRef): string[] {
  return [taskTag(task.id), ALL_TASKS_TAG, projectTasksTag(task.projectId)];
}

export function threadsChangedTags(taskId: string): string[] {
  return [threadsTag(taskId), ACTIVE_TASKS_TAG, TASK_META_TAG];
}

export function attachmentsChangedTags(
  taskId: string,
  commentId: string | null,
): string[] {
  return [
    taskTag(taskId),
    attachmentsTag(taskId),
    commentsTag(taskId),
    TASK_META_TAG,
    ...(commentId === null ? [] : [commentTag(commentId)]),
  ];
}

export function projectTasksChangedTags(projectId: string): string[] {
  return [
    PROJECTS_TAG,
    projectTag(projectId),
    ALL_TASKS_TAG,
    projectTasksTag(projectId),
    labelsTag(projectId),
    TASK_META_TAG,
  ];
}
