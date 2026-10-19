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
  scope: HistoryEntry["scope"];
}

function candidate(entry: HistoryEntry): HistoryCandidate {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    prompt: promptFromHistory(entry.input),
    projectId: entry.projectId,
    threadId: entry.threadId,
    scope: entry.scope,
  };
}

export function createHistoryCache(
  list: ListHistory,
  onEntries: (entries: readonly HistoryCandidate[]) => Promise<void>,
  signal: AbortSignal,
) {
  let candidates: HistoryCandidate[] = [];
  const knownIds = new Set<string>();
  let loaded = false;
  let olderCursor: string | null = null;

  async function commit(entries: HistoryCandidate[], prepend: boolean) {
    signal.throwIfAborted();
    await onEntries(entries);
    for (const entry of entries) knownIds.add(entry.id);
    candidates = prepend
      ? [...entries, ...candidates]
      : [...candidates, ...entries];
  }

  async function load() {
    if (!loaded) {
      do {
        signal.throwIfAborted();
        const page = await list({
          limit: olderCursor === null ? NEWER_PAGE_LIMIT : FULL_PAGE_LIMIT,
          ...(olderCursor === null ? {} : { cursor: olderCursor }),
          signal,
        });
        await commit(
          page.entries
            .filter((entry) => !knownIds.has(entry.id))
            .map(candidate),
          false,
        );
        olderCursor = page.nextCursor;
        loaded = olderCursor === null;
      } while (!loaded);
      return;
    }
    const entries: HistoryCandidate[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      signal.throwIfAborted();
      const page = await list({
        limit: NEWER_PAGE_LIMIT,
        ...(cursor === null ? {} : { cursor }),
        signal,
      });
      for (const entry of page.entries) {
        if (knownIds.has(entry.id)) {
          await commit(entries, true);
          return;
        }
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push(candidate(entry));
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    await commit(entries, true);
  }

  return {
    snapshot: (): readonly HistoryCandidate[] => candidates,
    refresh: load,
  };
}
