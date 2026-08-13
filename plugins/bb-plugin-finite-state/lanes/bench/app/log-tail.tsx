import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { z } from "zod";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { rpcContract } from "../../../shared/contract.js";

// The frozen pagedScopedInput helper loses its additive runId in TypeScript
// inference even though the runtime schema retains it. Contain that defect at
// this one boundary without weakening the payload internally.
const benchLogRpcContract = {
  benchLogsList: {
    input: z.object({
      projectId: z.string(),
      projectVersionId: z.string().nullable(),
      runId: z.string(),
      pageSize: z.number(),
      continuation: z.string().nullable(),
    }).strict(),
    output: rpcContract.benchLogsList.output,
  },
} as const;

export interface BenchLogLine {
  seq: number;
  at: string;
  stream: "stdout" | "stderr" | "event";
  text: string;
}

export interface BenchLogPage {
  runId: string;
  items: BenchLogLine[];
  total: number;
  cursor?: string;
  complete: boolean;
}

interface LogTailProps {
  projectId: string;
  projectVersionId: string | null;
  runId: string;
}

const MAX_LINES = 1_000;

function hintSequence(payload: unknown, runId: string): number | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  if (Reflect.get(payload, "runId") !== runId) return null;
  const value = Reflect.get(payload, "sequence") ?? Reflect.get(payload, "seq");
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function stream(level: string): BenchLogLine["stream"] {
  if (level === "stderr" || level === "error" || level === "warn") return "stderr";
  if (level === "event") return "event";
  return "stdout";
}

export function LogTail({ projectId, projectVersionId, runId }: LogTailProps): React.JSX.Element {
  const rpc = useRpc<typeof benchLogRpcContract>();
  const connection = useRealtimeConnectionState();
  const scroller = useRef<HTMLDivElement>(null);
  const committedCursor = useRef<string | null>(null);
  const committedSequence = useRef(-1);
  const inFlight = useRef(false);
  const pendingReconcile = useRef(false);
  const connectedOnce = useRef(false);
  const [lines, setLines] = useState<BenchLogLine[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async (continuation: string | null) => {
    if (inFlight.current) {
      pendingReconcile.current = true;
      return;
    }
    inFlight.current = true;
    try {
      const page = await rpc.call("benchLogsList", {
        projectId,
        projectVersionId,
        runId,
        pageSize: 200,
        continuation,
      });
      const incoming = page.items.map((item) => ({
        seq: item.sequence,
        at: item.at,
        stream: stream(item.level),
        text: item.text,
      }));
      setLines((current) => {
        const bySequence = new Map(current.map((line) => [line.seq, line]));
        for (const line of incoming) bySequence.set(line.seq, line);
        const ordered = [...bySequence.values()].sort((left, right) => left.seq - right.seq);
        const bounded = ordered.slice(-MAX_LINES);
        committedSequence.current = bounded.at(-1)?.seq ?? committedSequence.current;
        return bounded;
      });
      committedCursor.current = page.next;
      setCursor(page.next);
      setComplete(page.next === null);
      setError(page.cache.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The cached log tail is unavailable.");
    } finally {
      setLoading(false);
      inFlight.current = false;
      if (pendingReconcile.current) {
        pendingReconcile.current = false;
        queueMicrotask(() => void read(committedCursor.current));
      }
    }
  }, [projectId, projectVersionId, rpc, runId]);

  useEffect(() => {
    committedCursor.current = null;
    committedSequence.current = -1;
    setLines([]);
    setCursor(null);
    setComplete(false);
    setLoading(true);
    void read(null);
  }, [read]);
  useRealtime("bench:log", (payload) => {
    const hinted = hintSequence(payload, runId);
    if (hinted === null || hinted <= committedSequence.current || hinted > committedSequence.current + 1) {
      void read(committedCursor.current);
      return;
    }
    void read(committedCursor.current);
  });
  useEffect(() => {
    if (connection !== "connected") return;
    if (connectedOnce.current) void read(committedCursor.current);
    connectedOnce.current = true;
  }, [connection, read]);

  const items = useMemo(() => lines, [lines]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 24,
    overscan: 12,
  });
  const logDownload = `/api/v1/plugins/finite-state/http/bench/runs/log?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(runId)}`;

  return (
    <section aria-labelledby={`log-tail-${runId}`} className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon name="Code" />
        <h3 className="text-sm font-semibold" id={`log-tail-${runId}`}>Cached log tail</h3>
        <span className="text-xs text-muted-foreground">{lines.length} bounded lines</span>
        <Button asChild className="ml-auto" size="sm" variant="outline"><a href={logDownload}><Icon name="Download" />Download cached log</a></Button>
      </div>
      {error ? <Alert className="m-3"><Icon name="AlertTriangle" /><AlertDescription>{lines.length > 0 ? `Prior tail retained. ${error}` : `Live log source unavailable. ${error}`}</AlertDescription></Alert> : null}
      <div aria-label="Bench log lines" className="h-64 overflow-auto bg-muted/20 font-mono text-xs" ref={scroller} role="log">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => {
            const line = items[row.index];
            if (!line) return null;
            return <div className="absolute left-0 top-0 flex w-full gap-3 border-b border-border/50 px-3 py-1" data-bench-log-line key={line.seq} style={{ transform: `translateY(${row.start}px)` }}><span className="w-14 shrink-0 text-muted-foreground">{line.seq}</span><span className={line.stream === "stderr" ? "text-destructive" : "text-muted-foreground"}>{line.stream}</span><span className="whitespace-pre-wrap break-all text-foreground">{line.text}</span></div>;
          })}
        </div>
        {!loading && lines.length === 0 && !error ? <p className="p-4 text-muted-foreground">No cached log lines yet. Open the native run thread for the primary live execution log.</p> : null}
      </div>
      {cursor ? <div className="border-t border-border p-2 text-center"><Button onClick={() => void read(cursor)} size="sm" variant="ghost">Load next log page</Button></div> : complete && lines.length > 0 ? <p className="border-t border-border p-2 text-center text-xs text-muted-foreground">Cached tail is current.</p> : null}
    </section>
  );
}
