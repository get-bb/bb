import { useCallback, useEffect, useState } from "react";
import {
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginThreadPanelProps,
} from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { JsonValue, RpcContract } from "../../../shared/contract.js";
import { ArtifactList } from "./artifact-list.js";
import { LogTail } from "./log-tail.js";
import { VerdictCard } from "./verdict-card.js";

interface RunDetailProps {
  runId: string;
  projectId: string;
  projectVersionId: string | null;
  compact?: boolean;
}

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;

interface DetailArtifact {
  name: string;
  kind: string;
  sha256: string | null;
  bytes: number | null;
  downloadAvailable: boolean;
}

interface DetailResult {
  requirementId: string;
  checkId: string;
  outcome: string;
  evidenceSummary: string | null;
}

interface DetailAttestation {
  format: string;
  subjectDigest: string;
  verified: boolean;
}

interface DetailModel {
  id: string;
  projectVersionId: string | null;
  tier: string;
  status: string;
  target: string | null;
  firmwareDigest: string | null;
  threadId: string | null;
  config: JsonValue | null;
  results: DetailResult[];
  artifacts: DetailArtifact[];
  attestations: DetailAttestation[];
  stale: boolean;
  cacheMessage: string | null;
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function finiteNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function records(value: JsonValue | undefined): Array<Record<string, JsonValue>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function detailModel(detail: {
  key: string;
  projectVersionId: string | null;
  fields: Record<string, JsonValue>;
  cache: { state: string; message: string | null };
}): DetailModel {
  const fields = detail.fields;
  return {
    id: detail.key,
    projectVersionId: detail.projectVersionId,
    tier: text(fields.tier) ?? "unknown tier",
    status: text(fields.status) ?? "unknown",
    target: text(fields.target),
    firmwareDigest: text(fields.firmwareDigest),
    threadId: text(fields.threadId),
    config: fields.config ?? null,
    results: records(fields.results).map((result) => ({
      requirementId: text(result.requirementId) ?? text(result.reportedRequirementId) ?? "unmapped requirement",
      checkId: text(result.checkId) ?? text(result.reportedCheckId) ?? "unmapped check",
      outcome: text(result.outcome) ?? "unknown",
      evidenceSummary: text(result.evidenceSummary),
    })),
    artifacts: records(fields.artifacts).map((artifact) => ({
      name: text(artifact.name) ?? "",
      kind: text(artifact.kind) ?? "unknown",
      sha256: text(artifact.sha256),
      bytes: finiteNumber(artifact.bytes),
      downloadAvailable: artifact.downloadAvailable === true,
    })),
    attestations: records(fields.attestations).map((attestation) => ({
      format: text(attestation.format) ?? "unknown",
      subjectDigest: text(attestation.subjectDigest) ?? "unavailable",
      verified: attestation.verified === true,
    })),
    stale: detail.cache.state === "stale",
    cacheMessage: detail.cache.message,
  };
}

export function RunDetail({
  runId,
  projectId,
  projectVersionId,
  compact = false,
}: RunDetailProps): React.JSX.Element {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [detail, setDetail] = useState<DetailModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    if (!SAFE_RUN_ID.test(runId)) {
      setDetail(null);
      setError("The bench run identifier is invalid.");
      setLoading(false);
      return;
    }
    try {
      const result = await rpc.call("benchRunGet", { projectId, projectVersionId, runId });
      setDetail(detailModel(result));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bench run detail could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [projectId, projectVersionId, rpc, runId]);
  useEffect(() => { void load(); }, [load, revision]);
  useRealtime("bench:changed", (payload) => {
    if (typeof payload === "object" && payload !== null && Reflect.get(payload, "runId") === runId) setRevision((value) => value + 1);
  });

  if (loading && !detail) return <div aria-label="Loading bench run detail" className="space-y-3 p-4" role="status"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!detail) return <div className="flex h-full items-center justify-center p-6"><section className="max-w-md rounded-lg border border-border bg-card p-6 text-center"><Icon className="mx-auto size-6 text-destructive" name="AlertCircle" /><h2 className="mt-3 text-lg font-semibold">Unknown bench run</h2><p className="mt-2 text-sm text-muted-foreground">{error ?? `Run ${runId} is not present in the bounded bench cache.`}</p><Button className="mt-4" onClick={() => setRevision((value) => value + 1)} variant="outline">Retry</Button></section></div>;

  const attestationDownload = `/api/v1/plugins/finite-state/http/bench/runs/${encodeURIComponent(runId)}/attestation`;
  return (
    <article className="h-full overflow-auto bg-background p-4 text-foreground">
      <div className={compact ? "space-y-4" : "mx-auto max-w-5xl space-y-4"}>
        <header className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-mono text-lg font-semibold">{detail.id}</h2><Badge variant="outline">{detail.tier}</Badge><Badge variant="secondary">{detail.status}</Badge></div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">Firmware {detail.firmwareDigest ?? "unavailable"}</p>
          <div className="mt-3 flex flex-wrap gap-2">{detail.threadId ? <Button onClick={() => navigate.toThread(detail.threadId!)} size="sm"><Icon name="BubbleChatQuestion" />Open native run thread</Button> : <Badge aria-label="Native run thread unavailable" variant="outline">Native thread unavailable</Badge>}</div>
        </header>
        {detail.stale || error || detail.cacheMessage ? <Alert><Icon name="AlertTriangle" /><AlertDescription className="flex items-center gap-3"><span>{error ? `Showing cached detail. ${error}` : detail.cacheMessage ?? "Showing stale cached detail."}</span><Button className="ml-auto" onClick={() => setRevision((value) => value + 1)} size="sm" variant="outline">Retry</Button></AlertDescription></Alert> : null}
        <section className="rounded-lg border border-border bg-card p-4"><h3 className="text-sm font-semibold">Configuration</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Project version</dt><dd className="mt-1 font-mono">{detail.projectVersionId ?? "project latest"}</dd></div><div><dt className="text-xs text-muted-foreground">Target</dt><dd className="mt-1">{detail.target ?? "All configured checks"}</dd></div></dl>{detail.config !== null ? <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(detail.config, null, 2)}</pre> : <p className="mt-3 text-xs text-muted-foreground">No deployment configuration was recorded.</p>}</section>
        <section className="rounded-lg border border-border bg-card p-4"><h3 className="text-sm font-semibold">Requirement and check results</h3>{detail.results.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No check results have arrived.</p> : <div className="mt-3 space-y-2">{detail.results.map((result, index) => <div className="rounded-md border border-border bg-background p-3" key={`${result.requirementId}-${result.checkId}-${index}`}><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{result.outcome}</Badge><span className="text-sm font-medium">{result.requirementId}</span><span className="font-mono text-xs text-muted-foreground">{result.checkId}</span></div>{result.evidenceSummary ? <p className="mt-2 text-xs text-muted-foreground">{result.evidenceSummary}</p> : null}</div>)}</div>}</section>
        <LogTail projectId={projectId} projectVersionId={projectVersionId} runId={runId} />
        <section className="rounded-lg border border-border bg-card p-4"><h3 className="text-sm font-semibold">Artifacts</h3><div className="mt-3"><ArtifactList artifacts={detail.artifacts} runId={runId} /></div></section>
        <section className="rounded-lg border border-border bg-card p-4"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">Attestation</h3>{detail.attestations.length > 0 ? <Button asChild className="ml-auto" size="sm" variant="outline"><a href={attestationDownload}><Icon name="Download" />Download envelope</a></Button> : null}</div>{detail.attestations.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Unsigned: no attestation metadata is available.</p> : <div className="mt-3 space-y-2">{detail.attestations.map((attestation, index) => <div className="flex items-center gap-2 rounded-md border border-border bg-background p-3" key={`${attestation.subjectDigest}-${index}`}><Badge variant={attestation.verified ? "secondary" : "outline"}>{attestation.verified ? "Verified" : "Unverified"}</Badge><span className="text-xs">{attestation.format}</span><span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{attestation.subjectDigest}</span></div>)}</div>}</section>
        <VerdictCard />
      </div>
    </article>
  );
}

function paramRunId(params: JsonValue | null): string | null {
  if (params === null || !isRecord(params)) return null;
  const value = params.runId;
  return typeof value === "string" && SAFE_RUN_ID.test(value) ? value : null;
}

export function BenchThreadRunDetail({ threadId, params }: PluginThreadPanelProps): React.JSX.Element {
  const { projectId } = useBbContext();
  const rpc = useRpc<RpcContract>();
  const suppliedRunId = paramRunId(params);
  const [runId, setRunId] = useState<string | null>(suppliedRunId);
  const [resolving, setResolving] = useState(suppliedRunId === null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId || suppliedRunId) return;
    let active = true;
    void (async () => {
      const page = await rpc.call("benchRunsList", { projectId, projectVersionId: null, pageSize: 200, continuation: null });
      const match = page.items.find((item) => text(item.fields.threadId) === threadId);
      if (match) { if (active) setRunId(match.key); return; }
      if (active) setResolveError("No cached bench run references this native thread.");
    })().catch((cause: unknown) => { if (active) setResolveError(cause instanceof Error ? cause.message : "Run lookup failed."); }).finally(() => { if (active) setResolving(false); });
    return () => { active = false; };
  }, [projectId, rpc, suppliedRunId, threadId]);
  if (!projectId) return <Alert className="m-4"><Icon name="AlertTriangle" /><AlertDescription>Select the bb project that owns this run.</AlertDescription></Alert>;
  if (resolving) return <div aria-label="Resolving bench run" className="space-y-3 p-4" role="status"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (!runId) return <Alert className="m-4"><Icon name="AlertCircle" /><AlertDescription>{resolveError ?? "Bench run is unavailable."}</AlertDescription></Alert>;
  return <RunDetail compact projectId={projectId} projectVersionId={null} runId={runId} />;
}
