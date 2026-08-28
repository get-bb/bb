import { z } from "zod";
import type { TaskViewMode } from "./routes.js";

export const VIEW_PREFERENCE_STORAGE_KEY = "bb-tasks:view-preferences";
export const VIEW_PREFERENCE_VERSION = 1 as const;

const DEFAULT_VIEW_MODE: TaskViewMode = "list";

interface StoredDocumentV1 {
  version: typeof VIEW_PREFERENCE_VERSION;
  lastUsed: TaskViewMode;
  projects: Record<string, TaskViewMode>;
}

const jsonValueSchema = z.json();
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const finiteNumberSchema = z.number().finite();
type StoredJsonValue = z.infer<typeof jsonValueSchema>;

function asViewMode(value: StoredJsonValue): TaskViewMode | null {
  return value === "list" || value === "board" ? value : null;
}

interface ParsedStorage {
  lastUsed: TaskViewMode | null;
  projects: Record<string, StoredJsonValue>;
  isFutureVersion: boolean;
}

function readStorage(): ParsedStorage | null {
  try {
    const raw = window.localStorage.getItem(VIEW_PREFERENCE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = jsonObjectSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return null;
    }
    const record = parsed.data;
    const parsedVersion = finiteNumberSchema.safeParse(record.version);
    const version = parsedVersion.success ? parsedVersion.data : null;
    if (version !== null && version < VIEW_PREFERENCE_VERSION) return null;
    const parsedProjects = jsonObjectSchema.safeParse(record.projects);
    const projects = parsedProjects.success ? parsedProjects.data : {};
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
  } catch {}
}
