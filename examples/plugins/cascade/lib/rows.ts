// Row derivation. Rows are never stored — they are a projection of the flat
// thread index through one grouping key. Kept pure so it is unit-testable
// without a bb server.

export type GroupingMode = "sections" | "projects" | "hosts";

export interface CascadeColumn {
  threadId: string;
  title: string;
  projectId: string;
  sectionId: string | null;
  hostId: string | null;
  parentThreadId: string | null;
  status: string;
  displayStatus: string;
  branchName: string | null;
  pinned: boolean;
  pinSortKey: string | null;
  unread: boolean;
  needsAttention: boolean;
  activeWorkCount: number;
  /** Immutable, so it can anchor a stable column position. */
  createdAt: number;
}

export interface Named {
  id: string;
  name: string;
}

export interface CascadeIndex {
  sections: Named[];
  projects: Named[];
  hosts: Named[];
  threads: CascadeColumn[];
}

/** What dropping a thread into a row does. */
export type RowDrop =
  | { kind: "pin" }
  | { kind: "section"; sectionId: string | null }
  | { kind: "none" };

export interface CascadeRow {
  /** Stable identity used for focus memory, manual order, and drop targets. */
  key: string;
  name: string;
  kind: GroupingMode | "pinned" | "unsectioned";
  drop: RowDrop;
  /** True when this row's order is user-controlled. */
  reorderable: boolean;
  columns: CascadeColumn[];
}

export const PINNED_KEY = "__pinned";
export const UNSECTIONED_KEY = "__unsectioned";

/**
 * Applies a manual order to a group.
 *
 * Column position must never change on its own. A strip is a spatial layout —
 * you learn where a thread sits and reach for it — so reordering under the user
 * while they work in a column is the one thing it cannot do. That rules out
 * recency: `updatedAt` bumps on every turn, which would shuffle the strip
 * exactly when you are typing in it.
 *
 * So: threads named in `order` come first, in that order, and everything else
 * falls back to `createdAt` ascending. Creation time is immutable, so an
 * un-dragged thread has a fixed slot too, and a new one always appears at the
 * right-hand end rather than jumping to the front. Stale ids in `order` are
 * ignored rather than pruned, so a thread that leaves and returns keeps its
 * slot.
 */
function applyOrder(
  columns: CascadeColumn[],
  order: readonly string[] | undefined,
): CascadeColumn[] {
  const stable = [...columns].sort((a, b) => a.createdAt - b.createdAt);
  if (!order?.length) return stable;

  const remaining = new Map(stable.map((c) => [c.threadId, c]));
  const ordered: CascadeColumn[] = [];
  for (const threadId of order) {
    const column = remaining.get(threadId);
    if (!column) continue;
    remaining.delete(threadId);
    ordered.push(column);
  }
  return [...ordered, ...remaining.values()];
}

/**
 * Projects the flat index into rows.
 *
 * Pinned threads get their own row and appear ONLY there. bb's sidebar shows a
 * pinned thread twice (Pinned plus its section), which reads fine in a tree but
 * would put the same live column in two places you can scroll to — and make a
 * drag out of Pinned ambiguous. Here the row is exclusive, so dragging a thread
 * out of it unpins.
 *
 * Only sections and pinning are writable: a thread's project and host describe
 * where it actually lives, so those rows render read-only.
 *
 * Empty groups are dropped — a section with no threads has no strip to draw.
 */
export function buildRows(
  index: CascadeIndex,
  mode: GroupingMode,
  order: Record<string, string[]> = {},
): CascadeRow[] {
  const rows: CascadeRow[] = [];

  const pinned = index.threads.filter((thread) => thread.pinned);
  if (pinned.length) {
    rows.push({
      key: PINNED_KEY,
      name: "Pinned",
      kind: "pinned",
      drop: { kind: "pin" },
      reorderable: true,
      // Pinned order is server-side (`pinSortKey`), shared with the sidebar.
      columns: [...pinned].sort((a, b) =>
        (a.pinSortKey ?? "").localeCompare(b.pinSortKey ?? ""),
      ),
    });
  }

  const rest = index.threads.filter((thread) => !thread.pinned);
  const keyOf = (thread: CascadeColumn): string => {
    if (mode === "sections") return thread.sectionId ?? UNSECTIONED_KEY;
    if (mode === "projects") return thread.projectId;
    return thread.hostId ?? UNSECTIONED_KEY;
  };

  const byKey = new Map<string, CascadeColumn[]>();
  for (const thread of rest) {
    const key = keyOf(thread);
    const existing = byKey.get(key);
    if (existing) existing.push(thread);
    else byKey.set(key, [thread]);
  }

  const ordered: Named[] =
    mode === "sections"
      ? index.sections
      : mode === "projects"
        ? index.projects
        : index.hosts;

  for (const entry of ordered) {
    const columns = byKey.get(entry.id);
    if (!columns?.length) continue;
    rows.push({
      key: entry.id,
      name: entry.name,
      kind: mode,
      drop:
        mode === "sections"
          ? { kind: "section", sectionId: entry.id }
          : { kind: "none" },
      reorderable: true,
      columns: applyOrder(columns, order[entry.id]),
    });
  }

  const loose = byKey.get(UNSECTIONED_KEY);
  if (loose?.length) {
    rows.push({
      key: UNSECTIONED_KEY,
      name: mode === "hosts" ? "No machine" : "Unsectioned",
      kind: "unsectioned",
      drop:
        mode === "sections" ? { kind: "section", sectionId: null } : { kind: "none" },
      reorderable: true,
      columns: applyOrder(loose, order[UNSECTIONED_KEY]),
    });
  }

  return rows;
}

/** True when a thread can be dropped into this row at all. */
export function acceptsDrop(row: CascadeRow): boolean {
  return row.drop.kind !== "none";
}

/**
 * A column draws its parent connector only when the parent is the column
 * immediately to its left — that is what the connector actually claims.
 */
export function isAdjacentChild(
  columns: CascadeColumn[],
  index: number,
): boolean {
  const column = columns[index];
  if (!column?.parentThreadId || index === 0) return false;
  return columns[index - 1]?.threadId === column.parentThreadId;
}

/** Clamp a remembered focus index; `columns.length` is the draft slot. */
export function clampFocus(row: CascadeRow, remembered: number): number {
  return Math.max(0, Math.min(remembered, row.columns.length));
}

/** Move `threadId` to `to` within a row, returning the new id order. */
export function reorderIds(
  columns: CascadeColumn[],
  threadId: string,
  to: number,
): string[] {
  const ids = columns.map((column) => column.threadId);
  const from = ids.indexOf(threadId);
  if (from < 0) return ids;
  ids.splice(from, 1);
  ids.splice(from < to ? to - 1 : to, 0, threadId);
  return ids;
}
