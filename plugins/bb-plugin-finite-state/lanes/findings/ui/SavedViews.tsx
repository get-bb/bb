import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { FINDING_COLUMNS } from "./columns.js";
import type { FindingsFilter, SavedFindingView } from "./route.js";

export function SavedViews({ views, activeId, filter, columns, loading, error, recoveredFromCorrupt, onOpen, onCreate, onRename, onDelete, onColumns }: {
  views: readonly SavedFindingView[];
  activeId?: string;
  filter: FindingsFilter;
  columns: readonly string[];
  loading: boolean;
  error: string | null;
  recoveredFromCorrupt: boolean;
  onOpen(id: string): void;
  onCreate(name: string, filter: FindingsFilter, columns: readonly string[]): Promise<void>;
  onRename(id: string, name: string): Promise<void>;
  onDelete(id: string): Promise<void>;
  onColumns(columns: string[]): void;
}): React.JSX.Element {
  const active = views.find(view => view.id === activeId);
  const [name, setName] = useState(active?.builtIn ? "" : active?.name ?? "");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <select aria-label="Saved finding view" className="h-8 max-w-56 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={loading} onChange={event => event.target.value && onOpen(event.target.value)} value={activeId ?? ""}>
        <option value="">Saved views</option>
        <optgroup label="Built in">{views.filter(view => view.builtIn).map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</optgroup>
        {views.some(view => !view.builtIn) ? <optgroup label="Workspace">{views.filter(view => !view.builtIn).map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</optgroup> : null}
      </select>
      <Input aria-label={active && !active.builtIn ? "Rename saved view" : "New saved view name"} className="h-8 w-44 text-xs" onChange={event => setName(event.target.value)} placeholder="View name" value={name} />
      {active && !active.builtIn ? (
        <>
          <Button disabled={!name.trim()} onClick={() => onRename(active.id, name)} size="sm" variant="outline"><Icon aria-hidden="true" className="size-4" name="Edit" />Rename</Button>
          <Button onClick={() => onDelete(active.id)} size="sm" variant="ghost"><Icon aria-hidden="true" className="size-4" name="Trash2" />Delete</Button>
        </>
      ) : (
        <Button disabled={!name.trim()} onClick={async () => { await onCreate(name, filter, columns); setName(""); }} size="sm" variant="outline"><Icon aria-hidden="true" className="size-4" name="Plus" />Save current</Button>
      )}
      <div aria-label="Visible finding columns" className="flex flex-wrap items-center gap-2 border-l border-border pl-2" role="group">
        <span className="text-xs text-muted-foreground">Columns</span>
        {FINDING_COLUMNS.map(column => {
          const checked = columns.includes(column);
          return <label className="flex items-center gap-1 text-xs capitalize" key={column}><Checkbox checked={checked} onCheckedChange={next => {
            const updated = next === true ? [...columns, column] : columns.filter(item => item !== column);
            if (updated.length > 0) onColumns([...new Set(updated)]);
          }} />{column}</label>;
        })}
      </div>
      <span className="ml-auto text-xs text-muted-foreground">{recoveredFromCorrupt ? "Corrupt views quarantined; defaults restored." : error}</span>
    </div>
  );
}
