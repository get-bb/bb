import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import type Database from "better-sqlite3";

import {
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_STATUSES,
  type VexJustification,
  type VexResponse,
  type VexStatus,
} from "../../../lib/remote/types.js";
import { identityFromStableKey, stripVexProvenance } from "../bulk/readback.js";
import { parseOverlayText } from "../overlay/reader.js";
import type { TriageOverlayV1 } from "../overlay/schema.js";
import type { VexTuple } from "../overlay/schema.js";
import { resolveFinding, type FindingResolution, type Pin } from "../stable-key/index.js";
import {
  boundedDriftLimit,
  driftTotals,
  type DriftItem,
  type DriftReport,
} from "./report.js";

interface DriftRow {
  project_id: string;
  stable_key: string;
  component_key: string | null;
  file_path: string;
  vex_status: string | null;
  vex_response: string | null;
  vex_justification: string | null;
  vex_reason: string | null;
  pin: string | null;
  sync_base: string | null;
  local_state: string;
}

function componentIdentity(
  row: DriftRow,
  authoredComponents: ReadonlyMap<string, TriageOverlayV1["component"]>,
): {
  purl: string | null;
  name: string;
  group: string | null;
  version: string | null;
  cve: string;
} {
  const decoded = identityFromStableKey(row.project_id, row.stable_key);
  const authored = authoredComponents.get(row.file_path);
  if (authored !== undefined) return { cve: decoded.identity.cve, ...authored };
  if (row.component_key === null) {
    return {
      cve: decoded.identity.cve,
      purl: decoded.identity.purl ?? null,
      name: decoded.identity.name,
      group: decoded.identity.group ?? null,
      version: decoded.identity.version ?? null,
    };
  }
  const value: unknown = JSON.parse(row.component_key);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Overlay component identity is invalid");
  const raw = value as Record<string, unknown>;
  if (typeof raw["name"] !== "string") throw new Error("Overlay component identity is missing name");
  return {
    cve: decoded.identity.cve,
    purl: typeof raw["purl"] === "string" ? raw["purl"] : null,
    name: raw["name"],
    group: typeof raw["group"] === "string" ? raw["group"] : null,
    version: typeof raw["version"] === "string" ? raw["version"] : null,
  };
}

export interface DriftDeps {
  db: Database.Database;
  projectId: string;
  root?: string;
  cursor?: string | null;
  limit?: number;
  updateIndex?: boolean;
}

function enumOrNull<T extends string>(value: string | null, values: readonly T[], field: string): T | null {
  if (value === null) return null;
  const parsed = values.find((candidate) => candidate === value);
  if (parsed === undefined) throw new Error(`Overlay ${field} is outside the frozen VEX vocabulary`);
  return parsed;
}

function tuple(row: DriftRow): VexTuple {
  return {
    status: enumOrNull<VexStatus>(row.vex_status, VEX_STATUSES, "vex_status"),
    response: enumOrNull<VexResponse>(row.vex_response, VEX_RESPONSES, "vex_response"),
    justification: enumOrNull<VexJustification>(row.vex_justification, VEX_JUSTIFICATIONS, "vex_justification"),
    reason: row.vex_reason,
  };
}

function baseTuple(serialized: string | null): VexTuple | null {
  if (serialized === null) return null;
  const value: unknown = JSON.parse(serialized);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Overlay sync_base is not a VEX tuple");
  }
  const raw = value as Record<string, unknown>;
  return {
    status: typeof raw["status"] === "string"
      ? enumOrNull(raw["status"], VEX_STATUSES, "sync_base.status")
      : null,
    response: typeof raw["response"] === "string"
      ? enumOrNull(raw["response"], VEX_RESPONSES, "sync_base.response")
      : null,
    justification: typeof raw["justification"] === "string"
      ? enumOrNull(raw["justification"], VEX_JUSTIFICATIONS, "sync_base.justification")
      : null,
    reason: typeof raw["reason"] === "string" ? raw["reason"] : null,
  };
}

function tupleKey(value: VexTuple | null): string {
  const normalized = value ?? { status: null, justification: null, response: null, reason: null };
  return JSON.stringify([
    normalized.status,
    normalized.justification,
    normalized.response,
    normalized.reason,
  ]);
}

function remoteTuples(resolution: FindingResolution): VexTuple[] {
  if (resolution.state !== "resolved") return [];
  return resolution.rows.map((row) => ({
    status: enumOrNull<VexStatus>(row.vexStatus, VEX_STATUSES, "finding.vex_status"),
    response: enumOrNull<VexResponse>(row.vexResponse, VEX_RESPONSES, "finding.vex_response"),
    justification: enumOrNull<VexJustification>(row.vexJustification, VEX_JUSTIFICATIONS, "finding.vex_justification"),
    reason: stripVexProvenance(row.vexReason),
  }));
}

function versionOf(resolution: FindingResolution): string | undefined {
  const rows = resolution.state === "resolved"
    ? resolution.rows
    : resolution.state === "stale"
      ? resolution.candidates
      : [];
  return rows.map((row) => row.componentVersion).find((version): version is string => version !== null);
}

function classifyRow(
  db: Database.Database,
  row: DriftRow,
  pvId: string,
  authoredComponents: ReadonlyMap<string, TriageOverlayV1["component"]>,
): DriftItem {
  if (row.local_state === "needs_completion") {
    return { stableKey: row.stable_key, state: "needs_completion", reason: "Local decision is incomplete and plan-blocked" };
  }
  const identity = componentIdentity(row, authoredComponents);
  const pin: Pin = row.pin === "any_version" ? "any_version" : "exact_version";
  const resolution = resolveFinding(db, {
    schema: "fs-finding-key/v1",
    project: row.project_id,
    ...identity,
  }, pvId, pin);
  const previousVersion = identity.version ?? undefined;
  if (resolution.state === "stale" || (resolution.state === "resolved" && pin === "exact_version" && resolution.versionChanged)) {
    return {
      stableKey: row.stable_key,
      state: "stale",
      reason: "Exact-version decision requires re-evaluation after the component version changed",
      previousVersion,
      currentVersion: versionOf(resolution),
    };
  }
  if (resolution.state === "orphaned") {
    return {
      stableKey: row.stable_key,
      state: "orphaned",
      reason: "Canonical resolver found no component/CVE match in the accepted generation",
      previousVersion,
    };
  }
  const localKey = tupleKey(tuple(row));
  const baseKey = tupleKey(baseTuple(row.sync_base));
  const remoteKeys = remoteTuples(resolution).map(tupleKey);
  const common = {
    stableKey: row.stable_key,
    tier: resolution.tier,
    previousVersion,
    currentVersion: versionOf(resolution),
  };
  if (remoteKeys.length > 0 && remoteKeys.every((remote) => remote === localKey)) {
    return { ...common, state: "reattached_noop", reason: "Resolved server VEX tuple already equals the local decision" };
  }
  const localChanged = localKey !== baseKey;
  const remoteChangedDifferently = remoteKeys.some((remote) => remote !== baseKey && remote !== localKey);
  if (localChanged && remoteChangedDifferently) {
    return { ...common, state: "conflict", reason: "Local and server VEX tuples both changed differently from the recorded base" };
  }
  return { ...common, state: "reapply", reason: "Canonical identity resolved but server carry-forward missed or differs" };
}

/** Classifies every decision while retaining only one bounded stable-key page in memory. */
export function classifyDrift(deps: DriftDeps, pvId: string): DriftReport {
  const limit = boundedDriftLimit(deps.limit);
  const totals = driftTotals();
  const items: DriftItem[] = [];
  let hasMore = false;
  const update = deps.db.prepare(
    `UPDATE overlay_index
        SET drift_state = ?, match_tier = ?
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'vexDecision' AND stable_key = ?`,
  );
  const select = deps.db.prepare(
    `SELECT project_id, stable_key, component_key, vex_status, vex_response, vex_justification,
            vex_reason, pin, sync_base, local_state, file_path
       FROM overlay_index
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'vexDecision'
        AND (? IS NULL OR stable_key > ?)
      ORDER BY stable_key ASC
      LIMIT 200`,
  );

  const authoredComponents = new Map<string, TriageOverlayV1["component"]>();
  if (deps.root !== undefined) {
    if (!isAbsolute(deps.root)) throw new TypeError("Drift root must be absolute");
    const root = realpathSync(deps.root);
    const files = deps.db.prepare(
      `SELECT DISTINCT file_path
         FROM overlay_index
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'vexDecision'
        ORDER BY file_path ASC`,
    ).all(deps.projectId, pvId) as Array<{ file_path: string }>;
    for (const { file_path: file } of files) {
      const absolute = resolve(root, file);
      if (!absolute.startsWith(`${root}${sep}`) || realpathSync(absolute) !== absolute) {
        throw new Error(`Overlay index path escapes the drift root: ${file}`);
      }
      const overlay = parseOverlayText(readFileSync(absolute, "utf8"), file);
      if (overlay.project !== deps.projectId) throw new Error(`Overlay project differs from drift scope: ${file}`);
      authoredComponents.set(file, overlay.component);
    }
  }

  deps.db.transaction(() => {
    let scanCursor: string | null = null;
    while (true) {
      const rows = select.all(deps.projectId, pvId, scanCursor, scanCursor) as DriftRow[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const item = classifyRow(deps.db, row, pvId, authoredComponents);
        totals[item.state] += 1;
        if (deps.updateIndex !== false) {
          const matchTier = item.tier === 1 ? "purl" : item.tier === 2 ? "nvg" : item.tier === 3 ? "ng" : null;
          update.run(item.state, matchTier, deps.projectId, pvId, item.stableKey);
        }
        if (deps.cursor !== undefined && deps.cursor !== null && item.stableKey <= deps.cursor) continue;
        if (items.length < limit) items.push(item);
        else hasMore = true;
      }
      scanCursor = rows.at(-1)?.stable_key ?? null;
      if (rows.length < 200) break;
    }
  })();

  return {
    pvId,
    totals,
    items,
    nextCursor: hasMore ? items.at(-1)?.stableKey ?? null : null,
  };
}
