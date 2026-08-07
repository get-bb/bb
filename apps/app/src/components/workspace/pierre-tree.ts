export interface ProgressiveTreeRow {
  isExpanded: boolean;
  kind: "directory" | "file";
  path: string;
}

interface ProgressiveTreeBatchOperation {
  path: string;
  type: "add";
}

export interface ProgressiveTreeModel {
  batch: (operations: readonly ProgressiveTreeBatchOperation[]) => void;
  getVisibleCount: () => number;
  getVisibleRows: (start: number, end: number) => readonly ProgressiveTreeRow[];
  subscribe: (listener: () => void) => () => void;
}

export interface ProgressiveTreeAdapter {
  appendPaths: (paths: readonly string[]) => void;
  dispose: () => void;
  markDirectoryResolved: (path: string) => void;
  releaseDirectoryRequest: (path: string) => void;
  reset: () => void;
}

function asDirectoryPath(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

export function createProgressiveTreeAdapter(
  model: ProgressiveTreeModel,
  requestChildren: (path: string) => void,
): ProgressiveTreeAdapter {
  const knownPaths = new Set<string>();
  const requestedDirectories = new Set<string>();
  const resolvedDirectories = new Set<string>();

  const inspectExpandedDirectories = () => {
    const rows = model.getVisibleRows(0, model.getVisibleCount());
    for (const row of rows) {
      if (row.kind !== "directory" || !row.isExpanded) continue;
      const path = asDirectoryPath(row.path);
      if (resolvedDirectories.has(path) || requestedDirectories.has(path)) {
        continue;
      }
      requestedDirectories.add(path);
      requestChildren(path);
    }
  };

  const unsubscribe = model.subscribe(inspectExpandedDirectories);

  return {
    appendPaths: (paths) => {
      const operations: ProgressiveTreeBatchOperation[] = [];
      for (const path of paths) {
        if (knownPaths.has(path)) continue;
        knownPaths.add(path);
        operations.push({ path, type: "add" });
      }
      if (operations.length > 0) model.batch(operations);
    },
    dispose: unsubscribe,
    markDirectoryResolved: (path) => {
      resolvedDirectories.add(asDirectoryPath(path));
    },
    releaseDirectoryRequest: (path) => {
      requestedDirectories.delete(asDirectoryPath(path));
      inspectExpandedDirectories();
    },
    reset: () => {
      knownPaths.clear();
      requestedDirectories.clear();
      resolvedDirectories.clear();
    },
  };
}
