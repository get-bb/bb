import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useTimelineTurnSummaryDetails } from "@/data/thread-detail";
import type { ThreadTimelineTurnSummaryDetailsQueryIdentity } from "@/lib/query/query-keys";
import type { TimelineListItem, TimelineTurnChildrenState } from "./rows";

interface TurnChildrenLoaderProps {
  itemKey: string;
  identity: ThreadTimelineTurnSummaryDetailsQueryIdentity;
  onChange: (itemKey: string, state: TimelineTurnChildrenState | null) => void;
}

/**
 * Renders nothing; fetches one expanded turn row's lazy children and reports
 * the load state up so the list builder can flatten them. One is mounted per
 * expanded turn row (see `useTurnChildrenStates`).
 */
function TurnChildrenLoader({
  itemKey,
  identity,
  onChange,
}: TurnChildrenLoaderProps) {
  const query = useTimelineTurnSummaryDetails(identity);
  const data = query.data;
  const isError = query.isError;
  useEffect(() => {
    if (data) {
      onChange(itemKey, { status: "loaded", rows: data.rows });
    } else if (isError) {
      onChange(itemKey, { status: "error" });
    } else {
      onChange(itemKey, { status: "loading" });
    }
  }, [data, isError, itemKey, onChange]);
  useEffect(() => () => onChange(itemKey, null), [itemKey, onChange]);
  return null;
}

/** The lazy-children map the list builder reads plus its change sink. */
export function useTurnChildrenMap(): {
  turnChildren: ReadonlyMap<string, TimelineTurnChildrenState>;
  onChange: (itemKey: string, state: TimelineTurnChildrenState | null) => void;
} {
  const [turnChildren, setTurnChildren] = useState<
    ReadonlyMap<string, TimelineTurnChildrenState>
  >(() => new Map());

  const onChange = useCallback(
    (itemKey: string, state: TimelineTurnChildrenState | null) => {
      setTurnChildren((current) => {
        const existing = current.get(itemKey);
        if (state === null) {
          if (existing === undefined) return current;
          const next = new Map(current);
          next.delete(itemKey);
          return next;
        }
        if (
          existing !== undefined &&
          existing.status === state.status &&
          (state.status !== "loaded" ||
            (existing.status === "loaded" && existing.rows === state.rows))
        ) {
          return current;
        }
        const next = new Map(current);
        next.set(itemKey, state);
        return next;
      });
    },
    [],
  );

  return { turnChildren, onChange };
}

/**
 * One invisible loader per expanded turn row whose children are lazy; mount
 * the returned elements anywhere under the QueryClient provider.
 */
export function renderTurnChildrenLoaders(
  items: readonly TimelineListItem[],
  threadId: string,
  onChange: (itemKey: string, state: TimelineTurnChildrenState | null) => void,
): ReactElement[] {
  return items.flatMap((item) => {
    if (item.kind !== "turn" || item.lazyChildren === null) return [];
    const row = item.row;
    return [
      <TurnChildrenLoader
        key={item.key}
        itemKey={item.key}
        identity={{
          sourceSeqEnd: row.sourceSeqEnd,
          sourceSeqStart: row.sourceSeqStart,
          threadId: threadId || row.threadId,
          turnId: row.turnId,
        }}
        onChange={onChange}
      />,
    ];
  });
}
