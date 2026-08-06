export const TASK_SORTS = ["manual", "priority", "due"] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

/** Default page size for task-list RPC and CLI requests. */
export const TASKS_PAGE_DEFAULT_LIMIT = 100;

/** Largest task page accepted by the database-backed list contract. */
export const TASKS_PAGE_MAX_LIMIT = 500;
