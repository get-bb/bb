import { useEffect, useState } from "react";
import {
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import type { RpcContract } from "../../../shared/contract.js";
import type { findingsUiRpcContract } from "../../findings/rpc.js";
import { RunDetail } from "./run-detail.js";
import { RunLauncher } from "./run-launcher.js";
import { RunTimeline, type BenchRunListItem } from "./run-timeline.js";
import { VerdictCard } from "./verdict-card.js";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;

function routeRunId(subPath: string): string | null {
  const value = subPath.startsWith("bench/") ? subPath.slice(6) : subPath;
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    return RUN_ID.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function BenchPanel({ subPath }: PluginNavPanelProps): React.JSX.Element {
  const { projectId: routeProjectId } = useBbContext();
  const sidebar = experimental_useSidebarThreads();
  const navigate = useBbNavigate();
  const rpc = useRpc<RpcContract & typeof findingsUiRpcContract>();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectVersionId, setProjectVersionId] = useState("");
  const [versions, setVersions] = useState<Array<{ platformProjectId: string; projectVersionId: string; state: "fresh" | "stale" }>>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [launcherTier, setLauncherTier] = useState<"tier0" | "tier1" | null>(null);
  const projectId = routeProjectId ?? selectedProjectId;
  const runId = routeRunId(subPath);
  const invalidRoute = subPath.length > 0 && runId === null;
  const runDisabledReason = !projectId
    ? "Select a project."
    : versionsLoading
      ? "Cached versions are loading."
      : !projectVersionId
        ? versions.length === 0
          ? "No accepted cached version is available. Pull a version through Sync first."
          : "Select a cached version."
        : null;

  useEffect(() => {
    if (!projectId) {
      setVersions([]);
      setProjectVersionId("");
      setVersionsError(null);
      return;
    }
    let active = true;
    setVersionsLoading(true);
    setVersionsError(null);
    void rpc.call("cachedProjectVersions", { projectId }).then((result) => {
      if (!active) return;
      setVersions(result.versions);
      const selected = result.versions.find((version) => version.projectVersionId === result.selectedProjectVersionId) ?? result.versions[0];
      setProjectVersionId(selected?.projectVersionId ?? "");
    }).catch((cause: unknown) => {
      if (!active) return;
      setVersions([]);
      setProjectVersionId("");
      setVersionsError(cause instanceof Error ? cause.message : "Cached versions could not be loaded.");
    }).finally(() => { if (active) setVersionsLoading(false); });
    return () => { active = false; };
  }, [projectId, rpc]);

  const openRun = (run: BenchRunListItem) => {
    navigate.toPluginPanel("bench", { subPath: encodeURIComponent(run.id) });
  };
  const clearRunRoute = () => {
    if (runId) navigate.toPluginPanel("bench", { subPath: "", replace: true });
  };
  const header = (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      <Icon className="text-muted-foreground" name="ChartColumn" />
      <h1 className="text-sm font-semibold">Verification Bench</h1>
      <label className="ml-auto text-xs font-medium text-muted-foreground" htmlFor="bench-project">Project</label>
      <select className="h-8 max-w-52 rounded-md border border-input bg-background px-2 text-xs" disabled={Boolean(routeProjectId) || sidebar.status === "loading"} id="bench-project" onChange={(event) => { clearRunRoute(); setSelectedProjectId(event.target.value || null); setProjectVersionId(""); setVersions([]); }} value={projectId ?? ""}>
        <option value="">Select project</option>
        {sidebar.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <label className="text-xs font-medium text-muted-foreground" htmlFor="bench-project-version">Version</label>
      <select aria-label="Bench project version" className="h-8 max-w-64 rounded-md border border-input bg-background px-2 font-mono text-xs" disabled={!projectId || versionsLoading} id="bench-project-version" onChange={(event) => { clearRunRoute(); setProjectVersionId(event.target.value); }} value={projectVersionId}>
        <option value="">{versionsLoading ? "Loading cached versions…" : "Select cached version"}</option>
        {versions.map((version) => <option key={`${version.platformProjectId}/${version.projectVersionId}`} value={version.projectVersionId}>{version.platformProjectId} / {version.projectVersionId}{version.state === "stale" ? " · stale" : ""}</option>)}
      </select>
      <Button aria-describedby={runDisabledReason ? "bench-header-run-reason" : undefined} disabled={runDisabledReason !== null} onClick={() => setLauncherTier("tier0")} size="sm"><Icon name="Workflow" />Run</Button>
      {runDisabledReason ? <span className="max-w-56 text-xs text-muted-foreground" id="bench-header-run-reason">{runDisabledReason}</span> : null}
    </header>
  );

  if (!projectId) {
    return (
      <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
        {header}
        <div className="flex min-h-0 flex-1 items-center justify-center p-6"><div className="max-w-md rounded-lg border border-border bg-card p-6 text-center"><Icon className="mx-auto size-6 text-muted-foreground" name="ChartColumn" /><h2 className="mt-3 text-lg font-semibold">Choose a project</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">The bench timeline is scoped to a bb project. Choose one above; an explicit Finite State version narrows the history and is required to launch.</p></div></div>
      </section>
    );
  }
  if (invalidRoute) {
    return (
      <section className="flex h-full min-h-0 flex-col bg-background text-foreground">{header}<div className="flex flex-1 items-center justify-center p-6"><div className="max-w-md rounded-lg border border-border bg-card p-6 text-center"><Icon className="mx-auto size-6 text-destructive" name="AlertCircle" /><h2 className="mt-3 text-lg font-semibold">Invalid bench run route</h2><p className="mt-2 text-sm text-muted-foreground">No request was sent for this unbounded run identifier.</p><Button className="mt-4" onClick={() => navigate.toPluginPanel("bench", { subPath: "", replace: true })} variant="outline">Return to timeline</Button></div></div></section>
    );
  }
  if (launcherTier) {
    return (
      <section className="flex h-full min-h-0 flex-col">{header}{projectVersionId.trim() ? <div className="min-h-0 flex-1"><RunLauncher initialTier={launcherTier} onClose={() => setLauncherTier(null)} onFailed={(failedRunId) => { setLauncherTier(null); navigate.toPluginPanel("bench", { subPath: encodeURIComponent(failedRunId) }); }} onStarted={(startedRunId) => navigate.toPluginPanel("bench", { subPath: encodeURIComponent(startedRunId) })} projectId={projectId} projectVersionId={projectVersionId.trim()} /></div> : null}</section>
    );
  }
  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {header}
      {versionsError ? <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-xs" role="status"><Icon name="AlertTriangle" />Cached versions unavailable: {versionsError}</div> : null}
      <div className="grid min-h-0 flex-1 grid-cols-12">
        <div className={`${runId ? "col-span-5" : "col-span-7"} min-h-0 border-r border-border`}>
          <RunTimeline onOpen={openRun} onRunTier0={() => setLauncherTier("tier0")} projectId={projectId} projectVersionId={projectVersionId.trim() || null} runDisabledReason={runDisabledReason} selectedRunId={runId} />
        </div>
        {runId ? <div className="col-span-7 min-h-0"><RunDetail projectId={projectId} projectVersionId={projectVersionId.trim() || null} runId={runId} /></div> : <aside aria-label="Bench verdict summary" className="col-span-5 min-h-0 overflow-auto p-4"><VerdictCard id={projectVersionId || undefined} projectId={projectId} /></aside>}
      </div>
    </section>
  );
}
