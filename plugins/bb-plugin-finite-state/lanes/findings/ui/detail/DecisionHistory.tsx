import { useCallback, useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { useRpc } from "@bb/plugin-sdk/app";
import type { z } from "zod";
import type { JsonValue, rpcContract } from "../../../../shared/contract.js";
import type { findingsUiRpcContract } from "../../rpc.js";
import type { FindingDetailRow } from "./useFindingDetail.js";

type ActivityItem = z.output<(typeof rpcContract)["findingsActivityList"]["output"]>["items"][number];

function text(fields: Record<string, JsonValue>, key: string): string | null {
  return typeof fields[key] === "string" ? fields[key] : null;
}

function tuple(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "No tuple recorded";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function DecisionHistory({ row }: { row: FindingDetailRow }): React.JSX.Element {
  const rpc = useRpc<typeof findingsUiRpcContract & typeof rpcContract>();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);

  const load = useCallback(async (continuation: string | null) => {
    const input = {
      projectId: row.projectId,
      projectVersionId: row.projectVersionId,
      findingId: row.findingId,
      pageSize: 40,
      continuation,
    };
    const result = await rpc.call("findingsActivityList", input);
    setItems(current => continuation ? [...current, ...result.items.filter(item => !current.some(existing => existing.key === item.key))] : result.items);
    setCursor(result.next);
  }, [row.findingId, row.projectId, row.projectVersionId, rpc]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void load(null).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Cached history could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, revision]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await rpc.call("findingActivityRefresh", {
        projectId: row.projectId,
        projectVersionId: row.projectVersionId,
        findingId: row.findingId,
      });
      setRevision(current => current + 1);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Online history refresh failed.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section aria-labelledby="finding-history" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon aria-hidden="true" className="size-4 text-primary" name="TimeSchedule" />
          <h3 className="text-sm font-semibold" id="finding-history">Decision history</h3>
        </div>
        <Button disabled={refreshing} onClick={() => void refresh()} size="sm" variant="outline">
          <Icon aria-hidden="true" className={`size-4 ${refreshing ? "animate-spin" : ""}`} name="RotateCcw" />
          {refreshing ? "Refreshing" : "Refresh online"}
        </Button>
      </div>
      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-muted/20 p-3 text-xs" role="alert">
          <p className="font-medium">History refresh failed; cached detail remains available.</p>
          <p className="mt-1 break-words text-muted-foreground">{error}</p>
          <Button className="mt-2" onClick={() => setRevision(current => current + 1)} size="sm" variant="ghost">Retry cached history</Button>
        </div>
      ) : null}
      {loading && items.length === 0 ? (
        <div aria-label="Loading decision history" className="space-y-2">
          {[0, 1, 2].map(item => <div className="h-16 animate-pulse rounded-lg border border-border bg-muted" key={item} />)}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">No cached audit events for this product-version row.</p>
      ) : (
        <ol className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {items.map(item => {
            const at = text(item.fields, "at");
            return (
              <li className="rounded-lg border border-border bg-background p-3 text-xs [content-visibility:auto] [contain-intrinsic-size:auto_7rem]" key={item.key}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{text(item.fields, "source") ?? item.label}</p>
                  <time className="text-muted-foreground" dateTime={at ?? undefined}>{at ? new Date(at).toLocaleString() : "Time unknown"}</time>
                </div>
                <p className="mt-1 text-muted-foreground">Actor: {text(item.fields, "actor") ?? "Unknown actor"}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded border border-border p-2"><p className="text-muted-foreground">Before</p><p className="mt-1 break-words font-mono">{tuple(item.fields["old"])}</p></div>
                  <div className="rounded border border-border p-2"><p className="text-muted-foreground">After</p><p className="mt-1 break-words font-mono">{tuple(item.fields["new"])}</p></div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {cursor ? (
        <Button disabled={loadingMore} onClick={() => {
          setLoadingMore(true);
          setError(null);
          void load(cursor).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The next history page failed.")).finally(() => setLoadingMore(false));
        }} size="sm" variant="outline">{loadingMore ? "Loading…" : "Load older events"}</Button>
      ) : null}
    </section>
  );
}
