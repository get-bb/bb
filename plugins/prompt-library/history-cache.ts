import type { BbPluginApi, ComposerDraftReplacement } from "@get-bb/plugin-sdk";
import { promptFromHistory, type HistoryEntry } from "./history-prompt.js";

type ListHistory = BbPluginApi["sdk"]["experimental_promptHistory"]["list"];

const FULL_PAGE_LIMIT = "1000";
const NEWER_PAGE_LIMIT = "100";

export interface HistoryCandidate {
  id: string;
  createdAt: number;
  prompt: ComposerDraftReplacement;
  projectId: string;
  threadId: string;
}

function candidate(entry: HistoryEntry): HistoryCandidate {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    prompt: promptFromHistory(entry.input),
    projectId: entry.projectId,
    threadId: entry.threadId,
  };
}

export function createHistoryCache(list: ListHistory) {
  let candidates: HistoryCandidate[] = [];
  const knownIds = new Set<string>();
  let loaded = false;
  let pending: Promise<unknown> = Promise.resolve();

  async function loadUnknown(limit: string): Promise<HistoryCandidate[]> {
    const entries: HistoryCandidate[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await list({
        limit,
        ...(cursor !== null ? { cursor } : {}),
      });
      for (const entry of page.entries) {
        if (knownIds.has(entry.id)) return entries;
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push(candidate(entry));
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return entries;
  }

  return {
    refresh(): Promise<readonly HistoryCandidate[]> {
      const next = pending
        .catch(() => {})
        .then(async () => {
          const entries = await loadUnknown(
            loaded ? NEWER_PAGE_LIMIT : FULL_PAGE_LIMIT,
          );
          for (const entry of entries) knownIds.add(entry.id);
          candidates = [...entries, ...candidates];
          loaded = true;
          return candidates;
        });
      pending = next;
      return next;
    },
  };
}
