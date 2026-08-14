import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtime, useRpc } from "@bb/plugin-sdk/app";

import {
  FINDINGS_DRIFT_CHANGED_CHANNEL,
  type DriftReport,
} from "../../drift/report.js";
import type { findingsUiRpcContract } from "../../rpc.js";
import type { rpcContract } from "../../../../shared/contract.js";

interface DriftReportPanelProps {
  workspaceProjectId: string | null;
  platformProjectId: string | null;
  projectVersionId: string | null;
}

interface PrunePreview {
  baseStateSha256: string;
  stableKeys: string[];
  selected: number;
  pruned: number;
  chunks: number;
}

interface VendorPreview {
  importId: string;
  documentSha256: string;
}

type DriftPanelRpcContract = typeof findingsUiRpcContract &
  Pick<
    typeof rpcContract,
    "triageVendorVexPreview" | "triageVendorVexApply" | "triageOrphansPrune"
  >;

const DRIFT_LABELS: Record<keyof DriftReport["totals"], string> = {
  reattached_noop: "Reattached",
  reapply: "Reapply",
  stale: "Stale",
  orphaned: "Orphaned",
  conflict: "Conflicts",
  needs_completion: "Needs completion",
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The drift operation failed.";
}

export function DriftReportPanel({
  workspaceProjectId,
  platformProjectId,
  projectVersionId,
}: DriftReportPanelProps): React.JSX.Element {
  const rpc = useRpc<DriftPanelRpcContract>();
  const requestGeneration = useRef(0);
  const [report, setReport] = useState<DriftReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [vendor, setVendor] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [importing, setImporting] = useState(false);
  const [vendorPreview, setVendorPreview] = useState<VendorPreview | null>(
    null,
  );
  const [prunePreview, setPrunePreview] = useState<PrunePreview | null>(null);
  const scopeReady = Boolean(
    workspaceProjectId && platformProjectId && projectVersionId,
  );

  const loadReport = useCallback(
    async (cursor: string | null = null) => {
      if (!workspaceProjectId || !platformProjectId || !projectVersionId)
        return;
      const generation = ++requestGeneration.current;
      cursor ? setLoadingMore(true) : setLoading(true);
      setError(null);
      try {
        const next = await rpc.call("findingsDriftReport", {
          workspaceProjectId,
          platformProjectId,
          projectVersionId,
          cursor,
          limit: 100,
        });
        if (generation !== requestGeneration.current) return;
        setRefreshRequired(false);
        setReport((current) =>
          cursor && current && current.runId === next.runId
            ? {
                ...next,
                items: [...current.items, ...next.items],
              }
            : next,
        );
      } catch (cause) {
        if (generation !== requestGeneration.current) return;
        const detail = message(cause);
        if (detail.includes("DRIFT_REFRESH_REQUIRED")) {
          setRefreshRequired(true);
          setReport(null);
        } else {
          setError(detail);
        }
      } finally {
        if (generation === requestGeneration.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [platformProjectId, projectVersionId, rpc, workspaceProjectId],
  );

  useEffect(() => {
    requestGeneration.current += 1;
    setReport(null);
    setPrunePreview(null);
    setVendorPreview(null);
    setAction(null);
    if (scopeReady) void loadReport();
  }, [loadReport, scopeReady]);

  useRealtime(FINDINGS_DRIFT_CHANGED_CHANNEL, (payload) => {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "pvId" in payload &&
      payload.pvId === projectVersionId
    ) {
      void loadReport();
    }
  });

  const orphanKeys = useMemo(
    () =>
      report?.items
        .filter((item) => item.state === "orphaned")
        .map((item) => item.stableKey) ?? [],
    [report],
  );

  const refresh = useCallback(async () => {
    if (!workspaceProjectId || !platformProjectId || !projectVersionId) return;
    setLoading(true);
    const generation = ++requestGeneration.current;
    setError(null);
    setAction(null);
    try {
      const next = await rpc.call("findingsDriftRefresh", {
        workspaceProjectId,
        platformProjectId,
        projectVersionId,
      });
      if (generation !== requestGeneration.current) return;
      setReport(next);
      setRefreshRequired(false);
      setPrunePreview(null);
      setAction(
        `Drift refreshed · ${next.items.length.toLocaleString()} items loaded`,
      );
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setError(message(cause));
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [platformProjectId, projectVersionId, rpc, workspaceProjectId]);

  const previewImport = useCallback(async () => {
    if (
      !workspaceProjectId ||
      !platformProjectId ||
      !projectVersionId ||
      !file ||
      !vendor.trim()
    ) {
      return;
    }
    setImporting(true);
    setError(null);
    setAction(null);
    try {
      const upload = await fetch(
        "/api/v1/plugins/finite-state/http/findings/vendor-vex/document",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-fs-vendor-file": encodeURIComponent(file.name),
            "x-fs-workspace-project": workspaceProjectId,
            "x-fs-platform-project": platformProjectId,
            "x-fs-project-version": projectVersionId,
          },
          body: file,
        },
      );
      if (!upload.ok)
        throw new Error(`Vendor upload failed (${upload.status})`);
      const raw: unknown = await upload.json();
      if (
        typeof raw !== "object" ||
        raw === null ||
        !("documentSha256" in raw) ||
        typeof raw.documentSha256 !== "string"
      ) {
        throw new Error("Vendor upload returned an invalid digest");
      }
      const previewInput = {
        projectId: workspaceProjectId,
        projectVersionId,
        pageSize: 200,
        continuation: null,
        documentSha256: raw.documentSha256,
        vendor: vendor.trim(),
      };
      const result = await rpc.call("triageVendorVexPreview", previewInput);
      setVendorPreview({
        importId: result.importId,
        documentSha256: result.documentSha256,
      });
      setAction(
        `Import preview · ${result.matched.toLocaleString()} matched · ${result.unmatched.toLocaleString()} unmatched · digest ${result.documentSha256.slice(0, 12)}`,
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setImporting(false);
    }
  }, [
    file,
    platformProjectId,
    projectVersionId,
    rpc,
    vendor,
    workspaceProjectId,
  ]);

  const applyImport = useCallback(async () => {
    if (
      !workspaceProjectId ||
      !platformProjectId ||
      !projectVersionId ||
      !vendorPreview
    )
      return;
    setImporting(true);
    setError(null);
    setAction(null);
    try {
      const applyInput = {
        projectId: workspaceProjectId,
        projectVersionId,
        pageSize: 200,
        continuation: null,
        importId: vendorPreview.importId,
        expectedDocumentSha256: vendorPreview.documentSha256,
        overwrite,
      };
      const result = await rpc.call("triageVendorVexApply", applyInput);
      setAction(
        `Vendor VEX imported · ${result.matched.toLocaleString()} matched · ${result.unmatched.toLocaleString()} unmatched · ${result.written.toLocaleString()} written`,
      );
      if (result.written > 0) await loadReport();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setImporting(false);
    }
  }, [
    loadReport,
    overwrite,
    platformProjectId,
    projectVersionId,
    rpc,
    vendorPreview,
    workspaceProjectId,
  ]);

  const previewPrune = useCallback(async () => {
    if (
      !workspaceProjectId ||
      !platformProjectId ||
      !projectVersionId ||
      orphanKeys.length === 0
    ) {
      return;
    }
    setError(null);
    setAction(null);
    try {
      const state = await rpc.call("findingsDriftOrphanState", {
        workspaceProjectId,
        platformProjectId,
        projectVersionId,
      });
      setPrunePreview({
        baseStateSha256: state.baseStateSha256,
        stableKeys: orphanKeys,
        selected: orphanKeys.length,
        pruned: 0,
        chunks: 0,
      });
    } catch (cause) {
      setError(message(cause));
    }
  }, [
    orphanKeys,
    platformProjectId,
    projectVersionId,
    rpc,
    workspaceProjectId,
  ]);

  const confirmPrune = useCallback(async () => {
    if (
      !workspaceProjectId ||
      !platformProjectId ||
      !projectVersionId ||
      !prunePreview
    ) {
      return;
    }
    setError(null);
    try {
      const chunk = prunePreview.stableKeys.slice(0, 500);
      const result = await rpc.call("triageOrphansPrune", {
        projectId: workspaceProjectId,
        projectVersionId,
        stableKeys: chunk,
        expectedBaseStateSha256: prunePreview.baseStateSha256,
      });
      const pruned = prunePreview.pruned + result.applied;
      const chunks = prunePreview.chunks + 1;
      const failedKeys = result.results
        .filter((item) => !item.success)
        .map((item) => item.stableKey);
      const remaining = [
        ...failedKeys,
        ...prunePreview.stableKeys.slice(chunk.length),
      ];
      if (remaining.length > 0) {
        setPrunePreview(null);
        setAction(
          `Pruned ${pruned.toLocaleString()} of ${prunePreview.selected.toLocaleString()} orphaned decisions in ${chunks.toLocaleString()} chunk(s) · ${remaining.length.toLocaleString()} remain and require a refreshed digest plus confirmation`,
        );
        const state = await rpc.call("findingsDriftOrphanState", {
          workspaceProjectId,
          platformProjectId,
          projectVersionId,
        });
        setPrunePreview({
          baseStateSha256: state.baseStateSha256,
          stableKeys: remaining,
          selected: prunePreview.selected,
          pruned,
          chunks,
        });
        await loadReport();
        return;
      }
      setPrunePreview(null);
      setAction(
        `Pruned ${pruned.toLocaleString()} orphaned decisions in ${chunks.toLocaleString()} explicitly confirmed CAS-guarded chunk(s)`,
      );
      await loadReport();
    } catch (cause) {
      setError(message(cause));
    }
  }, [
    loadReport,
    platformProjectId,
    projectVersionId,
    prunePreview,
    rpc,
    workspaceProjectId,
  ]);

  if (!scopeReady) {
    return (
      <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        Choose a findings scope to inspect drift.
      </div>
    );
  }

  return (
    <details className="border-b border-border bg-card" open>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Drift report
        {report ? (
          <span className="ml-2 font-normal text-muted-foreground">
            {Object.values(report.totals)
              .reduce((total, count) => total + count, 0)
              .toLocaleString()}{" "}
            classified
          </span>
        ) : null}
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3 text-sm">
        {loading && !report ? (
          <div aria-label="Loading drift report" className="space-y-2">
            <div className="h-4 w-56 animate-pulse rounded bg-muted" />
            <div className="h-8 w-full animate-pulse rounded bg-muted" />
          </div>
        ) : error && !report ? (
          <div role="status">
            <p className="text-destructive">{error}</p>
            <button
              className="mt-2 rounded border border-border px-2 py-1"
              onClick={() => void loadReport()}
              type="button"
            >
              Retry report
            </button>
          </div>
        ) : refreshRequired ? (
          <div>
            <p className="text-muted-foreground">
              No drift report exists for this accepted findings version yet.
            </p>
            <button
              className="mt-2 rounded border border-border px-2 py-1"
              disabled={loading}
              onClick={() => void refresh()}
              type="button"
            >
              Refresh drift
            </button>
          </div>
        ) : report ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {Object.entries(report.totals).map(([state, count]) => (
                <span
                  className="rounded border border-border bg-muted/50 px-2 py-1"
                  key={state}
                >
                  {DRIFT_LABELS[state as keyof typeof DRIFT_LABELS]}{" "}
                  {count.toLocaleString()}
                </span>
              ))}
              <button
                className="rounded border border-border px-2 py-1"
                disabled={loading}
                onClick={() => void refresh()}
                type="button"
              >
                Refresh
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Run <span className="font-mono">{report.runId}</span> ·{" "}
              {report.createdAt} · {report.unclassifiedCount.toLocaleString()}{" "}
              unclassified
            </p>
            {report.items.length === 0 ? (
              <p className="text-muted-foreground">
                No local decisions currently drift from this version.
              </p>
            ) : (
              <ul
                className="max-h-44 space-y-1 overflow-auto"
                aria-label="Drift findings"
              >
                {report.items.map((item) => (
                  <li
                    className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 rounded bg-muted/40 px-2 py-1"
                    key={item.stableKey}
                  >
                    <span className="font-medium">
                      {DRIFT_LABELS[item.state]}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">
                        {item.stableKey}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.reason}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {report.nextCursor ? (
              <button
                className="rounded border border-border px-2 py-1"
                disabled={loadingMore}
                onClick={() => void loadReport(report.nextCursor)}
                type="button"
              >
                {loadingMore ? "Loading…" : "Load more drift"}
              </button>
            ) : null}
          </>
        ) : null}

        <div className="grid gap-2 border-t border-border pt-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <p className="font-medium">Import vendor VEX</p>
            <input
              aria-label="Vendor name"
              className="w-full rounded border border-border bg-background px-2 py-1"
              onChange={(event) => {
                setVendor(event.target.value);
                setVendorPreview(null);
              }}
              placeholder="Vendor name"
              value={vendor}
            />
            <input
              accept="application/json,.json"
              aria-label="Vendor VEX file"
              className="w-full text-xs"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setVendorPreview(null);
              }}
              type="file"
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                checked={overwrite}
                onChange={(event) => setOverwrite(event.target.checked)}
                type="checkbox"
              />
              Overwrite existing local decisions (human review only)
            </label>
            <div className="flex gap-2">
              <button
                className="rounded border border-border px-2 py-1"
                disabled={importing || !file || !vendor.trim()}
                onClick={() => void previewImport()}
                type="button"
              >
                Preview import
              </button>
              <button
                className="rounded border border-border px-2 py-1"
                disabled={importing || !vendorPreview}
                onClick={() => void applyImport()}
                type="button"
              >
                Import VEX
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Orphan cleanup</p>
            <p className="text-xs text-muted-foreground">
              Pruning edits local YAML. Preview uses the loaded orphan keys and
              a fresh base-state digest.
            </p>
            {prunePreview ? (
              <div className="rounded border border-destructive/40 p-2">
                <p>
                  Remove up to{" "}
                  {Math.min(
                    500,
                    prunePreview.stableKeys.length,
                  ).toLocaleString()}{" "}
                  of {prunePreview.selected.toLocaleString()} proven orphaned
                  decisions using digest{" "}
                  <code className="break-all font-mono text-xs">
                    {prunePreview.baseStateSha256}
                  </code>
                  ?
                </p>
                <button
                  className="mt-2 rounded border border-destructive/60 px-2 py-1 text-destructive"
                  onClick={() => void confirmPrune()}
                  type="button"
                >
                  Confirm prune
                </button>
                <button
                  className="ml-2 rounded border border-border px-2 py-1"
                  onClick={() => setPrunePreview(null)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="rounded border border-border px-2 py-1"
                disabled={orphanKeys.length === 0}
                onClick={() => void previewPrune()}
                type="button"
              >
                Preview prune loaded orphans (
                {orphanKeys.length.toLocaleString()})
              </button>
            )}
          </div>
        </div>
        {error && report ? (
          <p className="text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {action ? (
          <p className="text-muted-foreground" role="status">
            {action}
          </p>
        ) : null}
      </div>
    </details>
  );
}
