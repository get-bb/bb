import { memo } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";

export interface FindingRowView {
  stableKey: string;
  cve: string | null;
  title: string | null;
  severity: string | null;
  epss: number | null;
  kev: boolean;
  reachability: string | null;
  vexStatus: string | null;
  localChange: boolean;
}

export interface SbomRowView {
  id: string;
  componentKey: string;
  identityLabel: string;
  purl: string | null;
  severityCounts: Record<"critical" | "high" | "medium" | "low", number>;
  kevCount: number;
  reachability: "reachable" | "unreachable" | "mixed" | "unknown";
  fileCount: number;
  localChange: boolean;
  linked: boolean;
  version: string | null;
  license: string | null;
  source: string | null;
  upstreamStale: boolean;
  findings: FindingRowView[];
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const severityTone: Record<(typeof SEVERITIES)[number], string> = {
  critical: "border-destructive bg-destructive text-destructive-foreground",
  high: "border-destructive bg-destructive text-destructive-foreground",
  medium: "border-primary bg-primary text-primary-foreground",
  low: "border-border bg-muted text-foreground",
};

function SeverityHistogram({ row }: { row: SbomRowView }): React.JSX.Element {
  return (
    <div
      aria-label="Severity histogram"
      className="flex min-w-0 gap-1"
      role="img"
    >
      {SEVERITIES.map((severity) => (
        <span
          className={`rounded border px-1 py-0.5 font-mono text-xs ${severityTone[severity]}`}
          key={severity}
          title={`${severity}: ${row.severityCounts[severity]}`}
        >
          {severity[0]!.toUpperCase()} {row.severityCounts[severity]}
        </span>
      ))}
    </div>
  );
}

export interface SbomRowProps {
  row: SbomRowView;
  expanded: boolean;
  selected: boolean;
  findingsLoading: boolean;
  findingsError: string | null;
  onExpand(id: string): void;
  onFinding(stableKey: string): void;
  onOpen(componentKey: string): void;
  onRetryFindings(): void;
  onSelect(id: string): void;
}

export const SbomRow = memo(function SbomRow({
  row,
  expanded,
  selected,
  findingsLoading,
  findingsError,
  onExpand,
  onFinding,
  onOpen,
  onRetryFindings,
  onSelect,
}: SbomRowProps): React.JSX.Element {
  return (
    <>
      <div
        aria-selected={selected}
        className={`grid min-h-11 grid-cols-12 items-center gap-2 border-b border-border px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          selected ? "bg-muted" : "bg-background hover:bg-muted/60"
        }`}
        data-sbom-row=""
        onClick={() => onSelect(row.id)}
        onDoubleClick={() => onOpen(row.componentKey)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onExpand(row.id);
          }
        }}
        role="row"
        tabIndex={selected ? 0 : -1}
      >
        <div
          className="col-span-3 flex min-w-0 items-center gap-1.5"
          role="cell"
        >
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${row.identityLabel}`}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => {
              event.stopPropagation();
              onExpand(row.id);
            }}
            type="button"
          >
            <Icon
              aria-hidden="true"
              className="size-3.5"
              name={expanded ? "ChevronDown" : "ChevronRight"}
            />
          </button>
          <button
            className="min-w-0 text-left focus-visible:outline-none focus-visible:underline"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(row.componentKey);
            }}
            type="button"
          >
            <span className="block truncate font-medium text-foreground">
              {row.identityLabel}
            </span>
            <span className="block truncate font-mono text-muted-foreground">
              {row.purl ?? "No purl · fallback identity"}
            </span>
          </button>
        </div>
        <div
          className="col-span-1 truncate font-mono text-muted-foreground"
          role="cell"
        >
          {row.version ?? "—"}
        </div>
        <div
          className="col-span-1 truncate font-mono text-muted-foreground"
          role="cell"
        >
          {row.license ?? "Unknown"}
        </div>
        <div className="col-span-3" role="cell">
          <SeverityHistogram row={row} />
        </div>
        <div className="col-span-1 text-right font-mono" role="cell">
          {row.kevCount > 0 ? (
            <Badge variant="destructive">KEV {row.kevCount}</Badge>
          ) : (
            "0"
          )}
        </div>
        <div className="col-span-1 truncate text-muted-foreground" role="cell">
          {row.reachability}
        </div>
        <div
          className="col-span-1 text-right font-mono text-muted-foreground"
          role="cell"
        >
          {row.fileCount}
        </div>
        <div className="col-span-1 flex justify-end gap-1" role="cell">
          {row.linked ? <Badge variant="secondary">Linked</Badge> : null}
          {row.localChange ? <Badge variant="outline">VEX</Badge> : null}
          {row.upstreamStale ? (
            <Badge variant="outline">Upstream stale</Badge>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className="border-b border-border bg-card" role="row">
          <div aria-colspan={8} className="px-10 py-3" role="cell">
            {findingsLoading ? (
              <div
                aria-label="Loading vulnerability details"
                className="space-y-2"
                role="group"
              >
                <p className="text-sm text-muted-foreground">
                  Loading vulnerability details…
                </p>
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/4" />
              </div>
            ) : findingsError ? (
              <div className="flex items-center gap-3 text-sm">
                <p className="min-w-0 flex-1 text-destructive">
                  {findingsError}
                </p>
                <Button onClick={onRetryFindings} size="sm" variant="outline">
                  Retry findings
                </Button>
              </div>
            ) : row.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No joined CVEs for this component.
              </p>
            ) : (
              <div
                aria-label={`Findings for ${row.identityLabel}`}
                className="space-y-1"
                role="group"
              >
                {row.findings.map((finding) => (
                  <button
                    className="grid w-full grid-cols-6 items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-left text-xs hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    key={finding.stableKey}
                    onClick={(event) => {
                      event.stopPropagation();
                      onFinding(finding.stableKey);
                    }}
                    type="button"
                  >
                    <span className="truncate font-mono font-medium text-foreground">
                      {finding.cve ?? finding.stableKey}
                    </span>
                    <span className="truncate capitalize text-muted-foreground">
                      {finding.severity ?? "Unknown"}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      EPSS{" "}
                      {finding.epss === null ? "—" : finding.epss.toFixed(3)}
                    </span>
                    <span className="text-muted-foreground">
                      {finding.kev ? "KEV" : "Not KEV"}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {finding.reachability ?? "unknown"}
                    </span>
                    <span className="truncate text-right text-muted-foreground">
                      {finding.vexStatus ?? "No VEX"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
});
