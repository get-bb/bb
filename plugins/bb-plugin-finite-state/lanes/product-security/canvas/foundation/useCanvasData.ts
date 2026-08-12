import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtime, useRpc } from "@bb/plugin-sdk/app";
import type { z } from "zod";
import type { JsonValue, rpcContract } from "../../../../shared/contract.js";
import type {
  CanvasDataSource,
  CanvasEdgeModel,
  CanvasModel,
  CanvasNodeKind,
  CanvasNodeModel,
  CanvasTaraKind,
} from "./types.js";

type TaraListInput = z.input<(typeof rpcContract)["taraList"]["input"]>;
type TaraListPage = z.output<(typeof rpcContract)["taraList"]["output"]>;
type TaraListCall = (input: TaraListInput) => Promise<TaraListPage>;

const TARA_KINDS = ["component", "zone", "asset", "dataflow"] as const;

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  fields: Record<string, JsonValue>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function readNumber(
  fields: Record<string, JsonValue>,
  key: string,
  fallback: number,
): number {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function readBoolean(fields: Record<string, JsonValue>, key: string): boolean {
  return fields[key] === true;
}

function toNode(item: TaraListPage["items"][number]): CanvasNodeModel | null {
  if (
    item.kind !== "component" &&
    item.kind !== "zone" &&
    item.kind !== "asset"
  ) {
    return null;
  }

  const kind: CanvasNodeKind = item.kind;
  return {
    id: item.key,
    kind,
    label: item.label,
    width: readNumber(item.fields, "width", 216),
    height: readNumber(item.fields, "height", 112),
    componentType: readString(item.fields, "componentType", "type", "category"),
    criticality: readString(item.fields, "criticality", "severity"),
    isEntryPoint: readBoolean(item.fields, "isEntryPoint"),
  };
}

function toEdge(item: TaraListPage["items"][number]): CanvasEdgeModel | null {
  if (item.kind !== "dataflow") return null;
  const source = readString(
    item.fields,
    "source",
    "sourceKey",
    "sourceComponent",
  );
  const target = readString(
    item.fields,
    "target",
    "targetKey",
    "targetComponent",
  );
  if (!source || !target) return null;
  return {
    id: item.key,
    source,
    target,
    label: item.label,
    protocol: readString(item.fields, "protocol"),
    encrypted: readBoolean(item.fields, "encrypted"),
    authenticated: readBoolean(item.fields, "authenticated"),
  };
}

async function readKind(
  call: TaraListCall,
  projectId: string,
  kind: CanvasTaraKind,
): Promise<TaraListPage[]> {
  const pages: TaraListPage[] = [];
  let continuation: string | null = null;
  do {
    // The frozen pagedScopedInput helper erases extra keys statically. Keeping
    // this as a named value preserves the runtime-validated kind/filters keys
    // without a cast or a second RPC contract.
    const request = {
      projectId,
      projectVersionId: null,
      pageSize: 200,
      continuation,
      kind,
      filters: {},
    };
    const page = await call(request);
    pages.push(page);
    continuation = page.next;
  } while (continuation !== null);
  return pages;
}

export function createRpcCanvasDataSource(
  call: TaraListCall,
): CanvasDataSource {
  return {
    async read(projectId) {
      const pageGroups = await Promise.all(
        TARA_KINDS.map((kind) => readKind(call, projectId, kind)),
      );
      const nodes = new Map<string, CanvasNodeModel>();
      const edges = new Map<string, CanvasEdgeModel>();
      let pulledAt: string | null = null;
      let stale = false;

      for (const pages of pageGroups) {
        for (const page of pages) {
          stale ||= page.cache.state === "stale";
          if (page.cache.asOf && (!pulledAt || page.cache.asOf > pulledAt)) {
            pulledAt = page.cache.asOf;
          }
          for (const item of page.items) {
            if (!isRecord(item.fields)) continue;
            const node = toNode(item);
            if (node) nodes.set(node.id, node);
            const edge = toEdge(item);
            if (edge) edges.set(edge.id, edge);
          }
        }
      }

      return {
        nodes: [...nodes.values()],
        edges: [...edges.values()],
        cache: { pulledAt, stale },
      };
    },
    subscribe() {
      return () => undefined;
    },
  };
}

export type CanvasDataStatus = "unconfigured" | "loading" | "ready" | "error";

export interface CanvasDataState {
  status: CanvasDataStatus;
  model: CanvasModel | null;
  error: string | null;
  retry(): void;
}

interface ProjectCanvasModel {
  projectId: string;
  model: CanvasModel;
}

interface CanvasLoadResult {
  projectId: string;
  revision: number;
  error: string | null;
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 300)
    : "The local product-security model could not be read.";
}

function payloadProjectId(payload: unknown): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const projectId = Reflect.get(payload, "projectId");
  return typeof projectId === "string" ? projectId : null;
}

export function useCanvasData(projectId: string | null): CanvasDataState {
  const rpc = useRpc<typeof rpcContract>();
  const source = useMemo(
    () => createRpcCanvasDataSource((input) => rpc.call("taraList", input)),
    [rpc],
  );
  const [revision, setRevision] = useState(0);
  const [projectModel, setProjectModel] = useState<ProjectCanvasModel | null>(
    null,
  );
  const [loadResult, setLoadResult] = useState<CanvasLoadResult | null>(null);

  const retry = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  useRealtime("tara:changed", (payload) => {
    if (projectId && payloadProjectId(payload) === projectId) retry();
  });

  useEffect(() => {
    if (!projectId) return;

    let active = true;
    const unsubscribe = source.subscribe(retry);
    void source
      .read(projectId)
      .then((nextModel) => {
        if (!active) return;
        const nextProjectModel = { projectId, model: nextModel };
        setProjectModel(nextProjectModel);
        setLoadResult({ projectId, revision, error: null });
      })
      .catch((nextError: unknown) => {
        if (!active) return;
        setLoadResult({ projectId, revision, error: safeError(nextError) });
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [projectId, retry, revision, source]);

  const visibleModel =
    projectId && projectModel?.projectId === projectId
      ? projectModel.model
      : null;
  const visibleResult =
    projectId &&
    loadResult?.projectId === projectId &&
    loadResult.revision === revision
      ? loadResult
      : null;
  const error = visibleResult?.error ?? null;
  const status: CanvasDataStatus = !projectId
    ? "unconfigured"
    : visibleModel
      ? "ready"
      : error
        ? "error"
        : "loading";
  return {
    status,
    model: visibleModel,
    error,
    retry,
  };
}
