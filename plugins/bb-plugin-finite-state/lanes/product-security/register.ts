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

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanvasTaraKind(value: unknown): value is CanvasTaraKind {
  return (
    value === "component" ||
    value === "zone" ||
    value === "asset" ||
    value === "dataflow"
  );
}

function readTaraKind(value: unknown): CanvasTaraKind {
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

function listTara(
  db: Database.Database,
  input: {
    projectId: string;
    projectVersionId: string | null;
    pageSize?: number;
    continuation?: string | null;
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

  if (!sync?.accepted_generation_id) {
    return {
      items: [],
      total: 0,
      next: null,
      cache: emptyCache(sync?.base_revision),
    };
  }

  const pageSize = input.pageSize ?? 50;
  const afterKey = decodeContinuation(input.continuation ?? null);
  const rows = db
    .prepare<[string, string, string, string, string, number], TaraSnapshotRow>(
      `SELECT entity_key, payload
         FROM base_snapshot
        WHERE project_id = ?
          AND project_version_id = ?
          AND entity_kind = ?
          AND generation_id = ?
          AND entity_key > ?
        ORDER BY entity_key
        LIMIT ?`,
    )
    .all(
      input.projectId,
      projectVersionId,
      kind,
      sync.accepted_generation_id,
      afterKey,
      pageSize + 1,
    );
  const total =
    db
      .prepare<[string, string, string, string], { count: number }>(
        `SELECT COUNT(*) AS count
         FROM base_snapshot
        WHERE project_id = ?
          AND project_version_id = ?
          AND entity_kind = ?
          AND generation_id = ?`,
      )
      .get(input.projectId, projectVersionId, kind, sync.accepted_generation_id)
      ?.count ?? 0;
  const visibleRows = rows.slice(0, pageSize);
  const next =
    rows.length > pageSize && visibleRows.length > 0
      ? encodeContinuation(visibleRows[visibleRows.length - 1]!.entity_key)
      : null;
  const cacheState: "stale" | "fresh" = sync.error ? "stale" : "fresh";

  return {
    items: visibleRows.map((row) => {
      const fields = parsePayload(row.payload);
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        kind,
        key: row.entity_key,
        label: payloadLabel(fields, row.entity_key),
        fields,
      };
    }),
    total,
    next,
    cache: {
      state: cacheState,
      asOf: sync.last_pull,
      message: sync.error
        ? "The last product-security refresh failed; showing accepted cache."
        : null,
      acceptedGenerationId: sync.accepted_generation_id,
      baseRevision: sync.base_revision,
    },
  };
}

export function registerProductSecurity(
  bb: BbPluginApi,
  ctx: PluginContext,
): void {
  bb.rpc.register(productSecurityRpcContract, {
    taraList(input) {
      return listTara(ctx.db(), input);
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
