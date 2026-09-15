import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk";
import {
  experimental_Diff as Diff,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  changeLogRpcContract,
  type ChangeEntry,
  type ChangePage,
  type ChangeTurn,
  type TimelineCursor,
} from "../shared/contract.js";
import {
  CHANGE_ACTION_ICON,
  CHANGE_ACTION_LABEL,
} from "../shared/change-action.js";
import {
  filterEntries,
  finalPathOf,
  groupEntries,
  isAbsoluteWorkspacePath,
  type ChangeGroup,
  type GroupMode,
} from "../lib/grouping.js";
import {
  formatClockTime,
  formatDurationRange,
  formatFullDateTime,
  formatRelativeTime,
  truncateMiddle,
} from "../lib/format.js";

const REALTIME_CHANNEL = "change-log";
const PATH_TRUNCATE_LENGTH = 64;
const POLL_INTERVAL_MS = 20_000;

interface ReadyState {
  status: "ready";
  thread: { id: string; title: string; environmentId: string | null };
  entries: ChangeEntry[];
  turns: ChangeTurn[];
  page: ChangePage;
  truncated: boolean;
}

type PanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ReadyState;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isThreadSignal(payload: unknown, threadId: string): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { threadId?: unknown }).threadId === threadId
  );
}

function mergeEntries(
  older: readonly ChangeEntry[],
  newer: readonly ChangeEntry[],
): ChangeEntry[] {
  const seen = new Set<string>();
  const merged: ChangeEntry[] = [];
  for (const entry of [...older, ...newer]) {
    if (seen.has(entry.rowId)) continue;
    seen.add(entry.rowId);
    merged.push(entry);
  }
  return merged;
}

function mergeTurns(
  older: readonly ChangeTurn[],
  newer: readonly ChangeTurn[],
): ChangeTurn[] {
  const byId = new Map<string, ChangeTurn>();
  for (const turn of [...older, ...newer]) {
    byId.set(turn.turnId, turn);
  }
  return [...byId.values()].sort(
    (left, right) => left.startedAt - right.startedAt,
  );
}

function turnNumber(
  turn: ChangeTurn | null,
  turns: readonly ChangeTurn[],
): number | null {
  if (turn === null) return null;
  const index = turns.findIndex((entry) => entry.turnId === turn.turnId);
  return index === -1 ? null : index + 1;
}

interface ChangeEntryRowProps {
  entry: ChangeEntry;
  expanded: boolean;
  now: number;
  onOpenFile: ((entry: ChangeEntry) => void) | null;
  onToggle: (rowId: string) => void;
}

function ChangeEntryRow({
  entry,
  expanded,
  now,
  onOpenFile,
  onToggle,
}: ChangeEntryRowProps) {
  const path = finalPathOf(entry);
  const canOpenFile = onOpenFile !== null && !isAbsoluteWorkspacePath(path);
  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => onToggle(entry.rowId)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/50"
      >
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          className="size-3.5 shrink-0 text-subtle-foreground"
          aria-hidden="true"
        />
        <Icon
          name={CHANGE_ACTION_ICON[entry.action]}
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
          title={path}
        >
          {truncateMiddle(path, PATH_TRUNCATE_LENGTH)}
        </span>
        {entry.nestedThreadId !== null ? (
          <Badge variant="outline" className="shrink-0 text-2xs font-normal">
            child
          </Badge>
        ) : null}
        {entry.approvalStatus !== null ? (
          <Badge variant="secondary" className="shrink-0 text-2xs font-normal">
            {entry.approvalStatus === "denied" ? "denied" : "waiting"}
          </Badge>
        ) : null}
        {entry.added + entry.removed > 0 ? (
          <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{entry.added}
            </span>{" "}
            <span className="text-rose-600 dark:text-rose-400">
              −{entry.removed}
            </span>
          </span>
        ) : (
          <span className="shrink-0 text-2xs text-subtle-foreground">
            changed
          </span>
        )}
        {entry.edits > 1 ? (
          <Badge variant="outline" className="shrink-0 text-2xs font-normal">
            {entry.edits} edits
          </Badge>
        ) : null}
        <span
          className="shrink-0 text-2xs tabular-nums text-subtle-foreground"
          title={formatFullDateTime(entry.createdAt)}
        >
          {formatClockTime(entry.createdAt)}
        </span>
      </button>
      {expanded ? (
        <div className="space-y-2 px-3 pb-3">
          <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
            <span>
              {CHANGE_ACTION_LABEL[entry.action]} ·{" "}
              {formatRelativeTime(entry.createdAt, now)}
              {entry.edits > 1
                ? ` · ${entry.edits} edits${
                    entry.patch === null ? "" : ", showing the earliest patch"
                  }`
                : ""}
            </span>
            {canOpenFile ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 text-2xs"
                onClick={() => onOpenFile?.(entry)}
              >
                Open file
              </Button>
            ) : null}
          </div>
          {entry.patch !== null ? (
            <div className="overflow-hidden rounded-md border border-border">
              <Diff patch={entry.patch} path={path} />
            </div>
          ) : (
            <p className="text-2xs text-muted-foreground">
              {entry.patchTruncated
                ? "Patch is too large to preview here."
                : "No patch text was recorded for this change."}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}

interface GroupSectionProps {
  group: ChangeGroup;
  groupBy: GroupMode;
  now: number;
  expandedRows: ReadonlySet<string>;
  onOpenFile: ((entry: ChangeEntry) => void) | null;
  onToggle: (rowId: string) => void;
  turns: readonly ChangeTurn[];
}

function ChangeGroupSection({
  group,
  groupBy,
  now,
  expandedRows,
  onOpenFile,
  onToggle,
  turns,
}: GroupSectionProps) {
  const number = turnNumber(group.turn, turns);
  const header =
    groupBy === "turn"
      ? [
          number === null ? "Earlier changes" : `Turn ${number}`,
          group.turn?.promptExcerpt ?? null,
        ]
          .filter((part) => part !== null && part !== "")
          .join(" — ")
      : group.key;
  const startedAt = group.turn?.startedAt ?? group.entries[0]?.createdAt ?? 0;
  const duration = group.turn
    ? formatDurationRange(group.turn.durationMs, group.turn.startedAt, now)
    : null;

  return (
    <section>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1 backdrop-blur">
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
          title={header}
        >
          {header}
        </span>
        <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
          {group.added + group.removed > 0
            ? `+${group.added} −${group.removed}`
            : "changed"}
        </span>
        <span
          className="shrink-0 text-2xs tabular-nums text-subtle-foreground"
          title={formatFullDateTime(startedAt)}
        >
          {formatClockTime(startedAt)}
          {duration === null ? "" : ` · ${duration}`}
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {group.entries.map((entry) => (
          <ChangeEntryRow
            key={entry.rowId}
            entry={entry}
            expanded={expandedRows.has(entry.rowId)}
            now={now}
            onOpenFile={onOpenFile}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </section>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3 p-3">
      <Skeleton className="h-4 w-40 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-[88%] rounded-sm" />
      <Skeleton className="h-3 w-[76%] rounded-sm" />
    </div>
  );
}

export function ChangeLogPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof changeLogRpcContract>();
  const navigate = useBbNavigate();
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupMode>("turn");
  const [includeChildren, setIncludeChildren] = useState(true);
  const [pathQuery, setPathQuery] = useState("");
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [now, setNow] = useState(() => Date.now());
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (cursor: TimelineCursor | null, mode: "replace" | "append") => {
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      if (mode === "replace") {
        setState({ status: "loading" });
      } else {
        setLoadingOlder(true);
      }
      try {
        const result = await rpc.call("listChanges", {
          threadId,
          ...(cursor === null
            ? {}
            : {
                beforeAnchorSeq: cursor.anchorSeq,
                beforeAnchorId: cursor.anchorId,
              }),
        });
        if (requestIdRef.current !== requestId) return;
        setState((previous) =>
          mode === "append" && previous.status === "ready"
            ? {
                status: "ready",
                thread: result.thread,
                entries: mergeEntries(result.entries, previous.entries),
                turns: mergeTurns(result.turns, previous.turns),
                page: result.page,
                truncated: previous.truncated || result.truncated,
              }
            : {
                status: "ready",
                thread: result.thread,
                entries: result.entries,
                turns: result.turns,
                page: result.page,
                truncated: result.truncated,
              },
        );
      } catch (error) {
        if (requestIdRef.current !== requestId) return;
        setState({ status: "error", message: messageOf(error) });
      } finally {
        if (requestIdRef.current === requestId) setLoadingOlder(false);
      }
    },
    [rpc, threadId],
  );

  useEffect(() => {
    void load(null, "replace");
  }, [load]);

  useRealtime(REALTIME_CHANNEL, (payload) => {
    if (isThreadSignal(payload, threadId)) {
      void load(null, "replace");
    }
  });

  const connectionState = useRealtimeConnectionState();
  const previousConnectionState = useRef(connectionState);
  useEffect(() => {
    if (
      previousConnectionState.current !== "connected" &&
      connectionState === "connected"
    ) {
      void load(null, "replace");
    }
    previousConnectionState.current = connectionState;
  }, [connectionState, load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(null, "replace");
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const toggleRow = useCallback((rowId: string) => {
    setExpandedRows((previous) => {
      const next = new Set(previous);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const openFile = useCallback(
    (entry: ChangeEntry) => {
      if (state.status !== "ready") return;
      const environmentId = state.thread.environmentId;
      if (environmentId === null) return;
      navigate.experimental_openFilePreview({
        target: {
          kind: "workspace",
          environmentId,
          path: finalPathOf(entry),
        },
        location: null,
      });
    },
    [navigate, state],
  );

  const groups = useMemo(() => {
    if (state.status !== "ready") return [];
    const filtered = filterEntries(state.entries, {
      includeChildren,
      pathQuery,
    });
    return groupEntries(filtered, state.turns, groupBy);
  }, [state, includeChildren, pathQuery, groupBy]);

  const totals = useMemo(() => {
    if (state.status !== "ready") return null;
    const visible = filterEntries(state.entries, {
      includeChildren,
      pathQuery,
    });
    const files = new Set<string>();
    let added = 0;
    let removed = 0;
    for (const entry of visible) {
      files.add(finalPathOf(entry));
      added += entry.added;
      removed += entry.removed;
    }
    return { changes: visible.length, files: files.size, added, removed };
  }, [state, includeChildren, pathQuery]);

  if (state.status === "loading") {
    return <PanelSkeleton />;
  }

  if (state.status === "error") {
    return (
      <div className="space-y-3 p-3">
        <EmptyState message={state.message} icon="AlertCircle" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load(null, "replace")}
        >
          <Icon name="RotateCcw" className="size-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon
            name="Clock"
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-foreground">Changes</span>
          {totals !== null ? (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {totals.changes} changes · {totals.files} files
              {totals.added + totals.removed > 0
                ? ` · +${totals.added} −${totals.removed}`
                : ""}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="Refresh changes"
            onClick={() => void load(null, "replace")}
          >
            <Icon name="RotateCcw" className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={pathQuery}
            onChange={(event) => setPathQuery(event.target.value)}
            placeholder="Filter by path"
            className="h-7 text-xs"
          />
          <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={groupBy === "turn" ? "secondary" : "ghost"}
              className="h-6 px-2 text-xs"
              onClick={() => setGroupBy("turn")}
            >
              By turn
            </Button>
            <Button
              type="button"
              size="sm"
              variant={groupBy === "file" ? "secondary" : "ghost"}
              className="h-6 px-2 text-xs"
              onClick={() => setGroupBy("file")}
            >
              By file
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs text-muted-foreground"
            aria-pressed={includeChildren}
            onClick={() => setIncludeChildren((value) => !value)}
          >
            <Icon
              name={includeChildren ? "CircleCheck" : "Circle"}
              className="size-3.5"
              aria-hidden="true"
            />
            Child threads
          </Button>
          {state.truncated ? (
            <span className="text-2xs text-subtle-foreground">
              Some patches or older changes were omitted.
            </span>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="p-3">
            <EmptyState
              message={
                state.entries.length === 0
                  ? "This thread has not changed any files yet."
                  : "No changes match the current filter."
              }
              icon="FileDiff"
            />
          </div>
        ) : (
          groups.map((group) => (
            <ChangeGroupSection
              key={group.key}
              group={group}
              groupBy={groupBy}
              now={now}
              expandedRows={expandedRows}
              onOpenFile={state.thread.environmentId === null ? null : openFile}
              onToggle={toggleRow}
              turns={state.turns}
            />
          ))
        )}
        {state.page.hasOlder && state.page.olderCursor !== null ? (
          <div className="p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn("w-full", loadingOlder && "opacity-60")}
              disabled={loadingOlder}
              onClick={() => void load(state.page.olderCursor, "append")}
            >
              {loadingOlder ? "Loading..." : "Load older changes"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
