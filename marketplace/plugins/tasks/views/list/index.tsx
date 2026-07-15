// OWNER: list-view worker. This file is a placeholder created by the app-shell
// worker (T3.1). Replace its contents with the real list view; the shell only
// depends on the exported `ListView` name and its props.

export interface ListViewProps {
  /** null renders the cross-project "All tasks" list. */
  projectId: string | null;
}

export function ListView({ projectId }: ListViewProps) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      List view coming soon · projectId={projectId ?? "all"}
    </div>
  );
}
