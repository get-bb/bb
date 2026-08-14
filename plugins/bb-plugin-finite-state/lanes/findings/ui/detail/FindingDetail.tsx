import { useEffect, useMemo, useState } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { CrossLinks } from "./CrossLinks.js";
import { DecisionHistory } from "./DecisionHistory.js";
import { FindingComments } from "./FindingComments.js";
import { ReachabilityEvidence } from "./ReachabilityEvidence.js";
import {
  useFindingDetail,
  type FindingDetailModel,
  type FindingDetailRow,
  type VexTuple,
} from "./useFindingDetail.js";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "Unknown";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "Unrenderable evidence";
  }
}

function VexPanel({
  title,
  tuple,
  tone,
  emptyLabel = "No tuple is present.",
}: {
  title: string;
  tuple: VexTuple | null;
  tone: "server" | "local";
  emptyLabel?: string;
}): React.JSX.Element {
  return (
    <div
      className={`rounded-lg border p-3 text-xs ${tone === "local" ? "border-primary/40 bg-primary/5" : "border-border bg-background"}`}
    >
      <div className="flex items-center gap-2">
        <Icon
          aria-hidden="true"
          className={
            tone === "local"
              ? "size-4 text-primary"
              : "size-4 text-muted-foreground"
          }
          name={tone === "local" ? "EditFile" : "Container"}
        />
        <h4 className="font-semibold">{title}</h4>
      </div>
      {tuple ? (
        <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-2">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="break-words font-mono">{tuple.status ?? "Unset"}</dd>
          <dt className="text-muted-foreground">Response</dt>
          <dd className="break-words font-mono">{tuple.response ?? "Unset"}</dd>
          <dt className="text-muted-foreground">Justification</dt>
          <dd className="break-words font-mono">
            {tuple.justification ?? "Unset"}
          </dd>
          <dt className="text-muted-foreground">Reason</dt>
          <dd className="whitespace-pre-wrap break-words">
            {tuple.reason ?? "Unset"}
          </dd>
        </dl>
      ) : (
        <p className="mt-2 text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  );
}

function DecisionSection({
  model,
}: {
  model: FindingDetailModel;
}): React.JSX.Element {
  return (
    <section aria-labelledby="finding-decision" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon
            aria-hidden="true"
            className="size-4 text-primary"
            name="FileDiff"
          />
          <h3 className="text-sm font-semibold" id="finding-decision">
            Effective VEX decision
          </h3>
        </div>
        <Badge
          variant={model.vex.state === "conflict" ? "destructive" : "outline"}
        >
          {model.vex.state.replaceAll("_", " ")}
        </Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <VexPanel
          emptyLabel={
            model.rows.some((row) => row.serverVex)
              ? "Cached rows have different server tuples; inspect them below."
              : undefined
          }
          title="Server tuple"
          tone="server"
          tuple={model.vex.server}
        />
        <VexPanel
          emptyLabel={
            model.rows.some((row) => row.localVex)
              ? "Cached rows have different local tuples; inspect them below."
              : undefined
          }
          title="Local overlay tuple"
          tone="local"
          tuple={model.vex.local}
        />
      </div>
      {model.resolution.duplicateCount > 1 &&
      (!model.vex.server || !model.vex.local) ? (
        <p className="text-xs text-muted-foreground">
          A combined tuple is shown only when every cached row agrees. Select a
          row below to inspect differing source records.
        </p>
      ) : null}
    </section>
  );
}

function IdentitySection({
  model,
}: {
  model: FindingDetailModel;
}): React.JSX.Element {
  const row = model.rows[0];
  return (
    <section aria-labelledby="finding-identity" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon aria-hidden="true" className="size-4 text-primary" name="Bug" />
          <h3 className="text-sm font-semibold" id="finding-identity">
            Identity & intelligence
          </h3>
        </div>
        <Badge
          variant={
            model.effective.severity === "critical" ||
            model.effective.severity === "high"
              ? "destructive"
              : "secondary"
          }
        >
          {model.effective.severity}
        </Badge>
      </div>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border border-border bg-background p-3 text-xs">
        <dt className="text-muted-foreground">Component</dt>
        <dd className="break-words font-medium">
          {[row?.componentGroup, row?.componentName]
            .filter(Boolean)
            .join(" / ") || "Unknown"}
        </dd>
        <dt className="text-muted-foreground">Version</dt>
        <dd className="break-words font-mono">
          {row?.componentVersion ?? "Unknown"}
        </dd>
        <dt className="text-muted-foreground">purl</dt>
        <dd className="break-all font-mono">
          {row?.componentPurl ?? "Unavailable — fallback identity"}
        </dd>
        <dt className="text-muted-foreground">CVSS</dt>
        <dd className="font-mono">
          {model.effective.cvss ?? "Unknown"}
          {row?.cvssVector ? ` · ${row.cvssVector}` : ""}
        </dd>
        <dt className="text-muted-foreground">EPSS</dt>
        <dd className="font-mono">
          {model.effective.epss === undefined
            ? "Unknown"
            : `${(model.effective.epss * 100).toFixed(2)}%`}
        </dd>
        <dt className="text-muted-foreground">Exploitation</dt>
        <dd>
          {[
            model.effective.kev ? "CISA KEV" : null,
            model.effective.vcKev ? "VulnCheck KEV" : null,
            row?.hasExploit ? "Exploit observed" : null,
            row?.exploitMaturity,
          ]
            .filter(Boolean)
            .join(" · ") || "No exploitation intelligence cached"}
        </dd>
        <dt className="text-muted-foreground">Policy</dt>
        <dd>
          {policyCount(model.rows.map((item) => item.violationCount))}{" "}
          violations ·{" "}
          {policyCount(model.rows.map((item) => item.warningCount))} warnings
        </dd>
        <dt className="text-muted-foreground">Remediation</dt>
        <dd className="whitespace-pre-wrap break-words">
          {row?.remediation ?? "No remediation guidance cached."}
        </dd>
      </dl>
    </section>
  );
}

function policyCount(values: Array<number | null>): number | "Unknown" {
  return values.some((value) => value === null)
    ? "Unknown"
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function DuplicateRows({
  rows,
}: {
  rows: readonly FindingDetailRow[];
}): React.JSX.Element {
  return (
    <section aria-labelledby="finding-source-rows" className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon
          aria-hidden="true"
          className="size-4 text-primary"
          name="Layers"
        />
        <h3 className="text-sm font-semibold" id="finding-source-rows">
          Cached source rows
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">
        {rows.length} cached row{rows.length === 1 ? "" : "s"} resolve to this
        stable identity. Platform UUIDs are transient per product version and
        never appear in the authored route. Ingest-level duplicate provenance is
        not reconstructed here.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            className="rounded-lg border border-border bg-background p-3 text-xs"
            key={row.findingId}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="break-all font-mono">{row.findingId}</p>
              <Badge variant="outline">
                {row.localState.replaceAll("_", " ")}
              </Badge>
            </div>
            <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-2">
              <dt className="text-muted-foreground">Location</dt>
              <dd className="break-all font-mono">
                {formatValue(row.location)}
              </dd>
              <dt className="text-muted-foreground">Overlay</dt>
              <dd className="break-all font-mono">{row.localFile ?? "None"}</dd>
              <dt className="text-muted-foreground">Server VEX</dt>
              <dd className="break-words font-mono">
                {formatValue(row.serverVex)}
              </dd>
              <dt className="text-muted-foreground">Local VEX</dt>
              <dd className="break-words font-mono">
                {formatValue(row.localVex)}
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LoadingDetail({ onClose }: { onClose(): void }): React.JSX.Element {
  return (
    <aside
      aria-label="Finding detail"
      className="flex h-full w-1/2 min-w-[32rem] max-w-3xl shrink-0 flex-col border-l border-border bg-card"
    >
      <div className="flex items-center gap-3 border-b border-border p-4">
        <Skeleton className="h-10 flex-1" />
        <Button
          aria-label="Close finding detail"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <Icon aria-hidden="true" className="size-4" name="X" />
        </Button>
      </div>
      <div aria-label="Loading finding detail" className="space-y-5 p-5">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    </aside>
  );
}

export function FindingDetail({
  stableKey,
  onClose,
}: {
  stableKey: string;
  onClose(): void;
}): React.JSX.Element {
  const detail = useFindingDetail(stableKey);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const model = detail.data;
  const effectiveSelectedRowId =
    model?.rows.length === 1
      ? (model.rows[0]?.findingId ?? null)
      : selectedRowId;
  const selectedRow = useMemo(
    () =>
      model?.rows.find((row) => row.findingId === effectiveSelectedRowId) ??
      null,
    [effectiveSelectedRowId, model],
  );

  const closeAndRestore = () => {
    onClose();
    window.requestAnimationFrame(() => {
      const cursor = document.querySelector('[data-finding-row][tabindex="0"]');
      if (cursor instanceof HTMLElement) cursor.focus();
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAndRestore();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (detail.status === "loading")
    return <LoadingDetail onClose={closeAndRestore} />;

  if (!model) {
    const invalid = detail.status === "invalid";
    const unconfigured = detail.status === "unconfigured";
    return (
      <aside
        aria-label="Finding detail"
        className="flex h-full w-1/2 min-w-[32rem] max-w-3xl shrink-0 flex-col border-l border-border bg-card"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="font-semibold">Finding detail</h2>
          <Button
            aria-label="Close finding detail"
            onClick={closeAndRestore}
            size="icon"
            variant="ghost"
          >
            <Icon aria-hidden="true" className="size-4" name="X" />
          </Button>
        </header>
        <div className="p-5">
          <div
            className={`rounded-lg border p-5 text-sm ${detail.status === "error" ? "border-destructive/40" : "border-border"}`}
            role={detail.status === "error" ? "alert" : undefined}
          >
            <Icon
              aria-hidden="true"
              className="size-5 text-muted-foreground"
              name={
                unconfigured
                  ? "Settings"
                  : invalid
                    ? "FileQuestion"
                    : detail.status === "error"
                      ? "AlertCircle"
                      : "Search"
              }
            />
            <h3 className="mt-2 font-semibold">
              {unconfigured
                ? "Choose a findings scope"
                : invalid || detail.status === "empty"
                  ? "Finding not found"
                  : "Finding unavailable"}
            </h3>
            <p className="mt-1 text-muted-foreground">
              {unconfigured
                ? "Select a bb project with an accepted findings cache."
                : invalid
                  ? "The untrusted stable key was rejected before any cache or remote read."
                  : (detail.error ??
                    "This identity no longer resolves in the accepted product version.")}
            </p>
            <div className="mt-4 flex gap-2">
              {detail.status === "error" || detail.status === "empty" ? (
                <Button onClick={detail.retry} variant="outline">
                  Retry
                </Button>
              ) : null}
              <Button onClick={closeAndRestore} variant="ghost">
                Return to table
              </Button>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  const historyRow = selectedRow ?? model.rows[0];
  return (
    <aside
      aria-label="Finding detail"
      className="flex h-full w-1/2 min-w-[32rem] max-w-3xl shrink-0 flex-col border-l border-border bg-card text-foreground"
    >
      {model.cache.stale || detail.status === "error" ? (
        <div
          className="flex items-center gap-2 border-b border-warning/40 bg-muted px-4 py-2 text-xs"
          role="status"
        >
          <Icon
            aria-hidden="true"
            className="size-4 text-warning"
            name="AlertTriangle"
          />
          <span className="min-w-0 flex-1">
            Showing accepted stale detail.{" "}
            {detail.error ?? "The last pull reported an error."}
          </span>
          <Button onClick={detail.retry} size="sm" variant="ghost">
            Retry
          </Button>
        </div>
      ) : null}
      <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Finding evidence · tier {model.resolution.tier}
          </p>
          <h2 className="mt-1 truncate text-lg font-semibold">
            {model.rows[0]?.cve ?? "Cached finding"}
          </h2>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {model.rows[0]?.componentName ?? "Unknown component"} ·{" "}
            {model.rows[0]?.componentVersion ?? "version unknown"}
          </p>
        </div>
        <Button
          aria-label="Close finding detail"
          onClick={closeAndRestore}
          size="icon"
          variant="ghost"
        >
          <Icon aria-hidden="true" className="size-4" name="X" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-7 p-5">
          <IdentitySection model={model} />
          <ReachabilityEvidence
            factors={model.reachability.factors}
            verdict={model.reachability.verdict}
          />
          <DecisionSection model={model} />
          <DuplicateRows rows={model.rows} />
          {model.rows.length > 1 ? (
            <section aria-label="Transient row selection" className="space-y-2">
              <h3 className="text-sm font-semibold">
                Row-specific activity & comments
              </h3>
              <p className="text-xs text-muted-foreground">
                Choose the exact transient row. Selection is never inferred for
                a collision.
              </p>
              <div className="flex flex-wrap gap-2">
                {model.rows.map((row) => (
                  <Button
                    aria-pressed={effectiveSelectedRowId === row.findingId}
                    key={row.findingId}
                    onClick={() => setSelectedRowId(row.findingId)}
                    size="sm"
                    variant={
                      effectiveSelectedRowId === row.findingId
                        ? "secondary"
                        : "outline"
                    }
                  >
                    Use row {row.findingId}
                  </Button>
                ))}
              </div>
            </section>
          ) : null}
          {historyRow ? <DecisionHistory row={historyRow} /> : null}
          <FindingComments
            ambiguous={model.rows.length > 1}
            row={selectedRow}
          />
          <CrossLinks rows={model.rows} />
        </div>
      </div>
    </aside>
  );
}
