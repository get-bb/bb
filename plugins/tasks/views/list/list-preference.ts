import { z } from "zod";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "../../shared/contract.js";
import { TASK_SORTS, type TaskSort } from "../../shared/pagination.js";
import { EMPTY_FILTERS, type ListFilterState } from "./filter-bar.js";

export const LIST_PREFERENCE_STORAGE_KEY = "bb-tasks:list-preferences";
export const LIST_PREFERENCE_VERSION = 1 as const;

type ListPreferenceScope = "all" | "active" | `project:${string}`;

export interface ListPreference {
  filters: ListFilterState;
  sort: TaskSort;
}

export const DEFAULT_LIST_PREFERENCE: ListPreference = {
  filters: EMPTY_FILTERS,
  sort: "manual",
};

interface StoredDocumentV1 {
  version: typeof LIST_PREFERENCE_VERSION;
  scopes: Record<string, StoredJsonValue>;
}

const jsonValueSchema = z.json();
const listPreferenceInputSchema = jsonValueSchema.optional();
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const stringSchema = z.string();
const jsonArraySchema = z.array(jsonValueSchema);
const finiteNumberSchema = z.number().finite();
const taskSortSchema = z.enum(TASK_SORTS);
type StoredJsonValue = z.infer<typeof jsonValueSchema>;
type ListPreferenceInput = z.infer<typeof listPreferenceInputSchema>;

export function listPreferenceScope(
  projectId: string | null,
  activeOnly: boolean,
): ListPreferenceScope {
  if (activeOnly) return "active";
  if (projectId !== null) return `project:${projectId}`;
  return "all";
}

const STATUS_SET = new Set<string>(TASK_STATUSES);
const PRIORITY_SET = new Set<string>(TASK_PRIORITIES);
const SORT_SET = new Set<string>(TASK_SORTS);

function uniqueValidStatuses(values: ListPreferenceInput): TaskStatus[] {
  const parsedValues = jsonArraySchema.safeParse(values);
  if (!parsedValues.success) return [];
  const seen = new Set<TaskStatus>();
  const result: TaskStatus[] = [];
  for (const candidate of parsedValues.data) {
    const parsedValue = stringSchema.safeParse(candidate);
    if (!parsedValue.success) continue;
    const status = TASK_STATUSES.find((value) => value === parsedValue.data);
    if (status === undefined || !STATUS_SET.has(status)) continue;
    if (seen.has(status)) continue;
    seen.add(status);
    result.push(status);
  }
  return result;
}

function uniqueValidPriorities(values: ListPreferenceInput): TaskPriority[] {
  const parsedValues = jsonArraySchema.safeParse(values);
  if (!parsedValues.success) return [];
  const seen = new Set<TaskPriority>();
  const result: TaskPriority[] = [];
  for (const candidate of parsedValues.data) {
    const parsedValue = stringSchema.safeParse(candidate);
    if (!parsedValue.success) continue;
    const priority = TASK_PRIORITIES.find(
      (value) => value === parsedValue.data,
    );
    if (priority === undefined || !PRIORITY_SET.has(priority)) continue;
    if (seen.has(priority)) continue;
    seen.add(priority);
    result.push(priority);
  }
  return result;
}

function uniqueLabelNames(values: ListPreferenceInput): string[] {
  const parsedValues = jsonArraySchema.safeParse(values);
  if (!parsedValues.success) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of parsedValues.data) {
    const parsedValue = stringSchema.safeParse(candidate);
    if (!parsedValue.success) continue;
    const name = parsedValue.data.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function sanitizeSort(value: ListPreferenceInput): TaskSort {
  const parsedValue = taskSortSchema.safeParse(value);
  if (parsedValue.success && SORT_SET.has(parsedValue.data)) {
    return parsedValue.data;
  }
  return DEFAULT_LIST_PREFERENCE.sort;
}

export function sanitizeListPreference(raw: ListPreference): ListPreference;
export function sanitizeListPreference(
  raw: ListPreferenceInput,
): ListPreference;
export function sanitizeListPreference(
  raw: ListPreferenceInput | ListPreference,
): ListPreference {
  const parsedRaw = jsonObjectSchema.safeParse(raw);
  if (!parsedRaw.success) {
    return {
      filters: { ...EMPTY_FILTERS },
      sort: DEFAULT_LIST_PREFERENCE.sort,
    };
  }
  const record = parsedRaw.data;
  const parsedFilters = jsonObjectSchema.safeParse(record.filters);
  const filtersRaw = parsedFilters.success ? parsedFilters.data : record;
  return {
    filters: {
      statuses: uniqueValidStatuses(filtersRaw.statuses),
      priorities: uniqueValidPriorities(filtersRaw.priorities),
      labelNames: uniqueLabelNames(filtersRaw.labelNames),
    },
    sort: sanitizeSort(record.sort),
  };
}

interface ParsedStorage {
  version: number | null;
  scopes: Record<string, StoredJsonValue>;
  isFutureVersion: boolean;
}

function readStorage(): ParsedStorage | null {
  try {
    const raw = window.localStorage.getItem(LIST_PREFERENCE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = jsonObjectSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return null;
    }
    const record = parsed.data;
    const scopes = jsonObjectSchema.safeParse(record.scopes);
    if (!scopes.success) return null;
    const parsedVersion = finiteNumberSchema.safeParse(record.version);
    const version = parsedVersion.success ? parsedVersion.data : null;
    const isFutureVersion =
      version !== null && version > LIST_PREFERENCE_VERSION;
    if (version !== null && version < LIST_PREFERENCE_VERSION) {
      return null;
    }
    return {
      version,
      scopes: scopes.data,
      isFutureVersion,
    };
  } catch {
    return null;
  }
}

export function loadListPreference(scope: ListPreferenceScope): ListPreference {
  const document = readStorage();
  if (document === null) {
    return {
      filters: { ...EMPTY_FILTERS },
      sort: DEFAULT_LIST_PREFERENCE.sort,
    };
  }
  return sanitizeListPreference(document.scopes[scope]);
}

export function storeListPreference(
  scope: ListPreferenceScope,
  preference: ListPreference,
): void {
  const sanitized = sanitizeListPreference(preference);
  try {
    const existing = readStorage();
    if (existing?.isFutureVersion) {
      return;
    }
    const scopes = { ...(existing?.scopes ?? {}) };
    scopes[scope] = {
      filters: {
        statuses: sanitized.filters.statuses,
        priorities: sanitized.filters.priorities,
        labelNames: sanitized.filters.labelNames,
      },
      sort: sanitized.sort,
    };
    const document: StoredDocumentV1 = {
      version: LIST_PREFERENCE_VERSION,
      scopes,
    };
    window.localStorage.setItem(
      LIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify(document),
    );
  } catch {}
}
