/**
 * Client-local draft for the "New task" dialog so navigating away — which
 * unmounts the dialog — does not discard what the user has typed. Stored in the
 * browser profile like the view and sidebar preferences, so one client never
 * rewrites another connected to the same bb server.
 *
 * Only the free-text fields are kept. The project, status, parent, and labels
 * are reseeded from the invoking context on every open, so a restored draft can
 * never land in a project or parent the user did not choose this time.
 */
export const NEW_TASK_DRAFT_STORAGE_KEY = "bb-tasks:new-task-draft";
export const NEW_TASK_DRAFT_VERSION = 1 as const;

export interface NewTaskDraft {
  title: string;
  description: string;
}

interface StoredDocumentV1 {
  version: typeof NEW_TASK_DRAFT_VERSION;
  title: string;
  description: string;
}

function isBlank(draft: NewTaskDraft): boolean {
  return draft.title.trim() === "" && draft.description.trim() === "";
}

/**
 * Read the saved draft, or null when nothing usable is stored. Corrupt,
 * partial, blank, or future-version documents read as unset rather than throw.
 */
export function loadNewTaskDraft(): NewTaskDraft | null {
  try {
    const raw = window.localStorage.getItem(NEW_TASK_DRAFT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const version =
      typeof record.version === "number" && Number.isFinite(record.version)
        ? record.version
        : null;
    // No other versions shipped; refuse rather than invent fields.
    if (version !== null && version !== NEW_TASK_DRAFT_VERSION) return null;
    const draft: NewTaskDraft = {
      title: typeof record.title === "string" ? record.title : "",
      description:
        typeof record.description === "string" ? record.description : "",
    };
    return isBlank(draft) ? null : draft;
  } catch {
    return null;
  }
}

/** Persist the draft, or clear storage once every field is blank again. */
export function storeNewTaskDraft(draft: NewTaskDraft): void {
  try {
    if (isBlank(draft)) {
      clearNewTaskDraft();
      return;
    }
    const document: StoredDocumentV1 = {
      version: NEW_TASK_DRAFT_VERSION,
      title: draft.title,
      description: draft.description,
    };
    window.localStorage.setItem(
      NEW_TASK_DRAFT_STORAGE_KEY,
      JSON.stringify(document),
    );
  } catch {
    // Persistence is best-effort (private mode / storage disabled).
  }
}

/** Drop the saved draft, e.g. once the task has been created. */
export function clearNewTaskDraft(): void {
  try {
    window.localStorage.removeItem(NEW_TASK_DRAFT_STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}
