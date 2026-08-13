import { useMemo, useRef, useState } from "react";
import { useRpc } from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@bb/shared-ui/select";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { rpcContract } from "../../../shared/contract.js";
import type { FirmwareDiffItem } from "../diff.js";

interface VersionDiffProps {
  projectId: string;
  initialToPvId?: string;
}

function diffItem(fields: Record<string, unknown>): FirmwareDiffItem | null {
  const operation = fields.operation;
  if (typeof fields.path !== "string" || (operation !== "added" && operation !== "removed" && operation !== "changed")) return null;
  const regressions = Array.isArray(fields.securityRegressions)
    ? fields.securityRegressions.filter((value): value is string => typeof value === "string")
    : [];
  const featureRecord = (value: unknown): Record<string, boolean | string> | null => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean | string] =>
      typeof entry[1] === "boolean" || typeof entry[1] === "string"));
  };
  return {
    path: fields.path,
    operation,
    beforeHash: typeof fields.beforeHash === "string" ? fields.beforeHash : null,
    afterHash: typeof fields.afterHash === "string" ? fields.afterHash : null,
    beforeSize: typeof fields.beforeSize === "number" ? fields.beforeSize : null,
    afterSize: typeof fields.afterSize === "number" ? fields.afterSize : null,
    securityRegressions: regressions,
    beforeSecurityFeatures: featureRecord(fields.beforeSecurityFeatures),
    afterSecurityFeatures: featureRecord(fields.afterSecurityFeatures),
  };
}

function securityDeltas(item: FirmwareDiffItem): string[] {
  const before = item.beforeSecurityFeatures;
  const after = item.afterSecurityFeatures;
  if (!before || !after) return [];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((key) => before[key] !== after[key])
    .map((key) => `${key}: ${String(before[key] ?? "Unknown")} → ${String(after[key] ?? "Unknown")}`);
}

function fileType(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "executable / extensionless" : name.slice(dot + 1).toLowerCase();
}

function sizeDelta(item: FirmwareDiffItem): string {
  if (item.beforeSize === null && item.afterSize === null) return "Size unknown";
  if (item.beforeSize === null) return `+${item.afterSize?.toLocaleString() ?? "?"} B`;
  if (item.afterSize === null) return `−${item.beforeSize.toLocaleString()} B`;
  const delta = item.afterSize - item.beforeSize;
  return `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toLocaleString()} B`;
}

export function VersionDiff({ projectId, initialToPvId = "" }: VersionDiffProps): React.JSX.Element {
  const rpc = useRpc<typeof rpcContract>();
  const [expanded, setExpanded] = useState(false);
  const [fromPvId, setFromPvId] = useState("");
  const [toPvId, setToPvId] = useState(initialToPvId);
  const [items, setItems] = useState<FirmwareDiffItem[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [compared, setCompared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState("all");
  const [type, setType] = useState("all");
  const [regressionsOnly, setRegressionsOnly] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);

  async function load(cursor: string | null, append: boolean): Promise<void> {
    if (!projectId || !fromPvId.trim() || !toPvId.trim() || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    if (!append) setCompared(true);
    setError(null);
    try {
      const input = {
        projectId,
        projectVersionId: toPvId.trim(),
        pageSize: 200,
        continuation: cursor,
        fromProjectVersionId: fromPvId.trim(),
        toProjectVersionId: toPvId.trim(),
      };
      const page = await rpc.call("firmwareDiff", input);
      const parsed = page.items.map((item) => diffItem(item.fields)).filter((item): item is FirmwareDiffItem => item !== null);
      setItems((current) => append ? [...current, ...parsed] : parsed);
      setTotal(page.total ?? parsed.length);
      setNext(page.next);
      if (page.cache.state === "stale" && page.cache.message) setError(page.cache.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firmware versions could not be compared.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  const types = useMemo(() => [...new Set(items.map((item) => fileType(item.path)))].sort(), [items]);
  const filtered = useMemo(() => items.filter((item) =>
    (operation === "all" || item.operation === operation) &&
    (type === "all" || fileType(item.path) === type) &&
    (!regressionsOnly || item.securityRegressions.length > 0)), [items, operation, regressionsOnly, type]);
  const rowHeight = 76;
  const visibleCount = 16;
  const start = Math.max(0, Math.min(filtered.length, Math.floor(scrollTop / rowHeight) - 3));
  const visible = filtered.slice(start, start + visibleCount);

  if (!expanded) {
    return <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setExpanded(true)}><Icon name="FileDiff" className="mr-2 size-4" />Compare firmware versions</Button>;
  }

  return (
    <section className="space-y-3 border-t pt-4" aria-label="Firmware version diff">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">Version diff</h4>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>Close</Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label htmlFor="firmware-from">From</Label><Input id="firmware-from" value={fromPvId} onChange={(event) => setFromPvId(event.target.value)} /></div>
        <div><Label htmlFor="firmware-to">To</Label><Input id="firmware-to" value={toPvId} onChange={(event) => setToPvId(event.target.value)} /></div>
      </div>
      <Button size="sm" onClick={() => void load(null, false)} disabled={loading || !projectId || !fromPvId.trim() || !toPvId.trim()}>
        {loading && items.length === 0 ? <Icon name="Loading" className="mr-1.5 size-4 animate-spin" /> : null}Compare sidecars
      </Button>

      {!projectId ? <Alert><AlertDescription>Select a project before comparing firmware versions.</AlertDescription></Alert> : null}

      {items.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Select value={operation} onValueChange={setOperation}>
              <SelectTrigger aria-label="Filter operation"><SelectValue placeholder="Operation" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All operations</SelectItem><SelectItem value="added">Added</SelectItem><SelectItem value="removed">Removed</SelectItem><SelectItem value="changed">Changed</SelectItem></SelectContent>
            </Select>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger aria-label="Filter file type"><SelectValue placeholder="File type" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All file types</SelectItem>{types.map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}</SelectContent>
            </Select>
            <Label className="col-span-2 flex items-center gap-2 rounded-md border px-3 sm:col-span-1">
              <Checkbox checked={regressionsOnly} onCheckedChange={(value) => setRegressionsOnly(value === true)} />Security regressions
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">{filtered.length.toLocaleString()} loaded matches · {total.toLocaleString()} changed total. Unchanged entries are counted server-side.</p>
          <div
            className="h-80 overflow-auto rounded-md border"
            onScroll={(event) => {
              const target = event.currentTarget;
              setScrollTop(target.scrollTop);
              if (next && target.scrollHeight - target.scrollTop - target.clientHeight < rowHeight * 4) void load(next, true);
            }}
          >
            <div style={{ height: filtered.length * rowHeight, position: "relative" }}>
              <div style={{ transform: `translateY(${start * rowHeight}px)` }}>
                {visible.map((item) => (
                  <div key={`${item.operation}:${item.path}`} className="h-[76px] border-b px-3 py-2 text-sm">
                    <div className="flex items-center gap-2"><Badge variant="outline">{item.operation}</Badge><span className="min-w-0 flex-1 truncate font-mono text-xs">{item.path}</span><span className="text-xs text-muted-foreground">{sizeDelta(item)}</span></div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{item.beforeHash?.slice(0, 12) ?? "—"} → {item.afterHash?.slice(0, 12) ?? "—"}</div>
                    {item.securityRegressions.length > 0
                      ? <div className="mt-1 truncate text-xs text-destructive">Security regression: {item.securityRegressions.join(", ")}</div>
                      : securityDeltas(item).length > 0
                        ? <div className="mt-1 truncate text-xs text-muted-foreground">Security features: {securityDeltas(item).join(", ")}</div>
                        : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : loading ? <><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></> : compared && !error ? (
        <div className="rounded-lg border border-dashed p-3 text-sm"><p className="font-medium">No firmware changes</p><p className="text-muted-foreground">These sidecars have equal file hashes. Choose another version pair to compare.</p></div>
      ) : null}
      {error ? <Alert variant="destructive"><AlertDescription className="flex items-center justify-between gap-3"><span>{error} Stale rows remain visible; retry is safe.</span><Button size="sm" variant="outline" onClick={() => void load(null, false)}>Retry</Button></AlertDescription></Alert> : null}
    </section>
  );
}
