import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { PendingChangesChip } from "../../sync/ui/PendingChangesChip.js";
import type { FindingSelection } from "./route.js";

function scopeValue(platformProjectId: string, projectVersionId: string): string {
  return `${encodeURIComponent(platformProjectId)}/${encodeURIComponent(projectVersionId)}`;
}

export function FindingsHeader({ projects, projectId, versions, platformProjectId, projectVersionId, total, loaded, selection, onProject, onVersion, onSelectPage, onSelectPredicate, onClearSelection }: {
  projects: readonly { id: string; name: string }[];
  projectId: string | null;
  versions: readonly { platformProjectId: string; projectVersionId: string; state: "fresh" | "stale" }[];
  platformProjectId: string | null;
  projectVersionId: string | null;
  total: number;
  loaded: number;
  selection: FindingSelection;
  onProject(id: string): void;
  onVersion(platformProjectId: string, projectVersionId: string): void;
  onSelectPage(): void;
  onSelectPredicate(): void;
  onClearSelection(): void;
}): React.JSX.Element {
  const selected = selection.mode === "explicit" ? selection.keys.size : selection.total - selection.excluded.size;
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <div className="mr-2 flex items-center gap-2"><Icon aria-hidden="true" className="size-5 text-primary" name="AlertTriangle" /><div><h1 className="text-sm font-semibold">Findings</h1><p className="text-xs text-muted-foreground">Accepted local cache</p></div></div>
      <select aria-label="Findings project" className="h-8 max-w-52 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={event => onProject(event.target.value)} value={projectId ?? ""}>
        <option value="">Select project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <select aria-label="Findings project version" className="h-8 max-w-64 rounded-md border border-input bg-background px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={!projectId} onChange={event => {
        const version = versions.find(candidate => scopeValue(candidate.platformProjectId, candidate.projectVersionId) === event.target.value);
        onVersion(version?.platformProjectId ?? "", version?.projectVersionId ?? "");
      }} value={platformProjectId && projectVersionId ? scopeValue(platformProjectId, projectVersionId) : ""}>
        <option value="">Select cached version</option>{versions.map(version => <option key={scopeValue(version.platformProjectId, version.projectVersionId)} value={scopeValue(version.platformProjectId, version.projectVersionId)}>{version.platformProjectId} / {version.projectVersionId}{version.state === "stale" ? " · stale" : ""}</option>)}
      </select>
      <Badge variant="outline">{loaded.toLocaleString()} loaded / {total.toLocaleString()}</Badge>
      {selected > 0 ? <Badge aria-label={`${selected} findings selected`} variant="secondary">{selected.toLocaleString()} selected</Badge> : null}
      <div className="ml-auto flex items-center gap-1">
        <Button disabled={loaded === 0} onClick={onSelectPage} size="sm" variant="ghost">Select page</Button>
        <Button disabled={total === 0} onClick={onSelectPredicate} size="sm" variant="ghost">Select all {total.toLocaleString()}</Button>
        <Button disabled={selected === 0} onClick={onClearSelection} size="sm" variant="ghost">Clear selection</Button>
        {platformProjectId && projectVersionId ? (
          <PendingChangesChip
            scope={{ projectId: platformProjectId, pvId: projectVersionId }}
            surface="vexDecision"
          />
        ) : null}
      </div>
    </header>
  );
}
