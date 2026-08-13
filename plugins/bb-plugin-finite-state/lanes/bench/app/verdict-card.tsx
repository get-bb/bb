import { useCallback, useEffect, useState } from "react";
import {
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { VerdictEvidence, VerdictResult } from "../verdict/evaluate.js";
import type { OtaVerdictRpcContract } from "../verdict/query.js";

export interface VerdictCardProps {
  /** Product-version identifier; omitted callers retain a truthful unconfigured seam. */
  id?: string;
  /** Optional historical digest. The server still derives and labels the verdict. */
  digest?: string;
  /** Known project scope for an embedded card; directives resolve this server-side. */
  projectId?: string;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

const VERDICT_STYLE = {
  SAFE_TO_OTA: {
    label: "Safe to OTA",
    icon: "CircleCheck" as const,
    card: "border-success/40 bg-success/5",
    color: "text-success",
  },
  NOT_SAFE: {
    label: "Not safe to OTA",
    icon: "AlertCircle" as const,
    card: "border-destructive/40 bg-destructive/5",
    color: "text-destructive",
  },
  INCONCLUSIVE: {
    label: "Inconclusive",
    icon: "AlertTriangle" as const,
    card: "border-warning/40 bg-warning/5",
    color: "text-warning",
  },
} as const;

const STATE_LABELS: Record<VerdictEvidence["state"], string> = {
  proven: "Proven",
  failed: "Failed",
  error: "Error",
  unmapped: "Missing mapping",
  not_run: "Not run",
  running: "Running",
  skipped: "Skipped",
  unsigned: "Unsigned",
  invalid_signature: "Invalid signature",
  insufficient_scope: "Insufficient attestation scope",
  stale_digest: "Stale digest",
};

function stateBadge(evidence: VerdictEvidence): React.JSX.Element {
  const variant = evidence.state === "failed" || evidence.state === "error"
    ? "destructive"
    : evidence.state === "proven" ? "secondary" : "outline";
  return <Badge variant={variant}>{STATE_LABELS[evidence.state]}</Badge>;
}

function Guidance({ message }: { message: string }): React.JSX.Element {
  return (
    <section aria-label="OTA verdict unavailable" className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-md bg-muted p-2 text-muted-foreground"><Icon name="Target" /></span>
        <div><h3 className="text-sm font-semibold">OTA verdict unavailable</h3><p className="mt-1 text-xs text-muted-foreground">{message}</p></div>
      </div>
    </section>
  );
}

export function VerdictCard({ id, digest, projectId: embeddedProjectId }: VerdictCardProps): React.JSX.Element {
  const { projectId: contextProjectId } = useBbContext();
  const projectId = embeddedProjectId ?? contextProjectId;
  const navigate = useBbNavigate();
  const rpc = useRpc<OtaVerdictRpcContract>();
  const [result, setResult] = useState<VerdictResult | null>(null);
  const [loading, setLoading] = useState(id !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const validId = id !== undefined && SAFE_ID.test(id);
  const validDigest = digest === undefined || SHA256.test(digest);

  const load = useCallback(async () => {
    if (!projectId || !id || !validId || !validDigest) return;
    setLoading(true);
    try {
      const loaded = await rpc.call("benchOtaVerdictGet", {
        projectId,
        pvId: id,
        ...(digest ? { digest } : {}),
      });
      setResult(loaded);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The OTA verdict could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [digest, id, projectId, rpc, validDigest, validId]);
  useEffect(() => { void load(); }, [load, revision]);
  useRealtime("bench:changed", () => setRevision((value) => value + 1));

  if (!id) return <Guidance message="Select a product version to evaluate its complete requirement matrix." />;
  if (!projectId) return <Guidance message="Select the bb project that owns this product version." />;
  if (!validId) return <Guidance message="The product-version identifier is invalid. No request was sent." />;
  if (!validDigest) return <Guidance message="The firmware digest must be a lowercase sha256 value. No request was sent." />;
  if (loading && !result) {
    return <div aria-label="Loading OTA verdict" className="space-y-3 rounded-lg border border-border bg-card p-4" role="status"><Skeleton className="h-12 w-56" /><Skeleton className="h-5 w-full" /><Skeleton className="h-24 w-full" /></div>;
  }
  if (!result) {
    return <Alert variant="destructive"><Icon name="AlertCircle" /><AlertDescription className="flex items-center gap-3"><span>{error ?? "This product version has no verdict evidence."}</span><Button className="ml-auto" onClick={() => setRevision((value) => value + 1)} size="sm" variant="outline">Retry</Button></AlertDescription></Alert>;
  }

  const style = VERDICT_STYLE[result.verdict];
  const blockers = result.evidence.filter((entry) => entry.required && entry.state !== "proven");
  const signatures = result.evidence.filter((entry) =>
    entry.state === "proven" && entry.attestationVerified);
  const mountedDigestUnknown = result.firmwareDigest !== null
    && result.currentMountedDigest === null;
  const tiers = new Map<string, { proven: number; total: number }>();
  const requirements = new Map<string, { proven: number; total: number }>();
  for (const entry of result.evidence) {
    const tier = tiers.get(entry.tier) ?? { proven: 0, total: 0 };
    tier.total += 1;
    if (entry.state === "proven") tier.proven += 1;
    tiers.set(entry.tier, tier);
    const requirement = requirements.get(entry.requirementId) ?? { proven: 0, total: 0 };
    requirement.total += 1;
    if (entry.state === "proven") requirement.proven += 1;
    requirements.set(entry.requirementId, requirement);
  }

  return (
    <section aria-label={`OTA verdict: ${style.label}`} className={`overflow-hidden rounded-lg border ${style.card}`}>
      <header className="flex flex-wrap items-start gap-3 border-b border-border/70 p-4">
        <span className={`rounded-md bg-background/70 p-2 ${style.color}`}><Icon aria-hidden="true" name={style.icon} /></span>
        <div className="min-w-0 flex-1"><p className={`text-lg font-semibold ${style.color}`}>{style.label}</p><p className="mt-1 text-xs text-muted-foreground">Deterministic verdict across the product-version requirement matrix</p></div>
        {result.stale ? <Badge className="border-warning/40 text-warning" variant="outline">Historical — not current</Badge> : mountedDigestUnknown ? <Badge className="border-warning/40 text-warning" variant="outline">Mounted digest unknown</Badge> : null}
      </header>

      <div className="space-y-4 p-4">
        <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Firmware digest</p><p className="mt-1 break-all font-mono text-xs">{result.firmwareDigest ?? "Unavailable"}</p>{result.stale || mountedDigestUnknown ? <p className="mt-1 text-xs text-warning">Currently mounted: <span className="font-mono">{result.currentMountedDigest ?? "unavailable"}</span></p> : null}</div>
        {result.issues.length > 0 ? <Alert><Icon name="AlertTriangle" /><AlertDescription>{result.issues.map((issue) => <p key={issue.code}><span className="font-medium">{issue.code}</span> — {issue.message}</p>)}</AlertDescription></Alert> : null}
        {error ? <Alert variant="destructive"><AlertDescription className="flex items-center gap-3"><span>Showing the last computed verdict. Refresh failed: {error}</span><Button className="ml-auto" onClick={() => setRevision((value) => value + 1)} size="sm" variant="outline">Retry</Button></AlertDescription></Alert> : null}

        <div>
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">Blocking failures and gaps</h3><Badge variant="outline">{blockers.length}</Badge></div>
          {blockers.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No required cell is blocking this verdict.</p> : <div className="mt-2 space-y-2">{blockers.map((entry) => {
            const download = entry.runId && entry.attestationId
              ? `/api/v1/plugins/finite-state/http/bench/runs/attestation?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(entry.runId)}`
              : null;
            return <div className="rounded-md border border-border bg-background/80 p-3" key={`${entry.requirementId}-${entry.tier}`}><div className="flex flex-wrap items-center gap-2">{stateBadge(entry)}<span className="text-sm font-medium">{entry.requirementId}</span><span className="font-mono text-xs text-muted-foreground">{entry.tier}{entry.checkId ? ` · ${entry.checkId}` : ""}</span></div><div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => navigate.toPluginPanel("product-security", { subPath: `verifications/${encodeURIComponent(entry.requirementId)}/${entry.tier}` })} size="sm" variant="outline">Matrix cell</Button>{entry.runId ? <Button onClick={() => navigate.toPluginPanel("bench", { subPath: encodeURIComponent(entry.runId!) })} size="sm" variant="outline">Run evidence</Button> : null}{download ? <Button asChild size="sm" variant="outline"><a href={download}>Download evidence</a></Button> : null}</div></div>;
          })}</div>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border bg-background/70 p-3"><p className="text-xs text-muted-foreground">Required coverage</p><p className="mt-1 text-xl font-semibold">{result.proven}/{result.required}</p><p className="text-xs text-muted-foreground">{result.failed} failed · {result.gaps} gaps</p></div>
          <div className="rounded-md border border-border bg-background/70 p-3"><p className="text-xs text-muted-foreground">Requirement coverage</p><p className="mt-1 text-xl font-semibold">{[...requirements.values()].filter((value) => value.proven === value.total).length}/{requirements.size}</p><p className="text-xs text-muted-foreground">all declared tiers proven</p></div>
        </div>
        <div><h3 className="text-sm font-semibold">Tier coverage</h3><div className="mt-2 flex flex-wrap gap-2">{[...tiers.entries()].map(([tier, coverage]) => <Badge key={tier} variant="outline">{tier} {coverage.proven}/{coverage.total}</Badge>)}</div></div>
        <div><h3 className="text-sm font-semibold">Evidence coverage</h3><div className="mt-2 space-y-2">{result.evidence.map((entry) => {
          const download = entry.runId && entry.attestationId
            ? `/api/v1/plugins/finite-state/http/bench/runs/attestation?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(entry.runId)}`
            : null;
          return <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/70 p-2" key={`coverage-${entry.requirementId}-${entry.tier}`}>{stateBadge(entry)}<span className="mr-auto text-xs"><span className="font-medium">{entry.requirementId}</span> · {entry.tier}{entry.checkId ? ` · ${entry.checkId}` : ""}</span><Button aria-label={`Open matrix evidence for ${entry.requirementId} ${entry.tier}`} onClick={() => navigate.toPluginPanel("product-security", { subPath: `verifications/${encodeURIComponent(entry.requirementId)}/${entry.tier}` })} size="sm" variant="outline">Matrix</Button>{entry.runId ? <Button aria-label={`Open run evidence ${entry.runId}`} onClick={() => navigate.toPluginPanel("bench", { subPath: encodeURIComponent(entry.runId!) })} size="sm" variant="outline">Run</Button> : <Badge variant="outline">No run to open</Badge>}{download ? <Button asChild size="sm" variant="outline"><a href={download}>Download</a></Button> : <Badge variant="outline">No signed download</Badge>}</div>;
        })}</div></div>
        <div><h3 className="text-sm font-semibold">Signature</h3>{signatures.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No counted proof has a verified, subject-bound signature.</p> : <div className="mt-2 space-y-1">{signatures.map((entry) => <p className="text-xs" key={entry.attestationId}><Icon className="mr-1 inline size-3 text-success" name="CircleCheck" />Verified · {entry.signerIdentity ?? "identity not recorded"} · <span className="font-mono">{entry.attestationId}</span></p>)}</div>}</div>
      </div>
    </section>
  );
}
