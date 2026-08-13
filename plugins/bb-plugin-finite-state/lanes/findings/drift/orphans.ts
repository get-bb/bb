import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

import { canonicalJson } from "../../sync/serialize/canonical.js";
import { readOverlayFiles } from "../overlay/reader.js";
import { rebuildOverlayIndex } from "../overlay/indexer.js";
import { stableKeyFor } from "../overlay/schema.js";
import { removeDecision } from "../overlay/writer.js";

export interface OrphanDeps {
  db: Database.Database;
  root: string;
  projectId: string;
  pvId: string;
}

export interface OrphanPruneOptions {
  stableKeys: readonly string[];
  dryRun: boolean;
  confirmed: boolean;
  expectedBaseStateSha256: string;
}

export interface OrphanPruneResult {
  baseStateSha256: string;
  selected: number;
  pruned: number;
  files: string[];
}

interface OrphanRow {
  stable_key: string;
  file_path: string;
  file_sha256: string;
}

function digest(rows: readonly OrphanRow[]): string {
  return createHash("sha256").update(canonicalJson(rows.map((row) => ({
    stableKey: row.stable_key,
    file: row.file_path,
    sha256: row.file_sha256,
  })))).digest("hex");
}

export function orphanBaseState(db: Database.Database, projectId: string, pvId: string): {
  rows: OrphanRow[];
  sha256: string;
} {
  const rows = db.prepare(
    `SELECT stable_key, file_path, file_sha256
       FROM overlay_index
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'vexDecision' AND drift_state = 'orphaned'
      ORDER BY stable_key ASC`,
  ).all(projectId, pvId) as OrphanRow[];
  return { rows, sha256: digest(rows) };
}

/** Explicitly removes only still-proven orphan decisions; listing and classification never call this. */
export async function pruneOrphans(deps: OrphanDeps, options: OrphanPruneOptions): Promise<OrphanPruneResult> {
  if (options.stableKeys.length === 0 || options.stableKeys.length > 500) {
    throw new TypeError("Orphan prune requires between 1 and 500 stable keys");
  }
  if (!options.dryRun && !options.confirmed) {
    throw new Error("ORPHAN_PRUNE_CONFIRMATION_REQUIRED");
  }
  const state = orphanBaseState(deps.db, deps.projectId, deps.pvId);
  if (state.sha256 !== options.expectedBaseStateSha256) throw new Error("ORPHAN_BASE_STATE_CHANGED");
  const selected = new Set(options.stableKeys);
  const proven = state.rows.filter((row) => selected.has(row.stable_key));
  if (proven.length !== selected.size) throw new Error("ORPHAN_SELECTION_NOT_PROVEN");
  if (options.dryRun) {
    return {
      baseStateSha256: state.sha256,
      selected: proven.length,
      pruned: 0,
      files: [...new Set(proven.map((row) => row.file_path))].sort(),
    };
  }

  const overlays = await readOverlayFiles(deps.root);
  if (overlays.errors.length > 0) throw new Error("ORPHAN_OVERLAY_PARSE_FAILED");
  const authored = new Map<string, {
    project: string;
    component: (typeof overlays.files)[number]["overlay"]["component"];
    cve: string;
    file: string;
    sha256: string;
  }>();
  for (const parsed of overlays.files) {
    if (parsed.overlay.project !== deps.projectId) continue;
    for (const cve of Object.keys(parsed.overlay.decisions)) {
      const stableKey = stableKeyFor(parsed.overlay.project, parsed.overlay.component, cve);
      authored.set(stableKey, {
        project: parsed.overlay.project,
        component: parsed.overlay.component,
        cve,
        file: parsed.file,
        sha256: parsed.sha256,
      });
    }
  }
  const chainedSha = new Map<string, string>();
  const files = new Set<string>();
  for (const row of proven) {
    const entry = authored.get(row.stable_key);
    if (entry === undefined || entry.file !== row.file_path || entry.sha256 !== row.file_sha256) {
      throw new Error("ORPHAN_OVERLAY_CHANGED");
    }
    const expected = chainedSha.get(entry.file) ?? entry.sha256;
    const result = await removeDecision(deps.root, {
      project: entry.project,
      component: entry.component,
      cve: entry.cve,
      stableKey: row.stable_key,
    }, expected);
    chainedSha.set(entry.file, result.afterSha256);
    files.add(result.file);
  }
  await rebuildOverlayIndex(deps.db, deps.root);
  return {
    baseStateSha256: state.sha256,
    selected: proven.length,
    pruned: proven.length,
    files: [...files].sort(),
  };
}
