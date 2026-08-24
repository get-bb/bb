import { isRowExpandable } from "@bb/client-core";
import type {
  TimelineConversationRow,
  TimelineRow,
  TimelineSystemRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import {
  assertNever,
  buildTimelineRowTitle,
  buildTimelineViewRows,
  createTimelineViewRowsCache,
  findActiveLatestBundleId,
  type BuildTimelineRowTitleOptions,
  type ThreadTimelineViewRow,
  type TimelineTitle,
  type TimelineViewTurnRow,
  type TimelineViewWorkRow,
} from "@bb/thread-view";

/**
 * Pure projection of the loaded timeline rows onto the flat list the native
 * FlashList renders. Grouping (step/bundle summaries, `inClosedStep`) comes
 * from `@bb/thread-view`'s `buildTimelineViewRows`; titles from
 * `buildTimelineRowTitle`. Container rows — delegations, step/bundle
 * summaries, turns — contribute their children as *flat* items one depth
 * level down while expanded, so every row stays its own virtualized cell
 * (no nested lists inside cells).
 */

export type TimelineWorkRowKind = `work:${TimelineViewWorkRow["workKind"]}`;

export type TimelineRowKind =
  | "conversation:user"
  | "conversation:assistant"
  | TimelineWorkRowKind
  | "system"
  | "turn"
  | "step-summary"
  | "bundle-summary";

/** Every row kind, for exhaustive registry checks. */
export const TIMELINE_ROW_KINDS: readonly TimelineRowKind[] = [
  "conversation:user",
  "conversation:assistant",
  "work:command",
  "work:tool",
  "work:file-change",
  "work:web-search",
  "work:web-fetch",
  "work:image-view",
  "work:file-read",
  "work:search",
  "work:plan-steps",
  "work:extension",
  "work:approval",
  "work:question",
  "work:delegation",
  "work:workflow",
  "system",
  "turn",
  "step-summary",
  "bundle-summary",
];

type TimelineViewWorkRowOfKind<K extends TimelineViewWorkRow["workKind"]> =
  Extract<TimelineViewWorkRow, { workKind: K }>;

/** The narrowed view row each kind carries in `TimelineListItem.row`. */
interface TimelineRowByKind {
  "conversation:user": TimelineUserConversationRow;
  "conversation:assistant": Extract<
    TimelineConversationRow,
    { role: "assistant" }
  >;
  "work:command": TimelineViewWorkRowOfKind<"command">;
  "work:tool": TimelineViewWorkRowOfKind<"tool">;
  "work:file-change": TimelineViewWorkRowOfKind<"file-change">;
  "work:web-search": TimelineViewWorkRowOfKind<"web-search">;
  "work:web-fetch": TimelineViewWorkRowOfKind<"web-fetch">;
  "work:image-view": TimelineViewWorkRowOfKind<"image-view">;
  "work:file-read": TimelineViewWorkRowOfKind<"file-read">;
  "work:search": TimelineViewWorkRowOfKind<"search">;
  "work:plan-steps": TimelineViewWorkRowOfKind<"plan-steps">;
  "work:extension": TimelineViewWorkRowOfKind<"extension">;
  "work:approval": TimelineViewWorkRowOfKind<"approval">;
  "work:question": TimelineViewWorkRowOfKind<"question">;
  "work:delegation": TimelineViewWorkRowOfKind<"delegation">;
  "work:workflow": TimelineViewWorkRowOfKind<"workflow">;
  system: TimelineSystemRow;
  turn: TimelineViewTurnRow;
  "step-summary": Extract<ThreadTimelineViewRow, { kind: "step-summary" }>;
  "bundle-summary": Extract<ThreadTimelineViewRow, { kind: "bundle-summary" }>;
}

/** Load state of a completed turn's lazily fetched children. */
type TimelineLazyChildrenStatus = "loading" | "error" | "loaded";

interface TimelineListItemOfKind<K extends TimelineRowKind> {
  /** Stable across rebuilds: the row id, prefixed by the container chain. */
  key: string;
  kind: K;
  /** The view row narrowed to `kind`; same object as `viewRow`. */
  row: TimelineRowByKind[K];
  /** The unnarrowed `@bb/thread-view` view row (grouping-aware). */
  viewRow: ThreadTimelineViewRow;
  title: TimelineTitle;
  /** 0 for top-level rows; +1 per enclosing container. */
  depth: number;
  /** Key of the enclosing container item, null at the top level. */
  parentKey: string | null;
  /** Kind of the enclosing container item, null at the top level. */
  parentKind: TimelineRowKind | null;
  /**
   * Whether the scope this row sits in is still producing rows (thread
   * running at the top level; a pending delegation inside an active scope).
   * Drives present-tense titles and the shimmer treatment.
   */
  scopeActive: boolean;
  /** Whether this row can be expanded (has a body / children). */
  expandable: boolean;
  /**
   * Whether the row's body/children are currently shown. Part of the item so
   * a disclosure change replaces exactly the affected items (and their
   * flattened children), which is what the memoized list cells key off.
   */
  expanded: boolean;
  /** Set on expanded turn rows whose children come from the lazy endpoint. */
  lazyChildren: TimelineLazyChildrenStatus | null;
}

export type TimelineListItem = {
  [K in TimelineRowKind]: TimelineListItemOfKind<K>;
}[TimelineRowKind];

/** Lazily loaded children of one turn row, keyed by the turn item's key. */
export type TimelineTurnChildrenState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; rows: readonly TimelineRow[] };

interface BuildTimelineListItemsArgs {
  rows: readonly TimelineRow[];
  /** Thread runtime is running (top-level scope active). */
  scopeActive: boolean;
  /** Row ids whose body/children are currently shown. */
  isExpanded: (rowId: string) => boolean;
  /** Lazy children for expanded turn rows without inline children. */
  turnChildren?: ReadonlyMap<string, TimelineTurnChildrenState>;
  /** Reuse across rebuilds so untouched subtrees keep their view-row identity. */
  cache?: ReturnType<typeof createTimelineViewRowsCache>;
  /** Reuse across rebuilds so unchanged rows keep their title object. */
  titleCache?: TimelineTitleCache;
  /**
   * Reuse across rebuilds so items whose every field is unchanged keep their
   * object identity (the list cells are memoized on it).
   */
  itemCache?: TimelineListItemCache;
}

function timelineRowKind(row: ThreadTimelineViewRow): TimelineRowKind {
  switch (row.kind) {
    case "conversation":
      return row.role === "user"
        ? "conversation:user"
        : "conversation:assistant";
    case "work":
      return `work:${row.workKind}`;
    case "system":
    case "turn":
    case "step-summary":
    case "bundle-summary":
      return row.kind;
    default:
      return assertNever(row);
  }
}

/**
 * Title options per row (mirrors `timelineRowTitleOptions` in the web
 * ThreadTimelineRows): bundle summaries split verb/rest so the verb can
 * shimmer while they are the active frontier; step summaries are a flat
 * recap; closed-step leaves take the muted summary style.
 */
function timelineRowTitleOptions({
  activeLatestBundleId,
  row,
  scopeActive,
}: {
  activeLatestBundleId: string | null;
  row: ThreadTimelineViewRow;
  scopeActive: boolean;
}): BuildTimelineRowTitleOptions {
  return {
    summaryStyle: row.kind === "step-summary" ? "background" : "bundle",
    workStyle:
      row.kind === "work" && row.inClosedStep === true ? "summary" : "default",
    isActiveLatestBundle:
      row.kind === "bundle-summary" &&
      scopeActive &&
      row.id === activeLatestBundleId,
  };
}

type TimelineTitleCache = WeakMap<
  ThreadTimelineViewRow,
  { optionsKey: string; title: TimelineTitle }
>;

export function createTimelineTitleCache(): TimelineTitleCache {
  return new WeakMap();
}

function titleOptionsKey(options: BuildTimelineRowTitleOptions): string {
  return `${options.summaryStyle}|${options.workStyle}|${options.isActiveLatestBundle ? 1 : 0}`;
}

function buildRowTitle(
  row: ThreadTimelineViewRow,
  options: BuildTimelineRowTitleOptions,
  cache: TimelineTitleCache | undefined,
): TimelineTitle {
  const optionsKey = titleOptionsKey(options);
  const cached = cache?.get(row);
  if (cached && cached.optionsKey === optionsKey) return cached.title;
  const title = buildTimelineRowTitle(row, options);
  cache?.set(row, { optionsKey, title });
  return title;
}

/**
 * Items from the previous build keyed by item key. Only the latest build's
 * items are retained: `buildTimelineListItems` swaps `current` for the map it
 * produced, so rows that left the list are dropped.
 */
interface TimelineListItemCache {
  current: ReadonlyMap<string, TimelineListItem>;
}

export function createTimelineListItemCache(): TimelineListItemCache {
  return { current: new Map() };
}

function isSameListItem(a: TimelineListItem, b: TimelineListItem): boolean {
  return (
    a.key === b.key &&
    a.kind === b.kind &&
    a.row === b.row &&
    a.title === b.title &&
    a.depth === b.depth &&
    a.parentKey === b.parentKey &&
    a.parentKind === b.parentKind &&
    a.scopeActive === b.scopeActive &&
    a.expandable === b.expandable &&
    a.expanded === b.expanded &&
    a.lazyChildren === b.lazyChildren
  );
}

interface VisitScope {
  depth: number;
  parentKey: string | null;
  parentKind: TimelineRowKind | null;
  scopeActive: boolean;
}

function itemKey(parentKey: string | null, rowId: string): string {
  return parentKey === null ? rowId : `${parentKey}>${rowId}`;
}

export function buildTimelineListItems({
  rows,
  scopeActive,
  isExpanded,
  turnChildren,
  cache,
  titleCache,
  itemCache,
}: BuildTimelineListItemsArgs): TimelineListItem[] {
  const viewCache = cache ?? createTimelineViewRowsCache();
  const viewRows = buildTimelineViewRows(rows, { cache: viewCache });
  const items: TimelineListItem[] = [];
  const previousItems = itemCache?.current;
  const nextItems = itemCache ? new Map<string, TimelineListItem>() : null;

  const visit = (
    scopeRows: readonly ThreadTimelineViewRow[],
    scope: VisitScope,
  ): void => {
    const activeLatestBundleId = findActiveLatestBundleId(scopeRows);
    for (const row of scopeRows) {
      const key = itemKey(scope.parentKey, row.id);
      const kind = timelineRowKind(row);
      const title = buildRowTitle(
        row,
        timelineRowTitleOptions({
          activeLatestBundleId,
          row,
          scopeActive: scope.scopeActive,
        }),
        titleCache,
      );
      const expanded = isExpanded(row.id);
      let lazyChildren: TimelineLazyChildrenStatus | null = null;
      let children: readonly ThreadTimelineViewRow[] | null = null;
      let childScopeActive = false;
      if (expanded) {
        switch (row.kind) {
          case "work":
            if (row.workKind === "delegation" && row.childRows.length > 0) {
              children = row.childRows;
              childScopeActive = scope.scopeActive && row.status === "pending";
            }
            break;
          case "step-summary":
          case "bundle-summary":
            children = row.children;
            break;
          case "turn":
            if (row.children !== null) {
              children = row.children;
            } else {
              const lazy = turnChildren?.get(key);
              if (lazy === undefined || lazy.status === "loading") {
                lazyChildren = "loading";
              } else if (lazy.status === "error") {
                lazyChildren = "error";
              } else {
                lazyChildren = "loaded";
                // Lazy turn children belong to a completed turn: a closed
                // scope, so trailing work collapses into a step-summary.
                children = buildTimelineViewRows(lazy.rows, {
                  cache: viewCache,
                  closedScope: true,
                });
              }
            }
            break;
          case "conversation":
          case "system":
            break;
          default:
            assertNever(row);
        }
      }
      // The per-kind narrowing is exactly what `timelineRowKind` computed
      // from `row`; the union cannot express that link without a cast.
      const built = {
        key,
        kind,
        row,
        viewRow: row,
        title,
        depth: scope.depth,
        parentKey: scope.parentKey,
        parentKind: scope.parentKind,
        scopeActive: scope.scopeActive,
        expandable: isRowExpandable(row),
        expanded,
        lazyChildren,
      } as TimelineListItem;
      const previous = previousItems?.get(key);
      const item =
        previous !== undefined && isSameListItem(previous, built)
          ? previous
          : built;
      nextItems?.set(key, item);
      items.push(item);
      if (children && children.length > 0) {
        visit(children, {
          depth: scope.depth + 1,
          parentKey: key,
          parentKind: kind,
          scopeActive: childScopeActive,
        });
      }
    }
  };

  visit(viewRows, { depth: 0, parentKey: null, parentKind: null, scopeActive });
  if (itemCache && nextItems) itemCache.current = nextItems;
  return items;
}
