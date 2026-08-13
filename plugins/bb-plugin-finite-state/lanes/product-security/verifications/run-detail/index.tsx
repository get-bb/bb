import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { RpcContract } from "../../../../shared/contract.js";
import { isVerificationTier, type VerificationTier } from "../matrix/status.js";
import type { AttestationView } from "./attestation.js";
import { verificationRunDetailRpcContract } from "./logs.js";
import { RunDetail, type CheckContract, type DetailRun, type RunDetailModel } from "./RunDetail.js";
import type { ResultHistoryItem } from "./ResultHistory.js";

interface Props { projectId: string; detail?: readonly string[] }
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}
function records(value: unknown): UnknownRecord[] { return Array.isArray(value) ? value.map((item) => record(item)).filter((item): item is UnknownRecord => item !== null) : []; }
function text(value: unknown): string | null { return typeof value === "string" ? value : null; }
function bool(value: unknown): boolean { return value === true; }
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }

function historyItem(value: UnknownRecord): ResultHistoryItem {
  return { id: text(value.id) ?? "unknown-result", status: text(value.status) ?? "unknown", outcome: text(value.outcome), confidence: text(value.confidence), evidenceSummary: text(value.evidenceSummary), executedAt: text(value.executedAt), failureReason: text(value.failureReason), remediationSuggestion: text(value.remediationSuggestion), firmwareVersionName: text(value.firmwareVersionName), isLatest: bool(value.isLatest), supersededBy: text(value.supersededBy) };
}

function parseModel(fields: UnknownRecord): RunDetailModel {
  const runValue = record(fields.run);
  const run: DetailRun | null = runValue ? { id: text(runValue.id) ?? "unknown-run", status: text(runValue.status) ?? "unknown", firmwareDigest: text(runValue.firmwareDigest), jobId: text(runValue.jobId), startedAt: text(runValue.startedAt), finishedAt: text(runValue.finishedAt), target: text(runValue.target), logAvailable: bool(runValue.logAvailable) } : null;
  const checks: CheckContract[] = records(fields.checks).map((check) => ({ id: text(check.id) ?? "unknown-check", code: text(check.code) ?? "unknown", name: text(check.name) ?? "Unnamed check", type: text(check.type) ?? "unknown", category: text(check.category), description: text(check.description), passCriteria: text(check.passCriteria), failCriteria: text(check.failCriteria), inputDescription: text(check.inputDescription), required: bool(check.required), coverageLevel: text(check.coverageLevel), suppressed: bool(check.suppressed) }));
  const attestations: AttestationView[] = records(fields.attestations).map((item) => ({ id: text(item.id) ?? "unknown-attestation", runId: text(item.runId) ?? "unknown-run", firmwareDigest: text(item.firmwareDigest) ?? "unavailable", evidenceDigest: text(item.evidenceDigest) ?? "unavailable", signer: text(item.signer) ?? "unknown signer", signature: text(item.signature) ?? "unavailable", signedAt: text(item.signedAt) ?? "time unknown", verification: item.verification === "valid" || item.verification === "invalid" ? item.verification : "unverified", boundToCurrentFirmware: bool(item.boundToCurrentFirmware) }));
  return {
    requirementId: text(fields.requirementId) ?? "unknown requirement", tier: text(fields.tier) ?? "unknown",
    run, checks, history: records(fields.history).map(historyItem), historyTotal: number(fields.historyTotal), historyNext: text(fields.historyNext),
    artifacts: records(fields.artifacts).map((item) => ({ id: text(item.id) ?? "unknown-artifact", name: text(item.name) ?? "unsafe", kind: text(item.kind) ?? "unknown", mediaType: text(item.mediaType), sha256: text(item.sha256), bytes: typeof item.bytes === "number" ? item.bytes : null })),
    attestations, manualMessage: text(fields.manualAttestationMessage) ?? "Manual evidence recording is unavailable.", taraConcurrency: text(fields.taraConcurrency) ?? "TARA concurrency state is unavailable.",
  };
}

function route(detail: readonly string[] | undefined): { requirementId: string; tier: VerificationTier } | null {
  if (!detail || detail.length !== 2 || !detail[0] || !detail[1] || !isVerificationTier(detail[1])) return null;
  return { requirementId: detail[0], tier: detail[1] };
}

export function VerificationRunDetailLayer({ projectId, detail }: Props): React.JSX.Element | null {
  const target = route(detail);
  const requirementId = target?.requirementId;
  const tier = target?.tier;
  const rpc = useRpc<RpcContract & typeof verificationRunDetailRpcContract>();
  const [model, setModel] = useState<RunDetailModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [running, setRunning] = useState(false);
  const [jobState, setJobState] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    if (!requirementId || !tier) return;
    setLoading(true);
    try {
      const detailResult = await rpc.call("verificationsRunGet", { projectId, projectVersionId: null, runId: `${requirementId}:${tier}` });
      setModel(parseModel(detailResult.fields)); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Verification run detail could not be loaded."); }
    finally { setLoading(false); }
  }, [projectId, requirementId, rpc, tier]);
  useEffect(() => { void load(); }, [load, revision]);
  useRealtime("verifications:changed", (payload) => {
    if (typeof payload === "object" && payload !== null && Reflect.get(payload, "projectId") === projectId) setRevision((value) => value + 1);
  });
  if (!target) return null;
  if (loading && !model) return <div aria-label="Loading verification run detail" className="space-y-3 p-4" role="status"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /><Skeleton className="h-72 w-full" /></div>;
  if (!model) return <div className="flex h-full items-center justify-center p-6"><section className="max-w-md rounded-lg border border-border bg-card p-6 text-center"><Icon className="mx-auto size-6 text-destructive" name="AlertCircle" /><h2 className="mt-3 text-lg font-semibold">Run detail unavailable</h2><p className="mt-2 text-sm text-muted-foreground">{error ?? "No accepted evidence is cached for this requirement."}</p><Button className="mt-4" onClick={() => setRevision((value) => value + 1)} variant="outline">Retry</Button></section></div>;
  return <RunDetail error={error} jobState={jobState} loadingHistory={loadingHistory} model={model} onLoadMore={() => {
    if (!model.historyNext) return; setLoadingHistory(true);
    void rpc.call("verificationResultHistoryList", { projectId, projectVersionId: null, requirementId: target.requirementId, tier: target.tier, pageSize: 50, continuation: model.historyNext }).then((page) => setModel((current) => current ? { ...current, history: [...current.history, ...page.items.map((item) => historyItem(item.fields))], historyTotal: page.total, historyNext: page.next } : current)).catch((cause) => setError(cause instanceof Error ? cause.message : "History page failed.")).finally(() => setLoadingHistory(false));
  }} onRetry={() => setRevision((value) => value + 1)} onRun={(checkId) => {
    setRunning(true); setJobState("QUEUED");
    void rpc.call("verificationsRunStart", { projectId, projectVersionId: null, requirementId: target.requirementId, tier: target.tier, checkId, parameters: {} }).then((job) => { setJobState(job.state); setRevision((value) => value + 1); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Verification invocation failed.")).finally(() => setRunning(false));
  }} projectId={projectId} running={running} />;
}

export { runVerification } from "./actions.js";
export type { ActionDeps, VerificationJob, VerificationRunRequest } from "./actions.js";
export type { AttestationView } from "./attestation.js";
