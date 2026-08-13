import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { parseKicadSch, type KicadSch, type Sheet } from "kicadts";
import type Database from "better-sqlite3";
import { z } from "zod";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import { assertRelativeProjectPath } from "../discovery.js";
import {
  extractSheetConnectivity,
  mergeProjectConnectivity,
  type ChildSheetPin,
  type ConnectivityGap,
  type HierarchicalLabel,
  type ParsedNet,
  type SheetConnectivity,
} from "./nets.js";
import { extractSymbols, type ParsedSymbol, type SymbolExtraction } from "./symbols.js";

export interface ParsedSheet {
  sheetPath: string;
  name: string;
  parent: string | null;
  pageOrder: number;
  widthMm: number | null;
  heightMm: number | null;
  symbols: ParsedSymbol[];
}

export interface ParsedProject {
  sheets: ParsedSheet[];
  nets: ParsedNet[];
  connectivityGaps: ConnectivityGap[];
}

export interface ParsedProjectGeneration {
  parsed: ParsedProject;
  sourceHash: string;
}

interface ExtractedExpression {
  token: string;
  text: string;
}

interface ParsedDocument {
  parsedSheet: ParsedSheet;
  schematic: KicadSch;
  symbolExtraction: SymbolExtraction;
  hierarchicalLabels: HierarchicalLabel[];
  unsupportedBusGaps: ConnectivityGap[];
  childPins: ChildSheetPin[];
}

const MINIMUM_SEXPRESSION_VERSION = 20210101;
const STRIPPED_KICADTS_TOKENS = new Set([
  "symbol_instances",
  "hierarchical_label",
  "bus",
  "bus_entry",
  "bus_alias",
]);

export class KicadVersionUnsupportedError extends Error {
  readonly code = "KICAD_VERSION_UNSUPPORTED";

  constructor(file: string, version: string) {
    super(`KICAD_VERSION_UNSUPPORTED: ${file} uses unsupported KiCad format ${version}`);
    this.name = "KicadVersionUnsupportedError";
  }
}

export class KicadSheetCycleError extends Error {
  readonly code = "KICAD_SHEET_CYCLE";

  constructor(paths: string[]) {
    super(`KICAD_SHEET_CYCLE: ${paths.join(" -> ")}`);
    this.name = "KicadSheetCycleError";
  }
}

export class KicadSheetReusedError extends Error {
  readonly code = "KICAD_SHEET_REUSED";

  constructor(path: string) {
    super(`KICAD_SHEET_REUSED: ${path} has multiple parents`);
    this.name = "KicadSheetReusedError";
  }
}

function posixPath(path: string): string {
  return path.split(sep).join("/");
}

function quoted(value: string): string {
  return value.replace(/\\n/gu, "\n").replace(/\\r/gu, "\r")
    .replace(/\\t/gu, "\t").replace(/\\"/gu, "\"").replace(/\\\\/gu, "\\");
}

function expressionEnd(source: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error("KICAD_PARSE_FAILED: unterminated S-expression");
}

function extractUnsupportedExpressions(source: string): {
  normalized: string;
  extracted: ExtractedExpression[];
} {
  const ranges: Array<{ start: number; end: number; token: string }> = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character !== "(") continue;
    const tokenMatch = /^\(([a-z_][a-z0-9_]*)/u.exec(source.slice(index));
    const token = tokenMatch?.[1];
    if (!token || !STRIPPED_KICADTS_TOKENS.has(token)) continue;
    const end = expressionEnd(source, index);
    ranges.push({ start: index, end, token });
    index = end - 1;
  }
  let normalized = "";
  let cursor = 0;
  const extracted: ExtractedExpression[] = [];
  for (const range of ranges) {
    normalized += source.slice(cursor, range.start);
    normalized += source.slice(range.start, range.end).replace(/[^\n]/gu, " ");
    extracted.push({ token: range.token, text: source.slice(range.start, range.end) });
    cursor = range.end;
  }
  normalized += source.slice(cursor);
  return { normalized, extracted };
}

function hierarchicalLabel(expression: ExtractedExpression): HierarchicalLabel | null {
  if (expression.token !== "hierarchical_label") return null;
  const nameMatch = /^\(hierarchical_label\s+"((?:\\.|[^"\\])*)"/u.exec(expression.text);
  const atMatch = /\(at\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:\s+-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)?\)/iu.exec(expression.text);
  if (!nameMatch?.[1] || !atMatch?.[1] || !atMatch[2]) return null;
  return {
    name: quoted(nameMatch[1]),
    at: { x: Number(atMatch[1]), y: Number(atMatch[2]) },
  };
}

function formatVersion(source: string): string {
  const root = /^\s*\(kicad_sch\b/u.test(source);
  const numeric = /\(version\s+([0-9]+)\)/u.exec(source)?.[1];
  if (root && numeric && Number(numeric) >= MINIMUM_SEXPRESSION_VERSION) return numeric;
  const legacy = /Eeschema\s+Schematic\s+File\s+Version\s+([^\s]+)/iu.exec(source)?.[1];
  return numeric ?? legacy ?? "unknown";
}

function assertSupportedVersion(source: string, sheetPath: string): void {
  const version = formatVersion(source);
  if (!/^\s*\(kicad_sch\b/u.test(source) || Number(version) < MINIMUM_SEXPRESSION_VERSION) {
    throw new KicadVersionUnsupportedError(sheetPath, version);
  }
}

function property(sheet: Sheet, name: string): string | null {
  const value = sheet.properties.find((candidate) =>
    candidate.key.toLocaleLowerCase() === name.toLocaleLowerCase())?.value.trim() ?? "";
  return value.length > 0 ? value : null;
}

function paperDimensions(schematic: KicadSch): { widthMm: number | null; heightMm: number | null } {
  const paper = schematic.paper;
  if (!paper) return { widthMm: null, heightMm: null };
  const standard: Record<string, [number, number]> = {
    A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210], A5: [210, 148],
    A: [279.4, 215.9], B: [431.8, 279.4], C: [558.8, 431.8], D: [863.6, 558.8], E: [1117.6, 863.6],
  };
  const custom = paper.customSize;
  const dimensions = custom ? [custom.width, custom.height] : paper.size ? standard[paper.size] : undefined;
  if (!dimensions) return { widthMm: null, heightMm: null };
  const [width, height] = dimensions;
  return paper.isPortrait ? { widthMm: height, heightMm: width } : { widthMm: width, heightMm: height };
}

function parseSchematic(source: string, sheetPath: string): {
  schematic: KicadSch;
  hierarchicalLabels: HierarchicalLabel[];
  unsupportedBusGaps: ConnectivityGap[];
} {
  assertSupportedVersion(source, sheetPath);
  const compatibility = extractUnsupportedExpressions(source);
  let schematic: KicadSch;
  try {
    schematic = parseKicadSch(compatibility.normalized);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`KICAD_PARSE_FAILED: ${sheetPath}: ${detail}`);
  }
  const hierarchicalLabels = compatibility.extracted
    .map(hierarchicalLabel)
    .filter((label): label is HierarchicalLabel => label !== null);
  const unsupportedBusGaps = compatibility.extracted
    .filter((expression) => expression.token === "bus" || expression.token === "bus_entry" || expression.token === "bus_alias")
    .map((expression): ConnectivityGap => ({
      sheetPath,
      kind: "unsupported_bus",
      detail: `kicadts@0.0.53 does not expose ${expression.token} connectivity`,
      at: null,
    }));
  return { schematic, hierarchicalLabels, unsupportedBusGaps };
}

async function readConfinedFile(root: string, sheetPath: string): Promise<string> {
  const safePath = assertRelativeProjectPath(sheetPath);
  const target = resolve(root, safePath);
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`KICAD_SHEET_PATH_INVALID: ${sheetPath}`);
  }
  const canonical = await realpath(target);
  const canonicalRelative = relative(root, canonical);
  if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) {
    throw new Error(`KICAD_SHEET_OUTSIDE_WORKTREE: ${sheetPath}`);
  }
  if (!(await stat(canonical)).isFile()) throw new Error(`KICAD_SHEET_NOT_FILE: ${sheetPath}`);
  return readFile(canonical, "utf8");
}

export async function parseProjectGeneration(
  worktreeRoot: string,
  projectKey: string,
): Promise<ParsedProjectGeneration> {
  const root = await realpath(worktreeRoot);
  const safeProjectKey = assertRelativeProjectPath(projectKey);
  if (!safeProjectKey.endsWith(".kicad_pro")) {
    throw new Error(`KICAD_PROJECT_KEY_INVALID: ${safeProjectKey}`);
  }
  const rootSheetPath = `${safeProjectKey.slice(0, -".kicad_pro".length)}.kicad_sch`;
  const documents: ParsedDocument[] = [];
  const sources = new Map<string, string>();
  const active: string[] = [];
  const parentByPath = new Map<string, string | null>();

  async function walk(sheetPath: string, name: string, parent: string | null): Promise<void> {
    const normalizedPath = posixPath(sheetPath);
    const cycleStart = active.indexOf(normalizedPath);
    if (cycleStart >= 0) throw new KicadSheetCycleError([...active.slice(cycleStart), normalizedPath]);
    const previousParent = parentByPath.get(normalizedPath);
    if (previousParent !== undefined) {
      if (previousParent !== parent) {
        throw new KicadSheetReusedError(normalizedPath);
      }
      return;
    }
    parentByPath.set(normalizedPath, parent);
    active.push(normalizedPath);
    const source = await readConfinedFile(root, normalizedPath);
    sources.set(normalizedPath, source);
    const parsed = parseSchematic(source, normalizedPath);
    const symbolExtraction = extractSymbols(parsed.schematic);
    const dimensions = paperDimensions(parsed.schematic);
    const parsedSheet: ParsedSheet = {
      sheetPath: normalizedPath,
      name,
      parent,
      pageOrder: documents.length,
      widthMm: dimensions.widthMm,
      heightMm: dimensions.heightMm,
      symbols: symbolExtraction.symbols,
    };
    const document: ParsedDocument = {
      parsedSheet,
      schematic: parsed.schematic,
      symbolExtraction,
      hierarchicalLabels: parsed.hierarchicalLabels,
      unsupportedBusGaps: parsed.unsupportedBusGaps,
      childPins: [],
    };
    documents.push(document);
    for (const childSheet of parsed.schematic.sheets) {
      const childName = property(childSheet, "Sheetname");
      const childFile = property(childSheet, "Sheetfile");
      if (!childName || !childFile) {
        throw new Error(`KICAD_SHEET_REFERENCE_INVALID: ${normalizedPath} has a sheet without Sheetname/Sheetfile`);
      }
      const childPath = posixPath(relative(root, resolve(root, dirname(normalizedPath), childFile)));
      assertRelativeProjectPath(childPath);
      for (const pin of childSheet.pins) {
        if (!pin.position) {
          throw new Error(`KICAD_SHEET_PIN_POSITION_MISSING: ${normalizedPath}:${pin.name}`);
        }
        document.childPins.push({
          name: pin.name,
          at: { x: pin.position.x, y: pin.position.y },
          childSheetPath: childPath,
        });
      }
      await walk(childPath, childName, normalizedPath);
    }
    active.pop();
  }

  await walk(rootSheetPath, basename(rootSheetPath, ".kicad_sch"), null);
  const connectivity: SheetConnectivity[] = documents.map((document) => {
    const sheetConnectivity = extractSheetConnectivity({
      sheetPath: document.parsedSheet.sheetPath,
      schematic: document.schematic,
      symbolPins: document.symbolExtraction.pins,
      hierarchicalLabels: document.hierarchicalLabels,
      childSheetPins: document.childPins,
    });
    sheetConnectivity.gaps.push(...document.unsupportedBusGaps);
    const missingPinGaps: ConnectivityGap[] = document.symbolExtraction.missingPinGeometry.map((detail) => ({
      sheetPath: document.parsedSheet.sheetPath,
      kind: "missing_pin_geometry",
      detail,
      at: null,
    }));
    sheetConnectivity.gaps.push(...missingPinGaps);
    return sheetConnectivity;
  });
  const merged = mergeProjectConnectivity(connectivity);
  const parsed = {
    sheets: documents.map((document) => document.parsedSheet),
    nets: merged.nets,
    connectivityGaps: merged.gaps,
  };
  const hash = createHash("sha256");
  for (const [sheetPath, source] of [...sources].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const pathBytes = Buffer.byteLength(sheetPath);
    const sourceBytes = Buffer.byteLength(source);
    hash.update(`${pathBytes}:`).update(sheetPath).update(`${sourceBytes}:`).update(source);
  }
  return { parsed, sourceHash: hash.digest("hex") };
}

export async function parseProject(worktreeRoot: string, projectKey: string): Promise<ParsedProject> {
  return (await parseProjectGeneration(worktreeRoot, projectKey)).parsed;
}

interface SheetRow {
  sheet_path: string;
  name: string;
  parent_sheet_path: string | null;
  page_order: number;
  width_mm: number | null;
  height_mm: number | null;
  symbol_count: number;
}

const sheetsListInputSchema = z.object({
  projectId: z.string().trim().min(1),
  projectVersionId: z.string().trim().min(1).nullable(),
  projectKey: z.string().trim().min(1),
  pageSize: z.number().int().positive(),
  cursor: z.string().min(1).nullable(),
}).strict();

function sheetCursorOffset(cursor: string | null): number {
  if (cursor === null) return 0;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!decoded.startsWith("sheets:")) throw new Error("HW_CURSOR_INVALID");
  const offset = Number(decoded.slice("sheets:".length));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("HW_CURSOR_INVALID");
  return offset;
}

export function listHardwareSheets(db: Database.Database, rawInput: unknown) {
  const input = sheetsListInputSchema.parse(rawInput);
  const scope: [string, string, string] = [
    input.projectId,
    toStorageProjectVersionId(input.projectVersionId),
    input.projectKey,
  ];
  const total = db.prepare<[string, string, string], { count: number }>(
    `SELECT COUNT(*) AS count FROM hw_sheet
      WHERE project_id = ? AND project_version_id = ? AND project_key = ?`,
  ).get(...scope)?.count ?? 0;
  const offset = sheetCursorOffset(input.cursor);
  const rows = db.prepare<[string, string, string, number, number], SheetRow>(
    `SELECT sheet.sheet_path, sheet.name, sheet.parent_sheet_path, sheet.page_order,
            sheet.width_mm, sheet.height_mm, COUNT(DISTINCT symbol.reference) AS symbol_count
       FROM hw_sheet AS sheet
       LEFT JOIN hw_symbol AS symbol
         ON symbol.project_id = sheet.project_id
        AND symbol.project_version_id = sheet.project_version_id
        AND symbol.project_key = sheet.project_key
        AND symbol.sheet_path = sheet.sheet_path
      WHERE sheet.project_id = ? AND sheet.project_version_id = ? AND sheet.project_key = ?
      GROUP BY sheet.project_id, sheet.project_version_id, sheet.project_key, sheet.sheet_path
      ORDER BY sheet.page_order, sheet.sheet_path
      LIMIT ? OFFSET ?`,
  ).all(...scope, input.pageSize, offset);
  const findSheet = db.prepare<[string, string, string, string], SheetRow>(
    `SELECT sheet_path, name, parent_sheet_path, page_order, width_mm, height_mm,
            0 AS symbol_count
       FROM hw_sheet
      WHERE project_id = ? AND project_version_id = ? AND project_key = ?
        AND sheet_path = ?`,
  );
  const items = rows.map((row) => {
    const breadcrumbs: Array<{ sheetPath: string; name: string }> = [];
    const visited = new Set<string>();
    let current: SheetRow | undefined = row;
    while (current) {
      if (visited.has(current.sheet_path)) throw new Error(`HW_SHEET_CACHE_CYCLE: ${current.sheet_path}`);
      visited.add(current.sheet_path);
      breadcrumbs.unshift({ sheetPath: current.sheet_path, name: current.name });
      if (breadcrumbs.length > 100) throw new Error("HW_SHEET_BREADCRUMBS_TOO_DEEP");
      current = current.parent_sheet_path
        ? findSheet.get(...scope, current.parent_sheet_path)
        : undefined;
    }
    return {
      projectId: input.projectId,
      projectVersionId: input.projectVersionId,
      projectKey: input.projectKey,
      sheetPath: row.sheet_path,
      name: row.name,
      parentSheetPath: row.parent_sheet_path,
      breadcrumbs,
      widthMm: row.width_mm,
      heightMm: row.height_mm,
      symbolCount: row.symbol_count,
    };
  });
  const nextOffset = offset + items.length;
  return {
    items,
    total,
    cursor: nextOffset < total
      ? Buffer.from(`sheets:${nextOffset}`).toString("base64url")
      : null,
  };
}
