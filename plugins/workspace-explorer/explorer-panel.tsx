import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { explorerRpcContract } from "./shared/contract.js";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { fileIconForPath } from "./lib/file-icons.js";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";

type Root = {
  status: "ready";
  environmentId: string;
  environmentName: string | null;
  hostId: string;
  rootPath: string;
};

interface DirectoryNode {
  status: "loading" | "ready" | "error";
  entries: Array<{ kind: "directory" | "file"; name: string; relativePath: string }>;
  error: string | null;
}

type Rpc = ReturnType<typeof useRpc<typeof explorerRpcContract>>;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rootPathLabel(rootPath: string): string {
  const segments = rootPath.split(/[\\/]/u).filter((segment) => segment !== "");
  const base = segments.at(-1);
  return base === undefined ? ` (${rootPath})` : ` / ${base}`;
}

function TreeNodeRow({
  kind,
  name,
  depth,
  expanded,
  onClick,
}: {
  kind: "directory" | "file";
  name: string;
  depth: number;
  expanded: boolean | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={name}
      aria-expanded={kind === "directory" ? (expanded ?? false) : undefined}
      aria-level={depth + 1}
      className="flex h-7 w-full items-center gap-1.5 rounded-md text-left text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:h-9"
      style={{ paddingLeft: `${0.375 + depth * 0.75}rem` }}
      onClick={onClick}
    >
      {kind === "directory" ? (
        <Icon
          name="ChevronDown"
          className={cn(
            "size-3 shrink-0 transition-transform",
            expanded === false && "-rotate-90",
          )}
        />
      ) : (
        <span className="size-3 shrink-0" />
      )}
      {kind === "directory" ? (
        <Icon name="Folder" className="size-3.5 shrink-0" />
      ) : (
        <HugeiconsIcon
          icon={fileIconForPath(name)}
          className="size-3.5 shrink-0"
        />
      )}
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </button>
  );
}

function WorkspaceExplorerContent({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof explorerRpcContract>();
  const navigate = useBbNavigate();
  const [root, setRoot] = useState<Root | "loading" | { error: string } | null>(
    null,
  );
  const [directories, setDirectories] = useState<
    Record<string, DirectoryNode>
  >({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const rootSeqRef = useRef(0);
  const generationRef = useRef(0);
  const listSeqRef = useRef(new Map<string, number>());
  const contextRef = useRef<{ environmentId: string; rootPath: string } | null>(
    null,
  );

  const resetTree = useCallback(() => {
    generationRef.current += 1;
    listSeqRef.current.clear();
    setDirectories({});
    setExpanded(new Set());
  }, []);

  const loadRoot = useCallback(
    async (seq: number) => {
      setRoot("loading");
      try {
        const result = await rpc.call("explorerRoot", { threadId });
        if (rootSeqRef.current !== seq) return;
        if (result.status === "ready") {
          contextRef.current = {
            environmentId: result.environmentId,
            rootPath: result.rootPath,
          };
          setRoot(result);
        } else {
          contextRef.current = null;
          setRoot(null);
        }
      } catch (error) {
        if (rootSeqRef.current !== seq) return;
        setRoot({ error: toMessage(error) });
      }
    },
    [rpc, threadId],
  );

  useEffect(() => {
    const seq = ++rootSeqRef.current;
    contextRef.current = null;
    resetTree();
    void loadRoot(seq);
  }, [loadRoot, resetTree]);

  const handleContextSwitch = useCallback(() => {
    const seq = ++rootSeqRef.current;
    resetTree();
    void loadRoot(seq);
  }, [loadRoot, resetTree]);

  const loadDirectory = useCallback(
    async (relativePath: string) => {
      const generation = generationRef.current;
      const seq = (listSeqRef.current.get(relativePath) ?? 0) + 1;
      listSeqRef.current.set(relativePath, seq);
      setDirectories((current) => ({
        ...current,
        [relativePath]: { status: "loading", entries: [], error: null },
      }));
      try {
        const result = await rpc.call("explorerList", {
          threadId,
          path: relativePath,
        });
        if (generationRef.current !== generation) return;
        if (listSeqRef.current.get(relativePath) !== seq) return;
        const context = contextRef.current;
        if (
          context === null ||
          result.environmentId !== context.environmentId ||
          result.rootPath !== context.rootPath
        ) {
          handleContextSwitch();
          return;
        }
        setDirectories((current) => ({
          ...current,
          [relativePath]: {
            status: "ready",
            entries: [...result.entries].sort((left, right) =>
              left.kind === right.kind
                ? left.name.localeCompare(right.name)
                : left.kind === "directory"
                  ? -1
                  : 1,
            ),
            error: null,
          },
        }));
      } catch (error) {
        if (generationRef.current !== generation) return;
        if (listSeqRef.current.get(relativePath) !== seq) return;
        setDirectories((current) => ({
          ...current,
          [relativePath]: {
            status: "error",
            entries: [],
            error: toMessage(error),
          },
        }));
      }
    },
    [rpc, threadId, handleContextSwitch],
  );

  useEffect(() => {
    if (root === null || root === "loading" || "error" in root) return;
    if (directories[""] === undefined) void loadDirectory("");
  }, [root, directories, loadDirectory]);

  const toggleDirectory = (relativePath: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
    if (
      directories[relativePath] === undefined ||
      directories[relativePath]?.status === "error"
    ) {
      void loadDirectory(relativePath);
    }
  };

  const openFile = (relativePath: string) => {
    const context = contextRef.current;
    if (context === null) return;
    navigate.experimental_openFilePreview({
      target: {
        kind: "workspace",
        environmentId: context.environmentId,
        path: relativePath,
      },
      location: null,
    });
  };

  const refresh = () => {
    handleContextSwitch();
  };

  const renderDirectory = (relativePath: string, depth: number): ReactNode => {
    const node = directories[relativePath];
    if (node === undefined || node.status === "loading") {
      return (
        <div className="px-2 py-1" style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}>
          <Skeleton className="h-4 w-2/3" />
        </div>
      );
    }
    if (node.status === "error") {
      return (
        <div className="flex flex-col items-start gap-1 px-2 py-1 text-xs">
          <span className="text-destructive">Couldn't list: {node.error}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-6"
            onClick={() => void loadDirectory(relativePath)}
          >
            Retry
          </Button>
        </div>
      );
    }
    if (node.entries.length === 0) {
      return (
        <p
          className="px-2 py-1 text-xs text-muted-foreground"
          style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}
        >
          Empty folder
        </p>
      );
    }
    return node.entries.map((entry) => {
      const childPath = entry.relativePath;
      return (
        <div key={childPath}>
          <TreeNodeRow
            kind={entry.kind}
            name={entry.name}
            depth={depth}
            expanded={
              entry.kind === "directory" ? expanded.has(childPath) : undefined
            }
            onClick={() =>
              entry.kind === "directory"
                ? toggleDirectory(childPath)
                : openFile(childPath)
            }
          />
          {entry.kind === "directory" && expanded.has(childPath)
            ? renderDirectory(childPath, depth + 1)
            : null}
        </div>
      );
    });
  };

  if (root === "loading") {
    return (
      <div className="space-y-2 px-2 pt-2">
        {[0, 1, 2].map((index) => (
          <Skeleton className="h-4 w-3/4" key={index} />
        ))}
      </div>
    );
  }

  if (root !== null && "error" in root) {
    return (
      <div className="flex flex-col items-start gap-1.5 px-2 py-2 text-xs">
        <p className="text-destructive">Couldn't load the workspace: {root.error}</p>
        <Button
          variant="outline"
          size="sm"
          className="h-6"
          onClick={() => {
            const seq = ++rootSeqRef.current;
            listSeqRef.current.clear();
            void loadRoot(seq);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (root === null) {
    return (
      <p className="px-2 py-2 text-xs text-muted-foreground">
        This thread has no environment workspace to browse. Threads without an
        environment have no working folder.
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-2 pb-1.5 pt-2">
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={root.rootPath}
        >
          {(root.environmentName ?? "workspace") + rootPathLabel(root.rootPath)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground"
          aria-label="Refresh explorer"
          onClick={refresh}
        >
          <Icon name="RotateCcw" className="size-3" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        {renderDirectory("", 0)}
      </div>
    </div>
  );
}

export function WorkspaceExplorerPanel({ threadId }: PluginThreadPanelProps) {
  return <WorkspaceExplorerContent key={threadId} threadId={threadId} />;
}
