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

interface TaraTotalRow {
  total: number;
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

function compareTaraSlug(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function workingDiagnosticMessage(
  baseMessage: string | null,
  diagnostics: readonly { file: string; message: string }[],
): string | null {
  const first = diagnostics[0];
  const invalid = first
    ? `Invalid working YAML quarantined at ${first.file}: ${first.message}${diagnostics.length > 1 ? ` And ${diagnostics.length - 1} more invalid file${diagnostics.length === 2 ? "" : "s"}.` : ""}`
    : null;
  const combined = [baseMessage, invalid].filter(Boolean).join(" ");
  return combined.length > 0 ? combined.slice(0, 4_000) : null;
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
  let working: StoredCanvasEntity[] = [];
  let diagnostics: { file: string; slug: string; message: string }[] = [];
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
      const listing = files.listWithDiagnostics
        ? await files.listWithDiagnostics(kind)
        : { entities: await files.list(kind), diagnostics: [] };
      working = listing.entities;
      diagnostics = listing.diagnostics;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`INVALID_WORKING_TARA: ${detail}`);
    }
  }
  const deletedPrefix = canvasDeletedMarkerPrefix(
    input.projectId,
    input.projectVersionId,
    kind,
  );
  const deleted = new Set<string>();
  for (const key of await bb.storage.kv.list(deletedPrefix)) {
    try {
      deleted.add(decodeURIComponent(key.slice(deletedPrefix.length)));
    } catch {
      throw new Error(
        "INVALID_WORKING_TARA: a local deletion marker is malformed.",
      );
    }
  }
  const excluded = new Set([
    ...working.map((stored) => stored.entity.slug),
    ...diagnostics.map((diagnostic) => diagnostic.slug),
    ...deleted,
  ]);
  const visibleWorking = working.filter(
    (stored) => !deleted.has(stored.entity.slug),
  );
  const excludedJson = JSON.stringify([...excluded]);
  const rows = sync?.accepted_generation_id
    ? db
        .prepare<
          [string, string, string, string, string, string, number],
          TaraSnapshotRow
        >(
          `SELECT entity_key, payload
             FROM (
               SELECT COALESCE(
                        NULLIF(json_extract(payload, '$.slug'), ''),
                        entity_key
                      ) AS entity_key,
                      payload
                 FROM base_snapshot
                WHERE project_id = ? AND project_version_id = ?
                  AND entity_kind = ? AND generation_id = ?
             )
            WHERE entity_key COLLATE BINARY > ?
              AND NOT EXISTS (
                SELECT 1 FROM json_each(?) AS excluded
                 WHERE excluded.value = entity_key
              )
            ORDER BY entity_key COLLATE BINARY
            LIMIT ?`,
        )
        .all(
          input.projectId,
          projectVersionId,
          kind,
          sync.accepted_generation_id,
          afterKey,
          excludedJson,
          pageSize + 1,
        )
    : [];
  const acceptedTotal = sync?.accepted_generation_id
    ? db
        .prepare<
          [string, string, string, string, string],
          TaraTotalRow
        >(
          `SELECT COUNT(*) AS total
             FROM (
               SELECT COALESCE(
                        NULLIF(json_extract(payload, '$.slug'), ''),
                        entity_key
                      ) AS entity_key
                 FROM base_snapshot
                WHERE project_id = ? AND project_version_id = ?
                  AND entity_kind = ? AND generation_id = ?
             )
            WHERE NOT EXISTS (
              SELECT 1 FROM json_each(?) AS excluded
               WHERE excluded.value = entity_key
            )`,
        )
        .get(
          input.projectId,
          projectVersionId,
          kind,
          sync.accepted_generation_id,
          excludedJson,
        )?.total ?? 0
    : 0;
  const mergedRows: Array<[string, Record<string, JsonValue>]> = [];
  for (const row of rows) {
    const fields = parsePayload(row.payload);
    mergedRows.push([row.entity_key, fields]);
  }
  for (const stored of visibleWorking) {
    const fields = jsonValueSchema.parse(
      architectureEntityPayload(stored.entity),
    );
    if (!isJsonRecord(fields)) {
      throw new Error(
        `INVALID_WORKING_TARA: ${stored.file} must contain a mapping.`,
      );
    }
    mergedRows.push([stored.entity.slug, fields]);
  }
  mergedRows.splice(
    0,
    mergedRows.length,
    ...mergedRows
      .filter(([slug]) => compareTaraSlug(slug, afterKey) > 0)
      .sort(([left], [right]) => compareTaraSlug(left, right)),
  );
  const visibleRows = mergedRows.slice(0, pageSize);
  const next =
    mergedRows.length > pageSize && visibleRows.length > 0
      ? encodeContinuation(visibleRows[visibleRows.length - 1]![0])
      : null;
  const cacheState: "stale" | "fresh" =
    sync?.error || diagnostics.length > 0 ? "stale" : "fresh";
  const cacheMessage = workingDiagnosticMessage(
    sync?.error
      ? "The last product-security refresh failed; showing accepted cache."
      : null,
    diagnostics,
  );
  const total = acceptedTotal + visibleWorking.length;

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
    total,
    next,
    cache: sync?.accepted_generation_id
      ? {
          state: cacheState,
          asOf: sync.last_pull,
          message: cacheMessage,
          acceptedGenerationId: sync.accepted_generation_id,
          baseRevision: sync.base_revision,
        }
      : diagnostics.length > 0
        ? {
            state: "stale" as const,
            asOf: null,
            message: cacheMessage,
            acceptedGenerationId: null,
            baseRevision: sync?.base_revision ?? 0,
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
