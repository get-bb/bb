// OWNER: detail-view worker. This file is a placeholder created by the
// app-shell worker (T3.1). Replace its contents with the real task detail
// page; the shell only depends on the exported `DetailView` name and its
// props.

export interface DetailViewProps {
  /** Task key like TSK-4 (not the ULID). */
  taskKey: string;
}

export function DetailView({ taskKey }: DetailViewProps) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      Task detail coming soon · taskKey={taskKey}
    </div>
  );
}
