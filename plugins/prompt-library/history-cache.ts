import type { BbPluginApi, ComposerDraftReplacement } from "@get-bb/plugin-sdk";
import { promptFromHistory, type HistoryEntry } from "./history-prompt.js";

type ListHistory = BbPluginApi["sdk"]["promptHistory"]["list"];

const OLDER_PAGE_LIMIT = "1000";
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
  let started = false;
  let olderCursor: string | null = null;
  let pending: Promise<unknown> = Promise.resolve();

  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const next = pending.catch(() => {}).then(task);
    pending = next;
    return next;
  }

  async function loadOlderPage(): Promise<void> {
    const page = await list({
      limit: OLDER_PAGE_LIMIT,
      ...(olderCursor !== null ? { cursor: olderCursor } : {}),
    });
    const older: HistoryCandidate[] = [];
    for (const entry of page.entries) {
      if (knownIds.has(entry.id)) continue;
      knownIds.add(entry.id);
      older.push(candidate(entry));
    }
    candidates = [...candidates, ...older];
    olderCursor = page.nextCursor;
    started = true;
  }

  async function loadNewer(): Promise<void> {
    const newer: HistoryCandidate[] = [];
    let cursor: string | null = null;
    let reachedKnown = false;
    do {
      const page = await list({
        limit: NEWER_PAGE_LIMIT,
        ...(cursor !== null ? { cursor } : {}),
      });
      for (const entry of page.entries) {
        if (knownIds.has(entry.id)) {
          reachedKnown = true;
          break;
        }
        knownIds.add(entry.id);
        newer.push(candidate(entry));
      }
      cursor = page.nextCursor;
    } while (!reachedKnown && cursor !== null);
    if (newer.length > 0) candidates = [...newer, ...candidates];
  }

  return {
    refresh(): Promise<readonly HistoryCandidate[]> {
      return serialized(async () => {
        await (started ? loadNewer() : loadOlderPage());
        return candidates;
      });
    },
    loadOlder(): Promise<readonly HistoryCandidate[] | null> {
      return serialized(async () => {
        if (olderCursor === null) return null;
        await loadOlderPage();
        return candidates;
      });
    },
  };
}
