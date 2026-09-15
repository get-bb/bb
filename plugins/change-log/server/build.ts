import {
  changeLogEntryLimit,
  changeLogPatchCharLimit,
  type ChangeEntry,
  type ChangeFile,
  type ChangeTotals,
  type ChangeTurn,
} from "../shared/contract.js";
import { getFileChangeAction } from "../shared/change-action.js";
import { collectTimelineChanges, type CollectedChange } from "./collect.js";
import type {
  PromptHistoryEntry,
  ThreadTimelineResult,
} from "./timeline-types.js";

const PROMPT_EXCERPT_MAX_CHARS = 120;

export interface ChangeLogThread {
  id: string;
  title: string;
  environmentId: string | null;
}

export interface BuildChangeLogInput {
  thread: ChangeLogThread;
  timeline: ThreadTimelineResult;
  prompts: readonly PromptHistoryEntry[];
}

export interface BuildChangeLogResult {
  thread: { id: string; title: string; environmentId: string | null };
  entries: ChangeEntry[];
  turns: ChangeTurn[];
  files: ChangeFile[];
  totals: ChangeTotals;
  page: {
    hasOlder: boolean;
    olderCursor: { anchorSeq: number; anchorId: string } | null;
  };
  truncated: boolean;
}

function toEntry(change: CollectedChange): ChangeEntry {
  const diff = change.diff;
  const tooLarge = diff !== null && diff.length > changeLogPatchCharLimit;
  return {
    rowId: change.rowId,
    threadId: change.threadId,
    turnId: change.turnId,
    seqStart: change.seqStart,
    seqEnd: change.seqEnd,
    createdAt: change.createdAt,
    path: change.path,
    movePath: change.movePath,
    action: getFileChangeAction(change),
    status: change.status,
    approvalStatus: change.approvalStatus,
    added: change.added,
    removed: change.removed,
    edits: 1,
    patch: tooLarge ? null : diff,
    patchTruncated: tooLarge,
    nestedThreadId: change.nestedThreadId,
  };
}

function finalPathOf(entry: ChangeEntry): string {
  return entry.movePath ?? entry.path;
}

function statusRank(status: ChangeEntry["status"]): number {
  switch (status) {
    case "error":
      return 3;
    case "interrupted":
      return 2;
    case "pending":
      return 1;
    case "completed":
      return 0;
  }
}

function mergeAdjacentEntry(
  previous: ChangeEntry,
  entry: ChangeEntry,
): ChangeEntry {
  return {
    ...previous,
    added: previous.added + entry.added,
    removed: previous.removed + entry.removed,
    edits: previous.edits + entry.edits,
    createdAt: Math.max(previous.createdAt, entry.createdAt),
    seqEnd: Math.max(previous.seqEnd, entry.seqEnd),
    status:
      statusRank(entry.status) > statusRank(previous.status)
        ? entry.status
        : previous.status,
    approvalStatus: entry.approvalStatus ?? previous.approvalStatus,
    patch: previous.patch ?? entry.patch,
    patchTruncated: previous.patchTruncated || entry.patchTruncated,
  };
}

function canMergeAdjacent(
  previous: ChangeEntry | undefined,
  entry: ChangeEntry,
): previous is ChangeEntry {
  if (previous === undefined) return false;
  if (previous.turnId !== entry.turnId) return false;
  if (finalPathOf(previous) !== finalPathOf(entry)) return false;
  return previous.patch === null || entry.patch === null;
}

function mergeSamePathWithinTurn(
  entries: readonly ChangeEntry[],
): ChangeEntry[] {
  const merged: ChangeEntry[] = [];
  for (const entry of entries) {
    const previous = merged.at(-1);
    if (canMergeAdjacent(previous, entry)) {
      merged[merged.length - 1] = mergeAdjacentEntry(previous, entry);
      continue;
    }
    merged.push(entry);
  }
  return merged;
}

function aggregateFiles(entries: readonly ChangeEntry[]): ChangeFile[] {
  const byPath = new Map<string, ChangeFile>();
  for (const entry of entries) {
    const path = finalPathOf(entry);
    const existing = byPath.get(path);
    byPath.set(path, {
      path,
      action: entry.action,
      added: (existing?.added ?? 0) + entry.added,
      removed: (existing?.removed ?? 0) + entry.removed,
      changes: (existing?.changes ?? 0) + 1,
      edits: (existing?.edits ?? 0) + entry.edits,
      lastCreatedAt: entry.createdAt,
    });
  }
  return [...byPath.values()].sort(
    (left, right) => right.lastCreatedAt - left.lastCreatedAt,
  );
}

function promptExcerptOf(entry: PromptHistoryEntry): string | null {
  const parts: string[] = [];
  for (const input of entry.input) {
    if (input.type !== "text") continue;
    if (input.visibility === "agent-only") continue;
    const text = input.text.replaceAll(/\s+/gu, " ").trim();
    if (text !== "") parts.push(text);
  }
  const joined = parts.join(" ").trim();
  if (joined === "") return null;
  return joined.length <= PROMPT_EXCERPT_MAX_CHARS
    ? joined
    : `${joined.slice(0, PROMPT_EXCERPT_MAX_CHARS - 1)}…`;
}

function buildTurns(
  turns: readonly {
    turnId: string;
    startedAt: number;
    completedAt: number | null;
    status: ChangeEntry["status"];
  }[],
  prompts: readonly PromptHistoryEntry[],
): ChangeTurn[] {
  const promptsAsc = [...prompts].sort(
    (left, right) => left.createdAt - right.createdAt,
  );
  const excerpts = new Map(
    promptsAsc.map((entry) => [entry.createdAt, promptExcerptOf(entry)]),
  );
  const promptTimes = promptsAsc.map((entry) => entry.createdAt);

  return turns.map((turn) => {
    let excerpt: string | null = null;
    for (let index = promptTimes.length - 1; index >= 0; index -= 1) {
      const at = promptTimes[index];
      if (at !== undefined && at <= turn.startedAt) {
        excerpt = excerpts.get(at) ?? null;
        break;
      }
    }
    return {
      turnId: turn.turnId,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
      durationMs:
        turn.completedAt === null
          ? null
          : Math.max(0, turn.completedAt - turn.startedAt),
      status: turn.status,
      promptExcerpt: excerpt,
    };
  });
}

export function buildChangeLog(
  input: BuildChangeLogInput,
): BuildChangeLogResult {
  const collected = collectTimelineChanges(
    input.timeline.rows,
    input.thread.id,
  );

  const allEntries = mergeSamePathWithinTurn(collected.changes.map(toEntry));
  const droppedForLimit = Math.max(0, allEntries.length - changeLogEntryLimit);
  const entries =
    droppedForLimit === 0 ? allEntries : allEntries.slice(droppedForLimit);

  const files = aggregateFiles(entries);
  const totals: ChangeTotals = {
    changes: entries.length,
    files: files.length,
    added: entries.reduce((sum, entry) => sum + entry.added, 0),
    removed: entries.reduce((sum, entry) => sum + entry.removed, 0),
    edits: entries.reduce((sum, entry) => sum + entry.edits, 0),
  };

  const page = input.timeline.timelinePage;

  return {
    thread: {
      id: input.thread.id,
      title: input.thread.title,
      environmentId: input.thread.environmentId,
    },
    entries,
    turns: buildTurns(collected.turns, input.prompts),
    files,
    totals,
    page: {
      hasOlder: page.hasOlderRows,
      olderCursor: page.olderCursor,
    },
    truncated:
      droppedForLimit > 0 || entries.some((entry) => entry.patchTruncated),
  };
}
