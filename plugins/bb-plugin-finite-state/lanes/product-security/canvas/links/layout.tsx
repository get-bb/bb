import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEdges, useNodes, useReactFlow, type Edge, type Node } from "@xyflow/react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import type { z } from "zod";
import {
  type canvasLinksRpcContract,
  type CanvasLayoutV1,
} from "./schema.js";

type AppRuntime = typeof import("@bb/plugin-sdk/app");
export type CanvasLayoutAppRuntime = Pick<AppRuntime, "useRpc">;
type LayoutLoadResult = z.output<
  (typeof canvasLinksRpcContract)["canvasLayoutLoad"]["output"]
>;

interface LayoutPersistenceState {
  status: "loading" | "ready" | "error" | "conflict";
  message: string | null;
  orphanSlugs: string[];
}

interface CanvasLayoutPersistenceProps {
  appRuntime: CanvasLayoutAppRuntime;
  projectId: string;
}

const CANVAS_LAYOUT_DEBOUNCE_MS = 500;

interface DebouncedLayoutWriteResult {
  outcome: "saved" | "conflict" | "failed";
  sha256?: string;
}

function normalizeLayout(layout: CanvasLayoutV1): CanvasLayoutV1 {
  const nodes: CanvasLayoutV1["nodes"] = {};
  for (const slug of Object.keys(layout.nodes).sort()) {
    const node = layout.nodes[slug];
    if (!node) continue;
    nodes[slug] = {
      x: Math.round(node.x),
      y: Math.round(node.y),
      ...(node.collapsed === true ? { collapsed: true } : {}),
    };
  }
  return { schema: "fs-canvas-layout/v1", project: layout.project, nodes };
}

function layoutsEqual(left: CanvasLayoutV1, right: CanvasLayoutV1): boolean {
  return JSON.stringify(normalizeLayout(left)) === JSON.stringify(normalizeLayout(right));
}

function withoutOrphans(
  layout: CanvasLayoutV1,
  orphanSlugs: readonly string[],
): CanvasLayoutV1 {
  const nodes = { ...layout.nodes };
  for (const slug of orphanSlugs) delete nodes[slug];
  return normalizeLayout({ ...layout, nodes });
}

export class DebouncedLayoutSaver {
  #accepted: CanvasLayoutV1;
  #expectedSha256: string | undefined;
  #pending: CanvasLayoutV1 | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight: Promise<void> | null = null;
  #closed = false;
  #conflicted = false;
  #write: (
    layout: CanvasLayoutV1,
    expectedSha256: string | undefined,
  ) => Promise<DebouncedLayoutWriteResult>;
  #onConflict: () => void;

  constructor(options: {
    initial: CanvasLayoutV1;
    expectedSha256?: string;
    write(
      layout: CanvasLayoutV1,
      expectedSha256: string | undefined,
    ): Promise<DebouncedLayoutWriteResult>;
    onConflict(): void;
  }) {
    this.#accepted = normalizeLayout(options.initial);
    this.#expectedSha256 = options.expectedSha256;
    this.#write = options.write;
    this.#onConflict = options.onConflict;
  }

  schedule(next: CanvasLayoutV1, force = false): boolean {
    if (this.#closed || this.#conflicted) return false;
    const normalized = normalizeLayout(next);
    const comparison = this.#pending ?? this.#accepted;
    if (!force && layoutsEqual(comparison, normalized)) return false;
    this.#pending = normalized;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, CANVAS_LAYOUT_DEBOUNCE_MS);
    return true;
  }

  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#closed || this.#conflicted) return;
    if (this.#inFlight) {
      await this.#inFlight;
      if (this.#pending) await this.flush();
      return;
    }
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    const commit = async () => {
      const result = await this.#write(pending, this.#expectedSha256);
      if (this.#closed) return;
      if (result.outcome === "conflict") {
        this.#conflicted = true;
        this.#pending = null;
        this.#onConflict();
        return;
      }
      if (result.outcome === "failed") return;
      this.#accepted = pending;
      this.#expectedSha256 = result.sha256;
    };
    const inFlight = commit();
    this.#inFlight = inFlight;
    try {
      await inFlight;
    } finally {
      if (this.#inFlight === inFlight) this.#inFlight = null;
    }
  }

  dispose(): void {
    this.#closed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending = null;
  }
}

function safeLayoutMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 300)
    : "The shared canvas layout could not be loaded.";
}

function roundedNodePosition(node: Node): CanvasLayoutV1["nodes"][string] {
  const collapsed = Reflect.get(node.data, "collapsed") === true;
  return {
    x: Math.round(node.position.x),
    y: Math.round(node.position.y),
    ...(collapsed ? { collapsed: true } : {}),
  };
}

function nodeDimensions(node: Node): { width: number; height: number } {
  return {
    width: node.measured?.width ?? node.width ?? 216,
    height: node.measured?.height ?? node.height ?? 112,
  };
}

export function CanvasLayoutPersistence({
  appRuntime,
  projectId,
}: CanvasLayoutPersistenceProps): React.JSX.Element | null {
  const rpc = appRuntime.useRpc<typeof canvasLinksRpcContract>();
  const nodes = useNodes<Node>();
  const edges = useEdges<Edge>();
  const { setNodes } = useReactFlow<Node, Edge>();
  const [reloadRevision, setReloadRevision] = useState(0);
  const [state, setState] = useState<LayoutPersistenceState>({
    status: "loading",
    message: null,
    orphanSlugs: [],
  });
  const saverRef = useRef<DebouncedLayoutSaver | null>(null);
  const baseLayoutRef = useRef<CanvasLayoutV1 | null>(null);
  const pendingPruneRef = useRef(false);
  const requestRef = useRef(0);

  const discoverySignature = useMemo(
    () =>
      JSON.stringify({
        nodes: nodes.map((node) => ({ id: node.id, ...nodeDimensions(node) })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        })),
      }),
    [edges, nodes],
  );
  const discovered = useMemo(
    () => ({
      nodes: nodes.map((node) => ({ id: node.id, ...nodeDimensions(node) })),
      edges: edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
      })),
    }),
    // The primitive signature intentionally excludes positions and selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [discoverySignature],
  );
  const positionSignature = useMemo(
    () =>
      JSON.stringify(
        nodes.map((node) => ({ id: node.id, ...roundedNodePosition(node) })),
      ),
    [nodes],
  );

  const reload = useCallback(() => {
    saverRef.current?.dispose();
    saverRef.current = null;
    baseLayoutRef.current = null;
    pendingPruneRef.current = false;
    setReloadRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    const requestId = ++requestRef.current;
    saverRef.current?.dispose();
    saverRef.current = null;
    baseLayoutRef.current = null;
    setState({ status: "loading", message: null, orphanSlugs: [] });

    void rpc
      .call("canvasLayoutLoad", {
        projectId,
        projectVersionId: null,
        nodes: discovered.nodes.map((node) => ({
          slug: node.id,
          width: node.width,
          height: node.height,
        })),
        edges: discovered.edges,
      })
      .then((result: LayoutLoadResult) => {
        if (requestRef.current !== requestId) return;
        baseLayoutRef.current = result.layout;
        setNodes((current) =>
          current.map((node) => {
            const stored = result.layout.nodes[node.id];
            return stored
              ? {
                  ...node,
                  position: { x: stored.x, y: stored.y },
                  data: {
                    ...node.data,
                    ...(stored.collapsed === true ? { collapsed: true } : {}),
                  },
                }
              : node;
          }),
        );
        const saver = new DebouncedLayoutSaver({
          initial: result.layout,
          ...(result.sha256 ? { expectedSha256: result.sha256 } : {}),
          async write(layout, expectedSha256) {
            let saved: z.output<
              (typeof canvasLinksRpcContract)["canvasLayoutSave"]["output"]
            >;
            try {
              saved = await rpc.call("canvasLayoutSave", {
                projectId,
                projectVersionId: null,
                layout,
                expectedSha256: expectedSha256 ?? null,
              });
            } catch (error) {
              setState((current) => ({
                ...current,
                status: "error",
                message: safeLayoutMessage(error),
              }));
              return { outcome: "failed" };
            }
            if (saved.outcome === "conflict") return { outcome: "conflict" };
            baseLayoutRef.current = layout;
            setState((current) => ({
              ...current,
              status: "ready",
              message: null,
              orphanSlugs: pendingPruneRef.current
                ? []
                : current.orphanSlugs,
            }));
            pendingPruneRef.current = false;
            return { outcome: "saved", sha256: saved.sha256 };
          },
          onConflict() {
            setState((current) => ({
              ...current,
              status: "conflict",
              message:
                "Canvas layout changed outside this session. Reload and compare; newer bytes were not overwritten.",
            }));
          },
        });
        saverRef.current = saver;
        setState({
          status: "ready",
          message: null,
          orphanSlugs: result.orphanSlugs,
        });
        if (result.needsSave) saver.schedule(result.layout, true);
      })
      .catch((error: unknown) => {
        if (requestRef.current !== requestId) return;
        setState({
          status: "error",
          message: safeLayoutMessage(error),
          orphanSlugs: [],
        });
      });

    return () => {
      if (requestRef.current === requestId) requestRef.current += 1;
      saverRef.current?.dispose();
      saverRef.current = null;
    };
  }, [discovered, projectId, reloadRevision, rpc, setNodes]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const base = baseLayoutRef.current;
    const saver = saverRef.current;
    if (!base || !saver) return;
    const nextNodes = { ...base.nodes };
    for (const node of nodes) nextNodes[node.id] = roundedNodePosition(node);
    const next: CanvasLayoutV1 = { ...base, nodes: nextNodes };
    try {
      if (saver.schedule(next)) baseLayoutRef.current = next;
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        message: safeLayoutMessage(error),
      }));
    }
  }, [nodes, positionSignature, state.status]);

  const pruneOrphans = useCallback(() => {
    const base = baseLayoutRef.current;
    const saver = saverRef.current;
    if (!base || !saver || state.orphanSlugs.length === 0) return;
    const pruned = withoutOrphans(base, state.orphanSlugs);
    if (!saver.schedule(pruned, true)) return;
    pendingPruneRef.current = true;
    baseLayoutRef.current = pruned;
  }, [state.orphanSlugs]);

  if (
    state.status === "ready" &&
    state.orphanSlugs.length === 0
  ) {
    return null;
  }
  return (
    <section
      aria-label="Canvas layout status"
      className="border-t border-border px-4 py-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          name={state.status === "conflict" ? "AlertTriangle" : "GridView"}
        />
        <div className="min-w-0">
          {state.status === "loading" ? (
            <p className="text-muted-foreground" role="status">
              Loading shared canvas layout…
            </p>
          ) : null}
          {state.message ? <p role="alert">{state.message}</p> : null}
          {state.orphanSlugs.length > 0 ? (
            <>
              <p className="text-muted-foreground">
                {state.orphanSlugs.length} stored orphan position
                {state.orphanSlugs.length === 1 ? " is" : "s are"} retained.
                Prune explicitly after comparing the model revision.
              </p>
              {state.status === "ready" ? (
                <Button
                  className="mt-2"
                  onClick={pruneOrphans}
                  size="sm"
                  variant="outline"
                >
                  Prune retained positions
                </Button>
              ) : null}
            </>
          ) : null}
          {state.status === "conflict" || state.status === "error" ? (
            <Button className="mt-2" onClick={reload} size="sm" variant="outline">
              <Icon aria-hidden="true" className="size-4" name="RotateCcw" />
              Reload and compare
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
