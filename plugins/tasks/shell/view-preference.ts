import type { TaskViewMode } from "./routes.js";

/**
 * Client-local List/Board choice per project. Stored in the browser profile so
 * one client does not rewrite another client connected to the same bb server —
 * the same boundary as the sidebar and list preferences.
 *
 * A project route without an explicit `?view=` resolves through here, so
 * reopening a project restores the view the user last picked for it. Projects
 * never opened before fall back to the last view chosen anywhere, then to the
 * list.
 */
export const VIEW_PREFERENCE_STORAGE_KEY = "bb-tasks:view-preferences";
export const VIEW_PREFERENCE_VERSION = 1 as const;

export const DEFAULT_VIEW_MODE: TaskViewMode = "list";

interface StoredDocumentV1 {
  version: typeof VIEW_PREFERENCE_VERSION;
  /** View chosen most recently on any project; default for unseen projects. */
  lastUsed: TaskViewMode;
  projects: Record<string, TaskViewMode>;
}

function asViewMode(value: unknown): TaskViewMode | null {
  return value === "list" || value === "board" ? value : null;
}

interface ParsedStorage {
  lastUsed: TaskViewMode | null;
  projects: Record<string, unknown>;
  /** True when the document was written by a newer client. */
  isFutureVersion: boolean;
}

function readStorage(): ParsedStorage | null {
  try {
    const raw = window.localStorage.getItem(VIEW_PREFERENCE_STORAGE_KEY);
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
    // No older versions shipped; refuse rather than invent fields.
    if (version !== null && version < VIEW_PREFERENCE_VERSION) return null;
    const projects =
      record.projects !== null &&
      typeof record.projects === "object" &&
      !Array.isArray(record.projects)
        ? (record.projects as Record<string, unknown>)
        : {};
    return {
      lastUsed: asViewMode(record.lastUsed),
      projects,
      isFutureVersion: version !== null && version > VIEW_PREFERENCE_VERSION,
    };
  } catch {
    return null;
  }
}

export function loadViewMode(projectId: string): TaskViewMode {
  const document = readStorage();
  if (document === null) return DEFAULT_VIEW_MODE;
  return (
    asViewMode(document.projects[projectId]) ??
    document.lastUsed ??
    DEFAULT_VIEW_MODE
  );
}

/**
 * Persist the view for one project and make it the fallback for projects the
 * user has not opened yet. Refuses to overwrite storage written by a newer
 * client so older builds cannot down-convert a future document.
 */
export function storeViewMode(projectId: string, view: TaskViewMode): void {
  try {
    const existing = readStorage();
    if (existing?.isFutureVersion) return;
    const projects: Record<string, TaskViewMode> = {};
    for (const [id, value] of Object.entries(existing?.projects ?? {})) {
      const mode = asViewMode(value);
      if (mode !== null) projects[id] = mode;
    }
    projects[projectId] = view;
    const document: StoredDocumentV1 = {
      version: VIEW_PREFERENCE_VERSION,
      lastUsed: view,
      projects,
    };
    window.localStorage.setItem(
      VIEW_PREFERENCE_STORAGE_KEY,
      JSON.stringify(document),
    );
  } catch {
    // Persistence is best-effort (private mode / storage disabled).
  }
}
