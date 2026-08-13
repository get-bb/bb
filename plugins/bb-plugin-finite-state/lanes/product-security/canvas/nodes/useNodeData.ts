import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtime, useRpc } from "@bb/plugin-sdk/app";
import type { z } from "zod";
import type { JsonValue, rpcContract } from "../../../../shared/contract.js";
import {
  buildArchitectureAdjacency,
  toCanvasGraph,
  type ArchitectureAdjacency,
  type ArchitectureEdgeData,
  type ArchitectureInterface,
  type ArchitectureKind,
  type ArchitectureModel,
  type ArchitectureNodeData,
  type CanvasArchitectureGraph,
} from "./adapters.js";

type TaraListInput = z.input<(typeof rpcContract)["taraList"]["input"]>;
type TaraListPage = z.output<(typeof rpcContract)["taraList"]["output"]>;
type TaraListCall = (input: TaraListInput) => Promise<TaraListPage>;

const TARA_KINDS = ["component", "zone", "asset", "dataflow"] as const;
type TaraKind = (typeof TARA_KINDS)[number];

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(
  fields: Record<string, JsonValue>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function booleanValue(
  fields: Record<string, JsonValue>,
  ...keys: string[]
): boolean {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "boolean") return value;
  }
  return false;
}

function numberValue(
  fields: Record<string, JsonValue>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function stringList(
  fields: Record<string, JsonValue>,
  ...keys: string[]
): string[] | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (!Array.isArray(value)) continue;
    const strings = value.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
    if (strings.length > 0) return strings;
  }
  return undefined;
}

function interfacesValue(
  fields: Record<string, JsonValue>,
): ArchitectureInterface[] | undefined {
  const value = fields.interfaces;
  if (!Array.isArray(value)) return undefined;
  const interfaces: ArchitectureInterface[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const name = stringValue(candidate, "name", "slug");
    if (!name) continue;
    const protocol = stringValue(candidate, "protocol");
    const port = numberValue(candidate, "port");
    const direction = stringValue(candidate, "direction");
    interfaces.push({
      name,
      ...(protocol ? { protocol } : {}),
      ...(port !== undefined ? { port } : {}),
      ...(direction ? { direction } : {}),
    });
  }
  return interfaces.length > 0 ? interfaces : undefined;
}

function defaultSourceFile(kind: ArchitectureKind, slug: string): string {
  const folder = kind === "dataflow" ? "dataflows" : `${kind}s`;
  return `product-security/architecture/${folder}/${slug}.yaml`;
}

function toArchitectureNode(
  item: TaraListPage["items"][number],
): ArchitectureNodeData | null {
  if (
    item.kind !== "component" &&
    item.kind !== "zone" &&
    item.kind !== "asset"
  ) {
    return null;
  }
  const fields = item.fields;
  const slug = item.key;
  const componentType = stringValue(
    fields,
    "componentType",
    "component_type",
    "type",
    "category",
  );
  const criticality = stringValue(fields, "criticality", "severity");
  const zone = stringValue(
    fields,
    "zone",
    "zoneSlug",
    "zone_slug",
    "parentZone",
  );
  const interfaces = interfacesValue(fields);
  const description = stringValue(fields, "description", "summary");
  const technologies = stringList(fields, "technologies", "technology");
  const affectedAssets = stringList(
    fields,
    "affectedAssets",
    "affected_assets",
    "assets",
  );
  const threatCount = numberValue(fields, "threatCount", "threat_count");
  const sourceFile =
    stringValue(fields, "sourceFile", "source_file", "file") ??
    defaultSourceFile(item.kind, slug);
  return {
    slug,
    kind: item.kind,
    name: item.label,
    sourceFile,
    ...(componentType ? { componentType } : {}),
    ...(criticality ? { criticality } : {}),
    ...(zone ? { zone } : {}),
    ...(interfaces ? { interfaces } : {}),
    ...(description ? { description } : {}),
    ...(technologies ? { technologies } : {}),
    ...(affectedAssets ? { affectedAssets } : {}),
    ...(threatCount !== undefined ? { threatCount } : {}),
    ...(booleanValue(fields, "isEntryPoint", "is_entry_point")
      ? { isEntryPoint: true }
      : {}),
  };
}

function toArchitectureEdge(
  item: TaraListPage["items"][number],
): ArchitectureEdgeData | null {
  if (item.kind !== "dataflow") return null;
  const fields = item.fields;
  const sourceSlug = stringValue(
    fields,
    "sourceSlug",
    "source_slug",
    "source",
    "sourceKey",
    "sourceComponent",
  );
  const targetSlug = stringValue(
    fields,
    "targetSlug",
    "target_slug",
    "target",
    "targetKey",
    "targetComponent",
  );
  if (!sourceSlug || !targetSlug) return null;
  const direction = stringValue(fields, "direction");
  const protocol = stringValue(fields, "protocol");
  const description = stringValue(fields, "description", "summary");
  const sourceFile =
    stringValue(fields, "sourceFile", "source_file", "file") ??
    defaultSourceFile("dataflow", item.key);
  return {
    slug: item.key,
    sourceSlug,
    targetSlug,
    encrypted: booleanValue(fields, "encrypted", "isEncrypted", "is_encrypted"),
    authenticated: booleanValue(
      fields,
      "authenticated",
      "isAuthenticated",
      "is_authenticated",
    ),
    bidirectional:
      booleanValue(
        fields,
        "bidirectional",
        "isBidirectional",
        "is_bidirectional",
      ) ||
      direction === "bidirectional" ||
      direction === "both",
    sourceFile,
    name: item.label,
    ...(protocol ? { protocol } : {}),
    ...(description ? { description } : {}),
  };
}

async function readKind(
  call: TaraListCall,
  projectId: string,
  kind: TaraKind,
): Promise<TaraListPage[]> {
  const pages: TaraListPage[] = [];
  let continuation: string | null = null;
  do {
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

export interface ArchitectureDataSource {
  read(projectId: string): Promise<ArchitectureModel>;
}

export function createRpcArchitectureDataSource(
  call: TaraListCall,
): ArchitectureDataSource {
  return {
    async read(projectId) {
      const pageGroups = await Promise.all(
        TARA_KINDS.map((kind) => readKind(call, projectId, kind)),
      );
      const nodes = new Map<string, ArchitectureNodeData>();
      const dataflows = new Map<string, ArchitectureEdgeData>();
      const revisions: string[] = [];
      let pulledAt: string | null = null;
      let stale = false;
      for (let kindIndex = 0; kindIndex < pageGroups.length; kindIndex += 1) {
        const kind = TARA_KINDS[kindIndex];
        const pages = pageGroups[kindIndex] ?? [];
        for (const page of pages) {
          stale ||= page.cache.state === "stale";
          if (page.cache.asOf && (!pulledAt || page.cache.asOf > pulledAt)) {
            pulledAt = page.cache.asOf;
          }
          revisions.push(
            `${kind}:${page.cache.acceptedGenerationId ?? "empty"}:${page.cache.baseRevision}`,
          );
          for (const item of page.items) {
            const node = toArchitectureNode(item);
            if (node) nodes.set(node.slug, node);
            const edge = toArchitectureEdge(item);
            if (edge) dataflows.set(edge.slug, edge);
          }
        }
      }
      return {
        revision: `${projectId}:${revisions.join("|")}`,
        nodes: [...nodes.values()],
        dataflows: [...dataflows.values()],
        cache: { pulledAt, stale },
      };
    },
  };
}

export interface DerivedArchitectureData {
  graph: CanvasArchitectureGraph;
  adjacency: Map<string, ArchitectureAdjacency>;
}

type AdjacencyBuilder = typeof buildArchitectureAdjacency;
const derivedCaches = new WeakMap<
  AdjacencyBuilder,
  Map<string, DerivedArchitectureData>
>();

export function deriveArchitectureData(
  model: ArchitectureModel,
  adjacencyBuilder: AdjacencyBuilder = buildArchitectureAdjacency,
): DerivedArchitectureData {
  let cache = derivedCaches.get(adjacencyBuilder);
  if (!cache) {
    cache = new Map();
    derivedCaches.set(adjacencyBuilder, cache);
  }
  const cached = cache.get(model.revision);
  if (cached) return cached;
  const derived = {
    graph: toCanvasGraph(model),
    adjacency: adjacencyBuilder(model),
  };
  cache.set(model.revision, derived);
  if (cache.size > 8) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return derived;
}

export type ArchitectureDataStatus =
  | "unconfigured"
  | "loading"
  | "ready"
  | "error";

export interface ArchitectureDataState {
  status: ArchitectureDataStatus;
  model: ArchitectureModel | null;
  graph: CanvasArchitectureGraph | null;
  adjacency: Map<string, ArchitectureAdjacency> | null;
  error: string | null;
  retry(): void;
}

interface ProjectModel {
  projectId: string;
  model: ArchitectureModel;
}

interface LoadResult {
  projectId: string;
  requestRevision: number;
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

export function useArchitectureData(
  projectId: string | null,
): ArchitectureDataState {
  const rpc = useRpc<typeof rpcContract>();
  const source = useMemo(
    () =>
      createRpcArchitectureDataSource((input) => rpc.call("taraList", input)),
    [rpc],
  );
  const [requestRevision, setRequestRevision] = useState(0);
  const [projectModel, setProjectModel] = useState<ProjectModel | null>(null);
  const [loadResult, setLoadResult] = useState<LoadResult | null>(null);
  const retry = useCallback(
    () => setRequestRevision((current) => current + 1),
    [],
  );

  useRealtime("tara:changed", (payload) => {
    if (projectId && payloadProjectId(payload) === projectId) retry();
  });

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void source
      .read(projectId)
      .then((model) => {
        if (!active) return;
        setProjectModel({ projectId, model });
        setLoadResult({ projectId, requestRevision, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadResult({ projectId, requestRevision, error: safeError(error) });
      });
    return () => {
      active = false;
    };
  }, [projectId, requestRevision, source]);

  const model =
    projectId && projectModel?.projectId === projectId
      ? projectModel.model
      : null;
  const visibleResult =
    projectId &&
    loadResult?.projectId === projectId &&
    loadResult.requestRevision === requestRevision
      ? loadResult
      : null;
  const error = visibleResult?.error ?? null;
  const derived = useMemo(
    () => (model ? deriveArchitectureData(model) : null),
    [model],
  );
  return {
    status: !projectId
      ? "unconfigured"
      : model
        ? "ready"
        : error
          ? "error"
          : "loading",
    model,
    graph: derived?.graph ?? null,
    adjacency: derived?.adjacency ?? null,
    error,
    retry,
  };
}
