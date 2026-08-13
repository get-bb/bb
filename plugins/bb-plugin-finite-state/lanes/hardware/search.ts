import type Database from "better-sqlite3";
import { z } from "zod";
import { toStorageProjectVersionId } from "../../lib/store/index.js";

export interface HardwareSearchScope {
  projectId: string;
  projectVersionId: string | null;
  projectKey: string;
}

export interface HardwareSymbolsListInput extends HardwareSearchScope {
  pageSize: number;
  cursor: string | null;
  query?: string;
  sheetPath?: string;
  netName?: string;
}

export interface HardwareNetsListInput extends HardwareSearchScope {
  pageSize: number;
  cursor: string | null;
  query?: string;
  reference?: string;
}

export interface HardwarePartGetInput extends HardwareSearchScope {
  reference: string;
}

export interface HardwareSymbolResult extends HardwareSearchScope {
  reference: string;
  value: string | null;
  footprint: string | null;
  mpn: string | null;
  manufacturer: string | null;
  units: Array<{
    unit: number;
    sheetPath: string;
    at: { x: number; y: number; angle: number | null };
  }>;
  nets: string[];
}

export interface HardwareNetResult extends HardwareSearchScope {
  netName: string;
  nodes: Array<{ reference: string; pin: string }>;
}

interface SymbolRow {
  sheet_path: string;
  reference: string;
  value: string | null;
  footprint: string | null;
  mpn: string | null;
  manufacturer: string | null;
  at_x: number;
  at_y: number;
  angle: number | null;
  unit: number | null;
}

interface NetRow {
  net_name: string;
  nodes: string;
}

const nodeSchema = z.object({
  reference: z.string().trim().min(1),
  pin: z.string().trim().min(1),
}).strict();
const nodesSchema = z.array(nodeSchema).max(10_000);
const scopeSchema = {
  projectId: z.string().trim().min(1),
  projectVersionId: z.string().trim().min(1).nullable(),
  projectKey: z.string().trim().min(1),
};
const symbolsListInputSchema = z.object({
  ...scopeSchema,
  pageSize: z.number().int().positive(),
  cursor: z.string().min(1).nullable(),
  query: z.string().optional(),
  sheetPath: z.string().optional(),
  netName: z.string().optional(),
}).strict();
const netsListInputSchema = z.object({
  ...scopeSchema,
  pageSize: z.number().int().positive(),
  cursor: z.string().min(1).nullable(),
  query: z.string().optional(),
  reference: z.string().optional(),
}).strict();
const partGetInputSchema = z.object({
  ...scopeSchema,
  reference: z.string().trim().min(1),
}).strict();

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

function cursorOffset(cursor: string | null, kind: string): number {
  if (cursor === null) return 0;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new Error("HW_CURSOR_INVALID");
  }
  const prefix = `${kind}:`;
  if (!decoded.startsWith(prefix)) throw new Error("HW_CURSOR_INVALID");
  const offset = Number(decoded.slice(prefix.length));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("HW_CURSOR_INVALID");
  return offset;
}

function nextCursor(offset: number, returned: number, total: number, kind: string): string | null {
  const nextOffset = offset + returned;
  return nextOffset < total
    ? Buffer.from(`${kind}:${nextOffset}`).toString("base64url")
    : null;
}

export function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }) ||
    left.localeCompare(right);
}

function scopeBindings(scope: HardwareSearchScope): [string, string, string] {
  return [scope.projectId, toStorageProjectVersionId(scope.projectVersionId), scope.projectKey];
}

function scopeOutput(scope: HardwareSearchScope): HardwareSearchScope {
  return {
    projectId: scope.projectId,
    projectVersionId: scope.projectVersionId,
    projectKey: scope.projectKey,
  };
}

function selectReferences(
  db: Database.Database,
  input: HardwareSymbolsListInput,
): string[] {
  const conditions = [
    "s.project_id = ?",
    "s.project_version_id = ?",
    "s.project_key = ?",
  ];
  const parameters: Array<string | number> = [...scopeBindings(input)];
  const query = input.query?.trim();
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    conditions.push(`(
      s.reference LIKE ? ESCAPE '\\' COLLATE NOCASE OR
      COALESCE(s.value, '') LIKE ? ESCAPE '\\' COLLATE NOCASE OR
      COALESCE(s.footprint, '') LIKE ? ESCAPE '\\' COLLATE NOCASE OR
      COALESCE(s.mpn, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`);
    parameters.push(pattern, pattern, pattern, pattern);
  }
  if (input.sheetPath) {
    conditions.push("s.sheet_path = ?");
    parameters.push(input.sheetPath);
  }
  if (input.netName) {
    conditions.push(`EXISTS (
      SELECT 1 FROM hw_net AS n, json_each(n.nodes) AS node
       WHERE n.project_id = s.project_id
         AND n.project_version_id = s.project_version_id
         AND n.project_key = s.project_key
         AND n.net_name = ?
         AND json_extract(node.value, '$.reference') = s.reference
    )`);
    parameters.push(input.netName);
  }
  const rows = db.prepare<Array<string | number>, { reference: string }>(
    `SELECT DISTINCT s.reference FROM hw_symbol AS s WHERE ${conditions.join(" AND ")}`,
  ).all(...parameters);
  return rows.map((row) => row.reference).sort(naturalCompare);
}

function symbolRows(
  db: Database.Database,
  input: HardwareSearchScope & { sheetPath?: string },
  references: string[],
): SymbolRow[] {
  if (references.length === 0) return [];
  const placeholders = references.map(() => "?").join(", ");
  const parameters: Array<string | number> = [...scopeBindings(input), ...references];
  let sheetCondition = "";
  if (input.sheetPath) {
    sheetCondition = " AND sheet_path = ?";
    parameters.push(input.sheetPath);
  }
  return db.prepare<Array<string | number>, SymbolRow>(
    `SELECT sheet_path, reference, value, footprint, mpn, manufacturer,
            at_x, at_y, angle, unit
       FROM hw_symbol
      WHERE project_id = ? AND project_version_id = ? AND project_key = ?
        AND reference IN (${placeholders})${sheetCondition}
      ORDER BY sheet_path, unit`,
  ).all(...parameters);
}

function netsByReference(
  db: Database.Database,
  input: HardwareSearchScope,
  references: string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>(references.map((reference) => [reference, []]));
  if (references.length === 0) return result;
  const placeholders = references.map(() => "?").join(", ");
  const rows = db.prepare<Array<string | number>, { reference: string; net_name: string }>(
    `SELECT DISTINCT json_extract(node.value, '$.reference') AS reference, n.net_name
       FROM hw_net AS n, json_each(n.nodes) AS node
      WHERE n.project_id = ? AND n.project_version_id = ? AND n.project_key = ?
        AND json_extract(node.value, '$.reference') IN (${placeholders})`,
  ).all(...scopeBindings(input), ...references);
  for (const row of rows) result.get(row.reference)?.push(row.net_name);
  for (const nets of result.values()) nets.sort(naturalCompare);
  return result;
}

function aggregateSymbols(
  input: HardwareSearchScope,
  references: string[],
  rows: SymbolRow[],
  nets: Map<string, string[]>,
): HardwareSymbolResult[] {
  const rowsByReference = new Map<string, SymbolRow[]>();
  for (const row of rows) {
    const entries = rowsByReference.get(row.reference) ?? [];
    entries.push(row);
    rowsByReference.set(row.reference, entries);
  }
  return references.map((reference) => {
    const entries = rowsByReference.get(reference) ?? [];
    const first = entries[0];
    if (!first) throw new Error(`HW_SYMBOL_NOT_FOUND: ${reference}`);
    return {
      ...scopeOutput(input),
      reference,
      value: first.value,
      footprint: first.footprint,
      mpn: first.mpn,
      manufacturer: first.manufacturer,
      units: entries.map((entry) => {
        if (!entry.unit || entry.unit < 1) throw new Error(`HW_SYMBOL_UNIT_INVALID: ${reference}`);
        return {
          unit: entry.unit,
          sheetPath: entry.sheet_path,
          at: { x: entry.at_x, y: entry.at_y, angle: entry.angle },
        };
      }),
      nets: nets.get(reference) ?? [],
    };
  });
}

export function listHardwareSymbols(
  db: Database.Database,
  rawInput: unknown,
): { items: HardwareSymbolResult[]; total: number; cursor: string | null } {
  const input: HardwareSymbolsListInput = symbolsListInputSchema.parse(rawInput);
  const references = selectReferences(db, input);
  const offset = cursorOffset(input.cursor, "symbols");
  const pageReferences = references.slice(offset, offset + input.pageSize);
  const rows = symbolRows(db, input, pageReferences);
  const items = aggregateSymbols(input, pageReferences, rows, netsByReference(db, input, pageReferences));
  return {
    items,
    total: references.length,
    cursor: nextCursor(offset, items.length, references.length, "symbols"),
  };
}

function parseNodes(row: NetRow): HardwareNetResult["nodes"] {
  let value: unknown;
  try {
    value = JSON.parse(row.nodes);
  } catch {
    throw new Error(`HW_NET_NODES_INVALID: ${row.net_name}`);
  }
  const parsed = nodesSchema.safeParse(value);
  if (!parsed.success) throw new Error(`HW_NET_NODES_INVALID: ${row.net_name}`);
  return parsed.data;
}

export function listHardwareNets(
  db: Database.Database,
  rawInput: unknown,
): { items: HardwareNetResult[]; total: number; cursor: string | null } {
  const input: HardwareNetsListInput = netsListInputSchema.parse(rawInput);
  const conditions = ["n.project_id = ?", "n.project_version_id = ?", "n.project_key = ?"];
  const parameters: Array<string | number> = [...scopeBindings(input)];
  const query = input.query?.trim();
  if (query) {
    conditions.push("n.net_name LIKE ? ESCAPE '\\' COLLATE NOCASE");
    parameters.push(`%${escapeLike(query)}%`);
  }
  if (input.reference) {
    conditions.push(`EXISTS (
      SELECT 1 FROM json_each(n.nodes) AS node
       WHERE json_extract(node.value, '$.reference') = ?
    )`);
    parameters.push(input.reference);
  }
  const rows = db.prepare<Array<string | number>, NetRow>(
    `SELECT n.net_name, n.nodes FROM hw_net AS n WHERE ${conditions.join(" AND ")}`,
  ).all(...parameters).sort((left, right) => naturalCompare(left.net_name, right.net_name));
  const offset = cursorOffset(input.cursor, "nets");
  const pageRows = rows.slice(offset, offset + input.pageSize);
  return {
    items: pageRows.map((row) => ({
      ...scopeOutput(input),
      netName: row.net_name,
      nodes: parseNodes(row),
    })),
    total: rows.length,
    cursor: nextCursor(offset, pageRows.length, rows.length, "nets"),
  };
}

export function getHardwarePart(
  db: Database.Database,
  rawInput: unknown,
): HardwareSymbolResult & {
  hbom: null;
  openCveCount: null;
} {
  const input: HardwarePartGetInput = partGetInputSchema.parse(rawInput);
  const rows = symbolRows(db, input, [input.reference]);
  if (rows.length === 0) throw new Error(`HW_PART_NOT_FOUND: ${input.reference}`);
  const symbol = aggregateSymbols(
    input,
    [input.reference],
    rows,
    netsByReference(db, input, [input.reference]),
  )[0];
  if (!symbol) throw new Error(`HW_PART_NOT_FOUND: ${input.reference}`);
  return { ...symbol, hbom: null, openCveCount: null };
}
