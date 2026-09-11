import {
  arePromptDraftStatesEqual,
  isPromptDraftEmpty,
  parsePromptDraftStorage,
  type PromptDraftState,
} from "@bb/client-core";
import {
  environmentMachineSelectionSchema,
  jsonValueSchema,
  permissionModeSchema,
  reasoningLevelSchema,
  serviceTierSchema,
} from "@bb/domain";
import { nanoid } from "nanoid";
import { z } from "zod";

const DRAFT_STORAGE_PREFIX = "bb.new-thread-draft.1.";
const LEGACY_STORAGE_KEY = "bb.promptbox.contents-draft-3";
const LEGACY_IMPORT_STORAGE_KEY = "bb.new-thread-draft.legacy-import.1";

const draftIdSchema = z.string().min(1).max(200);
const destinationSchema = z.object({
  projectId: z.string().min(1),
  sectionId: z.string().min(1).nullable(),
});
const composerOptionsSchema = z.object({
  providerId: z.string(),
  model: z.string(),
  reasoningLevel: reasoningLevelSchema,
  serviceTier: serviceTierSchema.nullable(),
  permissionMode: permissionModeSchema,
  environmentSelectionValue: z.string(),
  environmentMachine: environmentMachineSelectionSchema.nullable(),
  environmentProviderInputs: jsonValueSchema.nullable(),
});
const storedDraftSchema = z.object({
  version: z.literal(1),
  lastEditedAt: z.number().int().nonnegative(),
  destination: destinationSchema,
  options: composerOptionsSchema.nullable(),
});
const legacyImportSchema = z.object({
  rawValue: z.string(),
  draftId: draftIdSchema,
});

export type NewThreadDraftDestination = z.infer<typeof destinationSchema>;
export type NewThreadDraftOptions = z.infer<typeof composerOptionsSchema>;

export interface NewThreadDraft {
  id: string;
  lastEditedAt: number;
  prompt: PromptDraftState;
  destination: NewThreadDraftDestination;
  options: NewThreadDraftOptions | null;
}

export function createNewThreadDraftId(): string {
  return nanoid();
}

export function newThreadDraftStorageKey(id: string): string {
  return `${DRAFT_STORAGE_PREFIX}${encodeURIComponent(draftIdSchema.parse(id))}`;
}

export function newThreadDraftIdFromStorageKey(key: string): string | null {
  if (!key.startsWith(DRAFT_STORAGE_PREFIX)) return null;
  try {
    const id = draftIdSchema.safeParse(
      decodeURIComponent(key.slice(DRAFT_STORAGE_PREFIX.length)),
    );
    return id.success ? id.data : null;
  } catch {
    return null;
  }
}

export function parseNewThreadDraft(
  id: string,
  rawValue: string | null,
): NewThreadDraft | null {
  if (rawValue === null || !draftIdSchema.safeParse(id).success) return null;
  try {
    const parsed: unknown = JSON.parse(rawValue);
    const result = storedDraftSchema.safeParse(parsed);
    if (!result.success) return null;
    const prompt = parsePromptDraftStorage(rawValue);
    if (isPromptDraftEmpty(prompt)) return null;
    return {
      id,
      prompt,
      lastEditedAt: result.data.lastEditedAt,
      destination: result.data.destination,
      options: result.data.options,
    };
  } catch {
    return null;
  }
}

export function serializeNewThreadDraft(draft: NewThreadDraft): string | null {
  if (isPromptDraftEmpty(draft.prompt)) return null;
  draftIdSchema.parse(draft.id);
  const metadata = storedDraftSchema.parse({
    version: 1,
    lastEditedAt: draft.lastEditedAt,
    destination: draft.destination,
    options: draft.options,
  });
  return JSON.stringify({ ...draft.prompt, ...metadata });
}

export function readNewThreadDrafts(storage: Storage): NewThreadDraft[] {
  const drafts: NewThreadDraft[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null) continue;
    const id = newThreadDraftIdFromStorageKey(key);
    if (id === null) continue;
    const draft = parseNewThreadDraft(id, storage.getItem(key));
    if (draft !== null) drafts.push(draft);
  }
  return drafts.sort(
    (left, right) =>
      right.lastEditedAt - left.lastEditedAt || left.id.localeCompare(right.id),
  );
}

function legacyImportId(rawValue: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < rawValue.length; index += 1) {
    hash = Math.imul(hash ^ rawValue.charCodeAt(index), 16_777_619);
  }
  return `legacy-${(hash >>> 0).toString(36)}`;
}

function readLegacyImport(storage: Storage) {
  const rawValue = storage.getItem(LEGACY_IMPORT_STORAGE_KEY);
  if (rawValue === null) return null;
  try {
    const parsed: unknown = JSON.parse(rawValue);
    const result = legacyImportSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function importLegacyNewThreadDraft({
  storage,
  destination,
  options,
  now,
}: {
  storage: Storage;
  destination: NewThreadDraftDestination;
  options: NewThreadDraftOptions | null;
  now: number;
}): string | null {
  const rawValue = storage.getItem(LEGACY_STORAGE_KEY);
  if (rawValue === null) return null;
  const priorImport = readLegacyImport(storage);
  if (priorImport?.rawValue === rawValue) return priorImport.draftId;
  const prompt = parsePromptDraftStorage(rawValue);
  if (isPromptDraftEmpty(prompt)) return null;

  const baseId = legacyImportId(rawValue);
  for (let suffix = 0; ; suffix += 1) {
    const id = suffix === 0 ? baseId : `${baseId}-${suffix}`;
    const key = newThreadDraftStorageKey(id);
    const existingRawValue = storage.getItem(key);
    if (existingRawValue !== null) {
      const existing = parseNewThreadDraft(id, existingRawValue);
      if (
        existing === null ||
        !arePromptDraftStatesEqual(existing.prompt, prompt)
      ) {
        continue;
      }
    } else {
      const serialized = serializeNewThreadDraft({
        id,
        prompt,
        destination,
        options,
        lastEditedAt: now,
      });
      if (serialized === null) return null;
      storage.setItem(key, serialized);
    }
    storage.setItem(
      LEGACY_IMPORT_STORAGE_KEY,
      JSON.stringify({ rawValue, draftId: id }),
    );
    return id;
  }
}
