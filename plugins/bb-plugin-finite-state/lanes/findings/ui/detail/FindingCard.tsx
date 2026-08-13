import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { ReachabilityEvidence } from "./ReachabilityEvidence.js";
import { useFindingDetail } from "./useFindingDetail.js";

export function FindingCard({ stableKey, compact = false }: {
  stableKey: string;
  compact?: boolean;
}): React.JSX.Element {
  const state = useFindingDetail(stableKey);
  if (state.status === "loading") {
    return <div aria-label="Loading finding card" className="space-y-3 rounded-lg border border-border bg-card p-4"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-16 w-full" /></div>;
  }
  if (state.status === "invalid" || state.status === "empty") {
    return (
      <article className="rounded-lg border border-border bg-card p-4 text-sm">
        <Icon aria-hidden="true" className="size-5 text-muted-foreground" name="FileQuestion" />
        <h3 className="mt-2 font-semibold">Finding not found</h3>
        <p className="mt-1 text-muted-foreground">The stable identity is invalid or no longer exists in the accepted cache.</p>
      </article>
    );
  }
  if (state.status === "unconfigured") {
    return (
      <article className="rounded-lg border border-border bg-card p-4 text-sm">
        <h3 className="font-semibold">Choose a findings scope</h3>
        <p className="mt-1 text-muted-foreground">Select a bb project with an accepted findings cache.</p>
      </article>
    );
  }
  if (!state.data) {
    return (
      <article className="rounded-lg border border-destructive/40 bg-card p-4 text-sm" role="alert">
        <h3 className="font-semibold">Finding unavailable</h3>
        <p className="mt-1 break-words text-muted-foreground">{state.error}</p>
        <Button className="mt-3" onClick={state.retry} size="sm" variant="outline">Retry</Button>
      </article>
    );
  }
  const finding = state.data;
  const row = finding.rows[0];
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card text-sm">
      {finding.cache.stale || state.status === "error" ? <div className="border-b border-warning/40 bg-muted px-4 py-2 text-xs">Stale cached finding · the last accepted evidence remains visible</div> : null}
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{row?.cve ?? "CVE unknown"}</p>
            <h3 className="mt-1 truncate font-semibold">{row?.title ?? row?.componentName ?? "Cached finding"}</h3>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{row?.componentPurl ?? [row?.componentGroup, row?.componentName, row?.componentVersion].filter(Boolean).join(":")}</p>
          </div>
          <Badge variant={finding.effective.severity === "critical" || finding.effective.severity === "high" ? "destructive" : "secondary"}>{finding.effective.severity}</Badge>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <dt className="text-muted-foreground">CVSS</dt><dd className="font-mono">{finding.effective.cvss ?? "Unknown"}</dd>
          <dt className="text-muted-foreground">EPSS</dt><dd className="font-mono">{finding.effective.epss === undefined ? "Unknown" : `${(finding.effective.epss * 100).toFixed(1)}%`}</dd>
          <dt className="text-muted-foreground">VEX</dt><dd className="capitalize">{finding.vex.state.replaceAll("_", " ")}</dd>
          <dt className="text-muted-foreground">Cached rows</dt><dd className="font-mono">{finding.resolution.duplicateCount}</dd>
        </dl>
        {!compact ? <ReachabilityEvidence factors={finding.reachability.factors} verdict={finding.reachability.verdict} />
          : <p className="rounded border border-border bg-background p-2 text-xs">Reachability: <span className="font-medium capitalize">{finding.reachability.verdict}</span> · {finding.reachability.factors.length} evidence factor{finding.reachability.factors.length === 1 ? "" : "s"}</p>}
      </div>
    </article>
  );
}
