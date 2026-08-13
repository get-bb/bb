import { defineRpcContract } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import type { ParsedProject } from "./sheets.js";

export interface HardwareSemanticScope {
  projectId: string;
  projectVersionId: string | null;
  projectKey: string;
}

export const HW_INGEST_RETENTION = 20;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const scopeSchema = {
  projectId: z.string().trim().min(1).max(512),
  projectVersionId: z.string().trim().min(1).max(512).nullable(),
  projectKey: z.string().trim().min(1).max(2000),
};
const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
export const connectivityGapSchema = z.object({
  sheetPath: z.string().trim().min(1).max(2000),
  kind: z.enum([
    "unresolved_label",
    "unresolved_hierarchical_pin",
    "unsupported_bus",
    "missing_pin_geometry",
  ]),
  detail: z.string().min(1).max(4000),
  at: pointSchema.nullable(),
}).strict();
const connectivityGapsSchema = z.array(connectivityGapSchema).max(100_000);

export const hardwareConnectivityGapsRpcContract = defineRpcContract({
  hardwareConnectivityGapsList: {
    input: z.object({ ...scopeSchema, sourceHash: sha256Schema.optional() }).strict(),
    output: z.object({
      ...scopeSchema,
      sourceHash: sha256Schema.nullable(),
      gaps: connectivityGapsSchema,
    }).strict(),
  },
});

interface LedgerRow {
  source_hash: string;
  ingested_at: string;
  symbol_refs: string;
  connectivity_gaps: string;
}

export class HardwareIngestHashNotRetainedError extends Error {
  readonly code = "HW_INGEST_HASH_NOT_RETAINED";

  constructor(sourceHash: string) {
    super(`HW_INGEST_HASH_NOT_RETAINED: source hash ${sourceHash} is no longer retained`);
    this.name = "HardwareIngestHashNotRetainedError";
  }
}

function storageScope(scope: HardwareSemanticScope): [string, string, string] {
  return [
    scope.projectId,
    toStorageProjectVersionId(scope.projectVersionId),
    scope.projectKey,
  ];
}

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }) ||
    left.localeCompare(right);
}

function nextIngestedAt(previous: string | undefined): string {
  const now = Date.now();
  const previousMs = previous === undefined ? Number.NaN : Date.parse(previous);
  return new Date(Number.isFinite(previousMs) ? Math.max(now, previousMs + 1) : now).toISOString();
}

function parseJson<T>(raw: string, schema: z.ZodType<T>, errorCode: string): T {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(errorCode);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(errorCode);
  return parsed.data;
}

function ledgerRow(
  db: Database.Database,
  scope: HardwareSemanticScope,
  sourceHash?: string,
): LedgerRow | undefined {
  const bindings = storageScope(scope);
  if (sourceHash !== undefined) {
    return db.prepare<[string, string, string, string], LedgerRow>(
      `SELECT source_hash, ingested_at, symbol_refs, connectivity_gaps
         FROM hw_ingest
        WHERE project_id = ? AND project_version_id = ? AND project_key = ?
          AND source_hash = ?`,
    ).get(...bindings, sourceHash);
  }
  return db.prepare<[string, string, string], LedgerRow>(
    `SELECT source_hash, ingested_at, symbol_refs, connectivity_gaps
       FROM hw_ingest
      WHERE project_id = ? AND project_version_id = ? AND project_key = ?
      ORDER BY ingested_at DESC, source_hash DESC
      LIMIT 1`,
  ).get(...bindings);
}

export function ingestProject(
  db: Database.Database,
  scope: HardwareSemanticScope,
  sourceHash: string,
  parsed: ParsedProject,
): void {
  const validatedHash = sha256Schema.parse(sourceHash);
  const validatedGaps = connectivityGapsSchema.parse(parsed.connectivityGaps);
  const bindings = storageScope(scope);
  const current = ledgerRow(db, scope);
  if (current?.source_hash === validatedHash) return;
  const ingestedAt = nextIngestedAt(current?.ingested_at);
  const symbolRefs = [...new Set(parsed.sheets.flatMap((sheet) =>
    sheet.symbols.map((symbol) => symbol.reference)))].sort(naturalCompare);

  db.transaction(() => {
    const project = db.prepare<[string, string, string], { present: number }>(
      `SELECT 1 AS present FROM hw_project
        WHERE project_id = ? AND project_version_id = ? AND project_key = ?`,
    ).get(...bindings);
    if (!project) throw new Error(`HW_PROJECT_NOT_FOUND: ${scope.projectKey}`);

    db.prepare(
      `DELETE FROM hw_sheet
        WHERE project_id = ? AND project_version_id = ? AND project_key = ?`,
    ).run(...bindings);
    db.prepare(
      `DELETE FROM hw_symbol
        WHERE project_id = ? AND project_version_id = ? AND project_key = ?`,
    ).run(...bindings);
    db.prepare(
      `DELETE FROM hw_net
        WHERE project_id = ? AND project_version_id = ? AND project_key = ?`,
    ).run(...bindings);

    const insertSheet = db.prepare(`INSERT INTO hw_sheet (
      project_id, project_version_id, project_key, sheet_path, name,
      parent_sheet_path, page_order, width_mm, height_mm
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertSymbol = db.prepare(`INSERT INTO hw_symbol (
      project_id, project_version_id, project_key, sheet_path, reference,
      value, footprint, mpn, manufacturer, at_x, at_y, angle, unit, fields
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const sheet of parsed.sheets) {
      insertSheet.run(
        ...bindings, sheet.sheetPath, sheet.name, sheet.parent, sheet.pageOrder,
        sheet.widthMm, sheet.heightMm,
      );
      for (const symbol of sheet.symbols) {
        insertSymbol.run(
          ...bindings, sheet.sheetPath, symbol.reference, symbol.value,
          symbol.footprint, symbol.mpn, symbol.manufacturer, symbol.at.x,
          symbol.at.y, symbol.at.angle, symbol.unit, JSON.stringify(symbol.fields),
        );
      }
    }
    const insertNet = db.prepare(`INSERT INTO hw_net (
      project_id, project_version_id, project_key, net_name, nodes
    ) VALUES (?, ?, ?, ?, ?)`);
    for (const net of parsed.nets) {
      insertNet.run(...bindings, net.netName, JSON.stringify(net.nodes));
    }

    db.prepare(`INSERT INTO hw_ingest (
      project_id, project_version_id, project_key, source_hash, ingested_at,
      symbol_refs, connectivity_gaps
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, project_version_id, project_key, source_hash)
    DO UPDATE SET
      ingested_at = excluded.ingested_at,
      symbol_refs = excluded.symbol_refs,
      connectivity_gaps = excluded.connectivity_gaps`).run(
      ...bindings, validatedHash, ingestedAt, JSON.stringify(symbolRefs),
      JSON.stringify(validatedGaps),
    );
    db.prepare(`DELETE FROM hw_ingest
      WHERE rowid IN (
        SELECT rowid FROM hw_ingest
         WHERE project_id = ? AND project_version_id = ? AND project_key = ?
         ORDER BY ingested_at DESC, source_hash DESC
         LIMIT -1 OFFSET ${HW_INGEST_RETENTION}
      )`).run(...bindings);
  })();
}

const symbolRefsSchema = z.array(z.string().trim().min(1)).max(100_000);

export function diffSymbolSets(
  db: Database.Database,
  scope: HardwareSemanticScope,
  fromHash: string,
  toHash: string,
): { added: string[]; removed: string[] } {
  const validatedFrom = sha256Schema.parse(fromHash);
  const validatedTo = sha256Schema.parse(toHash);
  const from = ledgerRow(db, scope, validatedFrom);
  if (!from) throw new HardwareIngestHashNotRetainedError(validatedFrom);
  const to = ledgerRow(db, scope, validatedTo);
  if (!to) throw new HardwareIngestHashNotRetainedError(validatedTo);
  const fromRefs = new Set(parseJson(from.symbol_refs, symbolRefsSchema, "HW_INGEST_SYMBOL_REFS_INVALID"));
  const toRefs = new Set(parseJson(to.symbol_refs, symbolRefsSchema, "HW_INGEST_SYMBOL_REFS_INVALID"));
  return {
    added: [...toRefs].filter((reference) => !fromRefs.has(reference)).sort(naturalCompare),
    removed: [...fromRefs].filter((reference) => !toRefs.has(reference)).sort(naturalCompare),
  };
}

export function listConnectivityGaps(
  db: Database.Database,
  input: z.input<typeof hardwareConnectivityGapsRpcContract.hardwareConnectivityGapsList.input>,
) {
  const parsedInput = hardwareConnectivityGapsRpcContract.hardwareConnectivityGapsList.input.parse(input);
  const row = ledgerRow(db, parsedInput, parsedInput.sourceHash);
  if (!row && parsedInput.sourceHash !== undefined) {
    throw new HardwareIngestHashNotRetainedError(parsedInput.sourceHash);
  }
  return {
    projectId: parsedInput.projectId,
    projectVersionId: parsedInput.projectVersionId,
    projectKey: parsedInput.projectKey,
    sourceHash: row?.source_hash ?? null,
    gaps: row
      ? parseJson(row.connectivity_gaps, connectivityGapsSchema, "HW_INGEST_GAPS_INVALID")
      : [],
  };
}
