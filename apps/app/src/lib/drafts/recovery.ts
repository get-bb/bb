import { draftContentSchema, draftIdSchema } from "@bb/server-contract";
import { z } from "zod";

export const DRAFT_RECOVERY_PREFIX = "bb.draft-recovery.v1:";

export const draftRecoverySchema = z.object({
  version: z.literal(1),
  id: draftIdSchema,
  content: draftContentSchema,
  baseRevision: z.number().int().positive().nullable(),
  createContent: draftContentSchema.nullable(),
  submission: z
    .object({
      revision: z.number().int().positive(),
      content: draftContentSchema,
    })
    .nullable(),
  blocked: z.enum(["conflict", "deleted"]).nullable(),
  deleteRequested: z.boolean(),
  forceRevision: z.boolean(),
  updatedAt: z.number().nonnegative(),
});

export type DraftRecovery = z.infer<typeof draftRecoverySchema>;

export interface StoredDraftRecovery {
  key: string;
  raw: string;
  value: DraftRecovery;
}

export type DraftRecoveryStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

export function readDraftRecoveries(
  storage: DraftRecoveryStorage,
  id?: string,
): {
  records: StoredDraftRecovery[];
  error: Error | null;
} {
  const records: StoredDraftRecovery[] = [];
  let error: Error | null = null;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(DRAFT_RECOVERY_PREFIX)) continue;
      if (id !== undefined && !key.startsWith(`${DRAFT_RECOVERY_PREFIX}${id}:`))
        continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        const value = draftRecoverySchema.parse(parsed);
        if (id === undefined || value.id === id)
          records.push({ key, raw, value });
      } catch {
        error = new Error(
          "Some draft recovery data could not be read. It has been kept in browser storage.",
        );
      }
    }
  } catch {
    error = new Error(
      "Browser storage is unavailable. Keep this page open until your draft is saved.",
    );
  }
  return {
    records: records.sort((a, b) => b.value.updatedAt - a.value.updatedAt),
    error,
  };
}

export function removeUnchangedRecovery(
  storage: DraftRecoveryStorage,
  record: Pick<StoredDraftRecovery, "key" | "raw">,
): void {
  if (storage.getItem(record.key) === record.raw)
    storage.removeItem(record.key);
}

export function browserDraftRecoveryStorage(): DraftRecoveryStorage {
  return {
    get length() {
      return window.localStorage.length;
    },
    key: (index) => window.localStorage.key(index),
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  };
}
