import type { ChangeEntry, ChangeTurn } from "../shared/contract.js";

export type GroupMode = "turn" | "file";

export interface ChangeGroup {
  key: string;
  entries: ChangeEntry[];
  turn: ChangeTurn | null;
  added: number;
  removed: number;
}

export function finalPathOf(entry: ChangeEntry): string {
  return entry.movePath ?? entry.path;
}

export function isAbsoluteWorkspacePath(path: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|[\\/])/u.test(path);
}

export function filterEntries(
  entries: readonly ChangeEntry[],
  options: { includeChildren: boolean; pathQuery: string },
): ChangeEntry[] {
  const needle = options.pathQuery.trim().toLowerCase();
  return entries.filter((entry) => {
    if (!options.includeChildren && entry.nestedThreadId !== null) {
      return false;
    }
    if (needle === "") return true;
    return (
      entry.path.toLowerCase().includes(needle) ||
      (entry.movePath ?? "").toLowerCase().includes(needle)
    );
  });
}

function turnOrder(turns: readonly ChangeTurn[]): Map<string, number> {
  return new Map(turns.map((turn, index) => [turn.turnId, index]));
}

export function groupByTurn(
  entries: readonly ChangeEntry[],
  turns: readonly ChangeTurn[],
): ChangeGroup[] {
  const order = turnOrder(turns);
  const byTurn = new Map<string, ChangeGroup>();
  for (const entry of entries) {
    const key = entry.turnId ?? "__earlier__";
    const existing = byTurn.get(key);
    if (existing !== undefined) {
      existing.entries.push(entry);
      existing.added += entry.added;
      existing.removed += entry.removed;
      continue;
    }
    byTurn.set(key, {
      key,
      entries: [entry],
      turn:
        entry.turnId === null
          ? null
          : (turns.find((turn) => turn.turnId === entry.turnId) ?? null),
      added: entry.added,
      removed: entry.removed,
    });
  }
  return [...byTurn.values()].sort((left, right) => {
    const leftIndex =
      left.turn === null ? -1 : (order.get(left.turn.turnId) ?? -1);
    const rightIndex =
      right.turn === null ? -1 : (order.get(right.turn.turnId) ?? -1);
    return leftIndex - rightIndex;
  });
}

export function groupByFile(entries: readonly ChangeEntry[]): ChangeGroup[] {
  const byPath = new Map<string, ChangeGroup>();
  for (const entry of entries) {
    const key = finalPathOf(entry);
    const existing = byPath.get(key);
    if (existing !== undefined) {
      existing.entries.push(entry);
      existing.added += entry.added;
      existing.removed += entry.removed;
      continue;
    }
    byPath.set(key, {
      key,
      entries: [entry],
      turn: null,
      added: entry.added,
      removed: entry.removed,
    });
  }
  return [...byPath.values()].sort((left, right) => {
    const leftLast = left.entries.at(-1)?.createdAt ?? 0;
    const rightLast = right.entries.at(-1)?.createdAt ?? 0;
    return rightLast - leftLast;
  });
}

export function groupEntries(
  entries: readonly ChangeEntry[],
  turns: readonly ChangeTurn[],
  mode: GroupMode,
): ChangeGroup[] {
  return mode === "turn"
    ? groupByTurn(entries, turns).reverse()
    : groupByFile(entries);
}
