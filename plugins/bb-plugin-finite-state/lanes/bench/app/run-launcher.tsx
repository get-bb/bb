import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import type { JsonValue, RpcContract } from "../../../shared/contract.js";
import { HostEnrollment, type EnrolledBenchHost } from "./host-enrollment.js";

const TIER_1_REQUIREMENTS = [
  "forgeCompute",
  "allowPentest",
  "docker",
  "cveEvidenceVerifier",
] as const;

interface RunLauncherProps {
  projectId: string;
  projectVersionId: string;
  initialTier?: "tier0" | "tier1";
  onClose(): void;
  onFailed?(runId: string, message: string): void;
  onStarted(runId: string): void;
}

function fieldText(fields: Record<string, JsonValue>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" ? value : null;
}

export function RunLauncher({
  projectId,
  projectVersionId,
  initialTier = "tier0",
  onClose,
  onFailed,
  onStarted,
}: RunLauncherProps): React.JSX.Element {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const submitRef = useRef(false);
  const [tier, setTier] = useState<"tier0" | "tier1">(initialTier);
  const [hosts, setHosts] = useState<EnrolledBenchHost[]>([]);
  const [hostId, setHostId] = useState("");
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [firmwareDigest, setFirmwareDigest] = useState<string | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [requirementId, setRequirementId] = useState("");
  const [target, setTarget] = useState("");
  const [deployment, setDeployment] = useState({
    productType: "",
    networkExposure: "",
    regulatory: "",
    deploymentNotes: "",
    rootComponentName: "",
    rootComponentType: "",
  });

  const refreshHosts = useCallback(async () => {
    setLoadingHosts(true);
    try {
      const page = await rpc.call("benchHostsList", { pageSize: 200, continuation: null });
      setHosts(page.items);
      setPreflightError(page.cache.message);
    } catch (cause) {
      setPreflightError(cause instanceof Error ? cause.message : "Bench hosts could not be listed.");
    } finally {
      setLoadingHosts(false);
    }
  }, [rpc]);

  useEffect(() => {
    void refreshHosts();
    void rpc.call("firmwareMountsList", {
      projectId,
      projectVersionId,
      pageSize: 1,
      continuation: null,
    }).then((page) => {
      const digest = page.items[0]
        ? fieldText(page.items[0].fields, "artifactHash") ?? fieldText(page.items[0].fields, "inputSha256") ?? fieldText(page.items[0].fields, "firmwareDigest")
        : null;
      setFirmwareDigest(digest);
    }).catch((cause: unknown) => {
      setPreflightError(cause instanceof Error ? cause.message : "Firmware preflight failed.");
      setFirmwareDigest(null);
    });
  }, [projectId, projectVersionId, refreshHosts, rpc]);

  const selectedHost = hosts.find((host) => host.id === hostId) ?? null;
  const missingCapabilities = useMemo(() => tier === "tier1" && selectedHost
    ? TIER_1_REQUIREMENTS.filter((capability) => !selectedHost.capabilities.includes(capability))
    : [], [selectedHost, tier]);
  const deploymentComplete = Object.values(deployment).every((value) => value.trim().length > 0);
  const ready = Boolean(
    firmwareDigest &&
    selectedHost?.status === "connected" &&
    (tier === "tier0" || (missingCapabilities.length === 0 && deploymentComplete && requirementId.trim() && target.trim())) &&
    confirmed,
  );
  const hostState = useMemo(() => {
    if (loadingHosts) return "Checking enrolled hosts…";
    if (hosts.length === 0) return "No enrolled bench host is listed by bb.";
    if (!selectedHost) return "Select an enrolled host.";
    if (selectedHost.status !== "connected") return "The selected host-daemon is disconnected.";
    if (missingCapabilities.length > 0) return `Missing Tier 1 prerequisites: ${missingCapabilities.join(", ")}.`;
    return "Host prerequisites passed.";
  }, [hosts.length, loadingHosts, missingCapabilities, selectedHost]);
  const runDisabledReason = useMemo(() => {
    if (submitting) return "The run attempt is being recorded.";
    if (!firmwareDigest) return "A verified firmware digest is required.";
    if (!selectedHost) return "Select an enrolled host.";
    if (selectedHost.status !== "connected") return "The selected host-daemon is disconnected.";
    if (tier === "tier1" && missingCapabilities.length > 0) return `Missing Tier 1 prerequisites: ${missingCapabilities.join(", ")}.`;
    if (tier === "tier1" && !deploymentComplete) return "Complete every Tier 1 deployment field.";
    if (tier === "tier1" && !requirementId.trim()) return "Tier 1 requires a requirement or verdict target.";
    if (tier === "tier1" && !target.trim()) return "Tier 1 requires a CVE and component target.";
    if (!confirmed) return "Confirm the selected version, host, firmware, and scope.";
    return null;
  }, [confirmed, deploymentComplete, firmwareDigest, missingCapabilities, requirementId, selectedHost, submitting, target, tier]);

  const submit = useCallback(async () => {
    if (!ready || submitRef.current) return;
    submitRef.current = true;
    setSubmitting(true);
    setPreflightError(null);
    try {
      const result = await rpc.call("benchRunStart", {
        projectId,
        projectVersionId,
        tier,
        hostId,
        ...(requirementId.trim() ? { requirementId: requirementId.trim() } : {}),
        ...(target.trim() ? { target: target.trim() } : {}),
        ...(tier === "tier1" ? { deploymentContext: deployment } : {}),
      });
      onStarted(result.runId);
      navigate.toThread(result.threadId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The bench run could not be started.";
      const failedRunId = /\[runId: ([A-Za-z0-9][A-Za-z0-9._:-]{0,511})\]$/u.exec(message)?.[1];
      setPreflightError(message);
      if (failedRunId) onFailed?.(failedRunId, message);
      submitRef.current = false;
      setSubmitting(false);
    }
  }, [deployment, hostId, navigate, onFailed, onStarted, projectId, projectVersionId, ready, requirementId, rpc, target, tier]);

  return (
    <div aria-label="Run launcher" className="h-full overflow-auto bg-background p-4 text-foreground">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"><Icon name="Workflow" /></span>
          <div><h2 className="text-lg font-semibold">Launch verification run</h2><p className="mt-1 text-sm text-muted-foreground">Preflight is read-only. Starting creates the native long-lived bb run thread.</p></div>
          <Button className="ml-auto" onClick={onClose} size="sm" variant="ghost">Close</Button>
        </div>
        {preflightError ? <Alert><Icon name="AlertCircle" /><AlertDescription>{preflightError}</AlertDescription></Alert> : null}
        <section className="grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-2">
          <div><Label htmlFor="bench-version">Project version</Label><Input className="mt-1 font-mono" disabled id="bench-version" value={projectVersionId} /></div>
          <div><Label htmlFor="bench-tier">Tier</Label><select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" id="bench-tier" onChange={(event) => setTier(event.target.value === "tier1" ? "tier1" : "tier0")} value={tier}><option value="tier0">Tier 0 · static</option><option value="tier1">Tier 1 · Forge</option></select></div>
          <div className="md:col-span-2"><Label htmlFor="bench-host">Host</Label><select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={loadingHosts} id="bench-host" onChange={(event) => { setHostId(event.target.value); setConfirmed(false); }} value={hostId}><option value="">Select host</option>{hosts.map((host) => <option key={host.id} value={host.id}>{host.name} · {host.status}</option>)}</select><p className="mt-2 text-xs text-muted-foreground">{hostState}</p></div>
          <div><Label htmlFor="bench-requirement">Requirement / verdict target (optional for Tier 0)</Label><Input id="bench-requirement" onChange={(event) => setRequirementId(event.target.value)} value={requirementId} /></div>
          <div><Label htmlFor="bench-target">Target (Tier 1: CVE-ID@component-id)</Label><Input id="bench-target" onChange={(event) => setTarget(event.target.value)} value={target} /></div>
        </section>
        {tier === "tier1" ? (
          <section className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-2">
            <div className="md:col-span-2"><h3 className="text-sm font-semibold">Tier 1 deployment context</h3><p className="mt-1 text-xs text-muted-foreground">All fields are required before Forge execution can be confirmed.</p></div>
            {Object.entries(deployment).map(([key, value]) => <div key={key}><Label htmlFor={`deployment-${key}`}>{key.replace(/[A-Z]/gu, (letter) => ` ${letter.toLowerCase()}`)}</Label><Input id={`deployment-${key}`} onChange={(event) => setDeployment((current) => ({ ...current, [key]: event.target.value }))} value={value} /></div>)}
          </section>
        ) : null}
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Preflight</h3>
          <div className="mt-3 flex flex-wrap gap-2"><Badge variant={firmwareDigest ? "secondary" : "outline"}><Icon name={firmwareDigest ? "CircleCheck" : "AlertTriangle"} />Firmware {firmwareDigest ? firmwareDigest.slice(0, 12) : "unavailable"}</Badge><Badge variant={selectedHost?.status === "connected" ? "secondary" : "outline"}><Icon name={selectedHost?.status === "connected" ? "CircleCheck" : "AlertTriangle"} />host-daemon</Badge>{tier === "tier1" ? <Badge variant={missingCapabilities.length === 0 && selectedHost ? "secondary" : "outline"}><Icon name={missingCapabilities.length === 0 && selectedHost ? "CircleCheck" : "AlertTriangle"} />Forge prerequisites</Badge> : null}</div>
          <label className="mt-4 flex items-start gap-2 text-sm"><input checked={confirmed} className="mt-0.5 size-4 accent-primary" onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><span>I confirm this version, host, firmware digest, and deployment scope are intended for this run.</span></label>
          <Button aria-describedby={runDisabledReason ? "bench-run-disabled-reason" : undefined} className="mt-4" disabled={!ready || submitting} onClick={() => void submit()}><Icon name="Workflow" />{submitting ? "Starting…" : `Start ${tier === "tier0" ? "Tier 0" : "Tier 1"}`}</Button>
          {runDisabledReason ? <p className="mt-2 text-xs text-muted-foreground" id="bench-run-disabled-reason">Run unavailable: {runDisabledReason}</p> : null}
        </section>
        {hosts.length === 0 || !selectedHost ? <HostEnrollment hosts={hosts} loadingHosts={loadingHosts} onRefreshHosts={refreshHosts} /> : null}
      </div>
    </div>
  );
}
