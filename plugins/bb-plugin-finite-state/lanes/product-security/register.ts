import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { JsonValue } from "../../shared/contract.js";
import { jsonValueSchema, rpcContract } from "../../shared/contract.js";
import type { PluginContext } from "../../lib/context.js";
import { toStorageProjectVersionId } from "../../lib/store/index.js";
import { registerCanvasEditingBackend } from "./canvas/editing/backend.js";
import { registerCanvasLinksBackend } from "./canvas/links/backend.js";
import { registerCanvasNodesBackend } from "./canvas/nodes/backend.js";
import { registerThreatOverlayBackend } from "./canvas/threat-overlay/backend.js";
import type { CanvasTaraKind } from "./canvas/foundation/types.js";
import {
  architectureEntityPayload,
  type CanvasEntityKind,
} from "./canvas/editing/schema.js";
import {
  canvasDeletedMarkerPrefix,
  createSdkCanvasFileStore,
  type CanvasProjectSource,
  type StoredCanvasEntity,
} from "./canvas/editing/writer.js";
import { registerRequirementsCardsBackend } from "./requirements/cards/backend.js";
import { registerRequirementsConversionBackend } from "./requirements/conversion/backend.js";
import { registerRequirementsTraceabilityBackend } from "./requirements/traceability/backend.js";
import { registerVerificationMatrixBackend } from "./verifications/matrix/backend.js";
import { registerVerificationRunDetailBackend } from "./verifications/run-detail/backend.js";

const productSecurityRpcContract = { taraList: rpcContract.taraList } as const;
interface TaraSyncRow {
  accepted_generation_id: string | null;
  base_revision: number;
  last_pull: string | null;
  error: string | null;
}

interface TaraSnapshotRow {
  entity_key: string;
  payload: string;
}

type TaraKind = CanvasTaraKind | "threat";

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanvasTaraKind(value: unknown): value is TaraKind {
  return (
    value === "component" ||
    value === "zone" ||
    value === "asset" ||
    value === "dataflow" ||
    value === "threat"
  );
}

function readTaraKind(value: unknown): TaraKind {
  if (!isUnknownRecord(value)) throw new Error("TARA list input is invalid");
  const kind = value.kind;
  if (!isCanvasTaraKind(kind)) {
    throw new Error("TARA list kind is invalid");
  }
  return kind;
}

function assertFoundationFilters(value: unknown): void {
  if (!isUnknownRecord(value)) throw new Error("TARA list input is invalid");
  const filters = value.filters;
  if (!isUnknownRecord(filters))
    throw new Error("TARA list filters are invalid");
  if (Object.keys(filters).length > 0) {
    throw new Error("TARA filters are not available in the WP-31 foundation");
  }
}

function isJsonRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePayload(payload: string): Record<string, JsonValue> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    throw new Error("Cached TARA payload is not valid JSON");
  }
  const parsed = jsonValueSchema.parse(decoded);
  if (!isJsonRecord(parsed)) {
    throw new Error("Cached TARA payload must be an object");
  }
  return parsed;
}

function payloadLabel(
  payload: Record<string, JsonValue>,
  fallback: string,
): string {
  for (const key of ["label", "name", "title", "slug"]) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return fallback;
}

function decodeContinuation(continuation: string | null): string {
  if (!continuation) return "";
  try {
    const decoded = Buffer.from(continuation, "base64url").toString("utf8");
    if (decoded.length === 0 || decoded.length > 512) {
      throw new Error("invalid length");
    }
    return decoded;
  } catch {
    throw new Error("TARA continuation token is invalid");
  }
}

function encodeContinuation(entityKey: string): string {
  return Buffer.from(entityKey, "utf8").toString("base64url");
}

function emptyCache(baseRevision = 0) {
  return {
    state: "empty" as const,
    asOf: null,
    message: "No accepted product-security cache is available.",
    acceptedGenerationId: null,
    baseRevision,
  };
}

async function projectSource(
  bb: BbPluginApi,
  projectId: string,
): Promise<CanvasProjectSource> {
  const project = await bb.sdk.projects.get({ projectId });
  const source =
    project.sources.find((candidate) => candidate.isDefault) ??
    project.sources[0];
  if (!source) throw new Error("The project has no local workspace source.");
  return { hostId: source.hostId, path: source.path };
}

function isMissingDirectory(error: unknown): boolean {
  return /\bENOENT\b|not found|does not exist/iu.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function workingDirectoryExists(
  bb: BbPluginApi,
  source: CanvasProjectSource,
  kind: CanvasEntityKind,
): Promise<boolean> {
  try {
    await bb.sdk.files.list({
      hostId: source.hostId,
      path: `${source.path}/${
        kind === "threat"
          ? "product-security/threats"
          : `product-security/architecture/${kind === "dataflow" ? "dataflows" : `${kind}s`}`
      }`,
      limit: 1,
    });
    return true;
  } catch (error) {
    if (isMissingDirectory(error)) return false;
    throw error;
  }
}

export async function listTara(
  bb: BbPluginApi,
  db: Database.Database,
  input: {
    projectId: string;
    projectVersionId: string | null;
    pageSize?: number;
    continuation?: string | null;
    kind?: unknown;
    filters?: unknown;
  },
) {
  const kind = readTaraKind(input);
  assertFoundationFilters(input);
  const projectVersionId = toStorageProjectVersionId(input.projectVersionId);
  const sync = db
    .prepare<[string, string, string], TaraSyncRow>(
      `SELECT accepted_generation_id, base_revision, last_pull, error
         FROM sync_state
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?`,
    )
    .get(input.projectId, projectVersionId, kind);

  const pageSize = input.pageSize ?? 50;
  const afterKey = decodeContinuation(input.continuation ?? null);
  const rows = sync?.accepted_generation_id
    ? db
        .prepare<[string, string, string, string], TaraSnapshotRow>(
          `SELECT entity_key, payload
         FROM base_snapshot
        WHERE project_id = ?
          AND project_version_id = ?
          AND entity_kind = ?
          AND generation_id = ?
        ORDER BY entity_key
        LIMIT 10001`,
        )
        .all(
          input.projectId,
          projectVersionId,
          kind,
          sync.accepted_generation_id,
        )
    : [];
  if (rows.length > 10_000) {
    throw new Error(
      `TARA ${kind} accepted base exceeds the 10,000-entity safety bound.`,
    );
  }
  let working: StoredCanvasEntity[] = [];
  let hasWorkingDirectory = false;
  let source: CanvasProjectSource | null = null;
  try {
    source = await projectSource(bb, input.projectId);
  } catch {
    // An accepted base remains readable when this bb project has no bound
    // workspace source. With no base this is the explicit empty/unconfigured
    // state; no authored bytes are claimed or silently discarded.
  }
  if (source) {
    try {
      const files = createSdkCanvasFileStore(bb, source);
      working = await files.list(kind);
      hasWorkingDirectory = await workingDirectoryExists(bb, source, kind);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`INVALID_WORKING_TARA: ${detail}`);
    }
  }
  const merged = new Map<string, Record<string, JsonValue>>();
  for (const row of rows) {
    const fields = parsePayload(row.payload);
    const payloadSlug = fields["slug"];
    const slug =
      typeof payloadSlug === "string" && payloadSlug.length > 0
        ? payloadSlug
        : row.entity_key;
    merged.set(slug, fields);
  }
  for (const stored of working) {
    const fields = jsonValueSchema.parse(
      architectureEntityPayload(stored.entity),
    );
    if (!isJsonRecord(fields)) {
      throw new Error(
        `INVALID_WORKING_TARA: ${stored.file} must contain a mapping.`,
      );
    }
    merged.set(stored.entity.slug, fields);
  }
  if (hasWorkingDirectory) {
    const deletedPrefix = canvasDeletedMarkerPrefix(
      input.projectId,
      input.projectVersionId,
      kind,
    );
    for (const key of await bb.storage.kv.list(deletedPrefix)) {
      try {
        merged.delete(decodeURIComponent(key.slice(deletedPrefix.length)));
      } catch {
        throw new Error(
          "INVALID_WORKING_TARA: a local deletion marker is malformed.",
        );
      }
    }
  }
  const mergedRows = [...merged.entries()]
    .filter(([slug]) => slug > afterKey)
    .sort(([left], [right]) => left.localeCompare(right));
  const visibleRows = mergedRows.slice(0, pageSize);
  const next =
    mergedRows.length > pageSize && visibleRows.length > 0
      ? encodeContinuation(visibleRows[visibleRows.length - 1]![0])
      : null;
  const cacheState: "stale" | "fresh" = sync?.error ? "stale" : "fresh";

  return {
    items: visibleRows.map(([slug, fields]) => {
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        kind,
        key: slug,
        label: payloadLabel(fields, slug),
        fields,
      };
    }),
    total: merged.size,
    next,
    cache: sync?.accepted_generation_id
      ? {
          state: cacheState,
          asOf: sync.last_pull,
          message: sync.error
            ? "The last product-security refresh failed; showing accepted cache."
            : null,
          acceptedGenerationId: sync.accepted_generation_id,
          baseRevision: sync.base_revision,
        }
      : emptyCache(sync?.base_revision),
  };
}

export function registerProductSecurity(
  bb: BbPluginApi,
  ctx: PluginContext,
): void {
  bb.rpc.register(productSecurityRpcContract, {
    taraList(input) {
      return listTara(bb, ctx.db(), input);
    },
  });

  registerCanvasNodesBackend(bb, ctx);
  registerThreatOverlayBackend(bb, ctx);
  registerCanvasLinksBackend(bb, ctx);
  registerCanvasEditingBackend(bb, ctx);
  registerRequirementsCardsBackend(bb, ctx);
  registerRequirementsTraceabilityBackend(bb, ctx);
  registerRequirementsConversionBackend(bb, ctx);
  registerVerificationMatrixBackend(bb, ctx);
  registerVerificationRunDetailBackend(bb, ctx);
}
