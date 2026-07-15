// OWNER: board-view worker. This file is a placeholder created by the app-shell
// worker (T3.1). Replace its contents with the real kanban board; the shell
// only depends on the exported `BoardView` name and its props.

export interface BoardViewProps {
  projectId: string;
}

export function BoardView({ projectId }: BoardViewProps) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      Board view coming soon · projectId={projectId}
    </div>
  );
}
