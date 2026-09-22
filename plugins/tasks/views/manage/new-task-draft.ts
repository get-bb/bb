import { z } from "zod";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "../../shared/contract.js";

export const NEW_TASK_DRAFT_STORAGE_KEY = "bb-tasks:new-task-draft";
const NEW_TASK_DRAFT_VERSION = 1;

export interface NewTaskDraft {
  projectId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  labelIds: string[];
  dueDate: string;
}

const storedDraftSchema = z.object({
  version: z.literal(NEW_TASK_DRAFT_VERSION),
  projectId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  labelIds: z.array(z.string()),
  dueDate: z.string(),
});

export function hasDraftContent(draft: NewTaskDraft): boolean {
  return draft.title.trim() !== "" || draft.description.trim() !== "";
}

export function loadNewTaskDraft(): NewTaskDraft | null {
  try {
    const raw = window.localStorage.getItem(NEW_TASK_DRAFT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = storedDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { version: _version, ...draft } = parsed.data;
    return hasDraftContent(draft) ? draft : null;
  } catch {
    return null;
  }
}

export function storeNewTaskDraft(draft: NewTaskDraft): void {
  try {
    if (!hasDraftContent(draft)) {
      window.localStorage.removeItem(NEW_TASK_DRAFT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      NEW_TASK_DRAFT_STORAGE_KEY,
      JSON.stringify({ version: NEW_TASK_DRAFT_VERSION, ...draft }),
    );
  } catch {}
}

export function clearNewTaskDraft(): void {
  try {
    window.localStorage.removeItem(NEW_TASK_DRAFT_STORAGE_KEY);
  } catch {}
}
