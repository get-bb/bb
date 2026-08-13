import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import SidecarDatabase from "better-sqlite3";
import { FirmwareCacheError, validatePvId } from "./cache/layout.js";

export interface FirmwareDiffItem {
  path: string;
  operation: "added" | "removed" | "changed";
  beforeHash: string | null;
  afterHash: string | null;
  beforeSize: number | null;
  afterSize: number | null;
  securityRegressions: string[];
  beforeSecurityFeatures?: Record<string, boolean | string> | null;
  afterSecurityFeatures?: Record<string, boolean | string> | null;
}

export interface FirmwareDiffResult {
  fromPvId: string;
  toPvId: string;
  items: FirmwareDiffItem[];
  total: number;
  unchanged: number;
  cursor?: string;
  fromAvailable?: boolean;
  toAvailable?: boolean;
}

export interface FirmwareDiffDeps {
  db: Database.Database;
  projectId: string;
  pageSize?: number;
}

interface MountRow {
  root_path: string;
}

interface DiffNode {
  path: string;
  kind: "file" | "directory" | "symlink";
  file_hash: string | null;
  size: number | null;
  security_features?: string | null;
  security_features_json?: string | null;
}

function mount(deps: FirmwareDiffDeps, pvId: string): MountRow | null {
  validatePvId(pvId);
  return (deps.db.prepare(`SELECT root_path FROM firmware_mounts
    WHERE project_id = ? AND project_version_id = ?
    ORDER BY pulled_at DESC, generation_id DESC LIMIT 1`).get(
      deps.projectId,
      pvId,
    ) as MountRow | undefined) ?? null;
}

function nodes(row: MountRow | null): { available: boolean; values: DiffNode[] } {
  if (!row) return { available: false, values: [] };
  let db: SidecarDatabase.Database | null = null;
  try {
    db = new SidecarDatabase(join(dirname(row.root_path), "manifest.sqlite"), {
      readonly: true,
      fileMustExist: true,
    });
    if (db.prepare("PRAGMA quick_check").pluck().get() !== "ok") {
      throw new Error("SQLite quick_check failed");
    }
    return {
      available: true,
      values: db.prepare(`SELECT * FROM fs_node
        WHERE kind IN ('file','symlink') ORDER BY path`).all() as DiffNode[],
    };
  } catch {
    return { available: false, values: [] };
  } finally {
    db?.close();
  }
}

function features(node: DiffNode): Record<string, boolean | string> | null {
  const raw = node.security_features_json ?? node.security_features;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) =>
      typeof value === "boolean" || typeof value === "string")) as Record<string, boolean | string>;
  } catch {
    return null;
  }
}

function isEnabled(value: boolean | string | undefined): boolean {
  return value === true || (typeof value === "string" && ["enabled", "full", "yes", "true"].includes(value.toLowerCase()));
}

function isDisabled(value: boolean | string | undefined): boolean {
  return value === false || (typeof value === "string" && ["disabled", "no", "false", "none"].includes(value.toLowerCase()));
}

function regressions(before: Record<string, boolean | string> | null, after: Record<string, boolean | string> | null): string[] {
  if (!before || !after) return [];
  return Object.keys(before)
    .filter((key) => isEnabled(before[key]) && isDisabled(after[key]))
    .sort()
    .map((key) => `${key}: enabled → disabled`);
}

function changed(before: DiffNode, after: DiffNode): boolean {
  return before.kind !== after.kind || before.file_hash !== after.file_hash;
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    if (Number.isSafeInteger(value.offset) && Number(value.offset) >= 0) return Number(value.offset);
  } catch {
    // Fall through.
  }
  throw new FirmwareCacheError("INVALID_CONTINUATION", "Firmware diff continuation is invalid.");
}

export function diffFirmware(
  deps: FirmwareDiffDeps,
  fromPvId: string,
  toPvId: string,
  cursor?: string,
): FirmwareDiffResult {
  const beforePage = nodes(mount(deps, fromPvId));
  const afterPage = nodes(mount(deps, toPvId));
  const before = new Map(beforePage.values.map((node) => [node.path, node]));
  const after = new Map(afterPage.values.map((node) => [node.path, node]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const items: FirmwareDiffItem[] = [];
  let unchanged = 0;
  for (const path of paths) {
    const left = before.get(path);
    const right = after.get(path);
    if (left && right && !changed(left, right)) {
      unchanged += 1;
      continue;
    }
    const beforeSecurityFeatures = left ? features(left) : null;
    const afterSecurityFeatures = right ? features(right) : null;
    items.push({
      path: path.slice(1),
      operation: left ? (right ? "changed" : "removed") : "added",
      beforeHash: left?.file_hash ?? null,
      afterHash: right?.file_hash ?? null,
      beforeSize: left?.size ?? null,
      afterSize: right?.size ?? null,
      securityRegressions: regressions(beforeSecurityFeatures, afterSecurityFeatures),
      beforeSecurityFeatures,
      afterSecurityFeatures,
    });
  }
  const offset = parseCursor(cursor);
  const pageSize = Math.min(200, Math.max(1, deps.pageSize ?? 50));
  const page = items.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  return {
    fromPvId,
    toPvId,
    items: page,
    total: items.length,
    unchanged,
    ...(nextOffset < items.length
      ? { cursor: Buffer.from(JSON.stringify({ offset: nextOffset }), "utf8").toString("base64url") }
      : {}),
    fromAvailable: beforePage.available,
    toAvailable: afterPage.available,
  };
}

interface RpcDiffInput {
  projectId: string;
  projectVersionId: string | null;
  fromProjectVersionId: string;
  toProjectVersionId: string;
  pageSize: number;
  continuation: string | null;
  filters?: Record<string, unknown>;
}

export function diffFirmwarePage(deps: FirmwareDiffDeps, input: RpcDiffInput) {
  const result = diffFirmware(
    { ...deps, pageSize: input.pageSize },
    input.fromProjectVersionId,
    input.toProjectVersionId,
    input.continuation ?? undefined,
  );
  const state = !result.fromAvailable || !result.toAvailable ? "stale" as const : "fresh" as const;
  return {
    items: result.items.map((item) => ({
      projectId: input.projectId,
      projectVersionId: input.toProjectVersionId,
      kind: "firmware-diff",
      key: `${item.operation}:${item.path}`,
      label: item.path,
      fields: { ...item },
    })),
    total: result.total,
    next: result.cursor ?? null,
    cache: {
      state,
      asOf: null,
      message: state === "stale"
        ? `Sidecar availability: from=${result.fromAvailable ? "available" : "unavailable"}, to=${result.toAvailable ? "available" : "unavailable"}.`
        : `${result.unchanged} unchanged firmware entries.`,
      acceptedGenerationId: null,
      baseRevision: 0,
    },
  };
}
