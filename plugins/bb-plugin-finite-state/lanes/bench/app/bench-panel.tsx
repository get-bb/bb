import { useState } from "react";
import {
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { RunDetail } from "./run-detail.js";
import { RunLauncher } from "./run-launcher.js";
import { RunTimeline, type BenchRunListItem } from "./run-timeline.js";

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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectVersionId, setProjectVersionId] = useState("");
  const [launcherTier, setLauncherTier] = useState<"tier0" | "tier1" | null>(null);
  const projectId = routeProjectId ?? selectedProjectId;
  const runId = routeRunId(subPath);
  const invalidRoute = subPath.length > 0 && runId === null;

  const openRun = (run: BenchRunListItem) => {
    navigate.toPluginPanel("bench", { subPath: encodeURIComponent(run.id) });
  };
  const header = (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      <Icon className="text-muted-foreground" name="ChartColumn" />
      <h1 className="text-sm font-semibold">Verification Bench</h1>
      <label className="ml-auto text-xs font-medium text-muted-foreground" htmlFor="bench-project">Project</label>
      <select className="h-8 max-w-52 rounded-md border border-input bg-background px-2 text-xs" disabled={Boolean(routeProjectId) || sidebar.status === "loading"} id="bench-project" onChange={(event) => setSelectedProjectId(event.target.value || null)} value={projectId ?? ""}>
        <option value="">Select project</option>
        {sidebar.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <label className="text-xs font-medium text-muted-foreground" htmlFor="bench-project-version">Version</label>
      <Input aria-label="Bench project version ID" className="h-8 w-48 font-mono text-xs" id="bench-project-version" onChange={(event) => setProjectVersionId(event.target.value)} placeholder="Latest accepted" value={projectVersionId} />
      <Button disabled={!projectId || projectVersionId.trim().length === 0} onClick={() => setLauncherTier("tier0")} size="sm"><Icon name="Workflow" />Run</Button>
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
      <section className="flex h-full min-h-0 flex-col">{header}{projectVersionId.trim() ? <div className="min-h-0 flex-1"><RunLauncher initialTier={launcherTier} onClose={() => setLauncherTier(null)} onStarted={(startedRunId) => navigate.toPluginPanel("bench", { subPath: encodeURIComponent(startedRunId) })} projectId={projectId} projectVersionId={projectVersionId.trim()} /></div> : null}</section>
    );
  }
  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {header}
      <div className={`grid min-h-0 flex-1 ${runId ? "grid-cols-12" : "grid-cols-1"}`}>
        <div className={runId ? "col-span-5 min-h-0 border-r border-border" : "min-h-0"}>
          <RunTimeline onOpen={openRun} onRunTier0={() => setLauncherTier("tier0")} projectId={projectId} projectVersionId={projectVersionId.trim() || null} selectedRunId={runId} />
        </div>
        {runId ? <div className="col-span-7 min-h-0"><RunDetail projectId={projectId} projectVersionId={projectVersionId.trim() || null} runId={runId} /></div> : null}
      </div>
    </section>
  );
}
