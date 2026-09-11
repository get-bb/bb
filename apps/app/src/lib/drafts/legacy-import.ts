import { isPromptDraftEmpty, parsePromptDraftStorage } from "@bb/client-core";
import {
  draftContentSchema,
  draftIdSchema,
  draftPromptSchema,
  type Draft,
  type DraftContentInput,
} from "@bb/server-contract";
import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import {
  cacheDraftResource,
  invalidateDraftResources,
} from "@/hooks/cache-owners/draft-cache-owner";
import { appQueryClient } from "../app-query-client";
import { draftResourceApi, type DraftResourceApi } from "./resource-api";
import {
  browserDraftRecoveryStorage,
  type DraftRecoveryStorage,
} from "./recovery";

export const LEGACY_NEW_THREAD_DRAFT_KEY = "bb.promptbox.contents-draft-3";
export const LEGACY_DRAFT_IMPORT_PREFIX = "bb.draft-import.v1:";

const importRecordSchema = z.object({
  version: z.literal(1),
  id: draftIdSchema,
  rawValue: z.string(),
  content: draftContentSchema,
  acknowledged: z.boolean(),
});

interface LegacyDraftImportDependencies {
  api: Pick<DraftResourceApi, "create" | "get">;
  storage: DraftRecoveryStorage;
  queryClient: QueryClient;
}

export interface LegacyDraftImportResult {
  id: string | null;
  draft: Draft | null;
  newerLegacyValue: boolean;
  error: Error | null;
}

async function importId(rawValue: string): Promise<string> {
  const bytes = new TextEncoder().encode(rawValue);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `drf_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function importLegacyNewThreadDraft(
  seed: Omit<DraftContentInput, "prompt">,
  dependencies: LegacyDraftImportDependencies = {
    api: draftResourceApi,
    storage: browserDraftRecoveryStorage(),
    queryClient: appQueryClient,
  },
): Promise<LegacyDraftImportResult> {
  const { api, storage, queryClient } = dependencies;
  const result: LegacyDraftImportResult = {
    id: null,
    draft: null,
    newerLegacyValue: false,
    error: null,
  };
  try {
    const rawValue = storage.getItem(LEGACY_NEW_THREAD_DRAFT_KEY);
    if (rawValue === null) return result;
    const parsed: unknown = JSON.parse(rawValue);
    draftPromptSchema.parse(parsed);
    const prompt = parsePromptDraftStorage(rawValue);
    if (isPromptDraftEmpty(prompt)) return result;
    const id = await importId(rawValue);
    result.id = id;
    const key = `${LEGACY_DRAFT_IMPORT_PREFIX}${id}`;
    const run = async (): Promise<LegacyDraftImportResult> => {
      const saved = storage.getItem(key);
      const record =
        saved === null
          ? {
              version: 1 as const,
              id,
              rawValue,
              content: draftContentSchema.parse({ ...seed, prompt }),
              acknowledged: false,
            }
          : importRecordSchema.parse(JSON.parse(saved));
      if (record.id !== id || record.rawValue !== rawValue)
        throw new Error(
          "Legacy import recovery data does not match. The original has been retained.",
        );
      if (saved === null) storage.setItem(key, JSON.stringify(record));
      if (!record.acknowledged) {
        const response = await api.create(id, record.content);
        result.draft = response.draft;
        record.acknowledged = true;
        storage.setItem(key, JSON.stringify(record));
        await cacheDraftResource(queryClient, id, response.draft);
        await invalidateDraftResources(queryClient);
      } else {
        result.draft = await api.get(id);
        await cacheDraftResource(queryClient, id, result.draft);
      }
      const latest = storage.getItem(LEGACY_NEW_THREAD_DRAFT_KEY);
      if (latest === rawValue) storage.removeItem(LEGACY_NEW_THREAD_DRAFT_KEY);
      else result.newerLegacyValue = latest !== null;
      return result;
    };
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request(`bb.draft-import:${id}`, run);
    }
    return await run();
  } catch (error) {
    result.error =
      error instanceof Error
        ? error
        : new Error(
            "Could not import the old draft. Its original contents have been kept.",
          );
    return result;
  }
}
