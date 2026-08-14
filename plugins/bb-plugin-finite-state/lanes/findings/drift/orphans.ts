import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

import { canonicalJson } from "../../sync/serialize/canonical.js";
import { classifyDrift } from "./classify.js";
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
  expectedBaseStateSha256: string;
}

export interface OrphanPruneResult {
  baseStateSha256: string;
  selected: number;
  pruned: number;
  files: string[];
  results: Array<{
    stableKey: string;
    success: boolean;
    error: {
      code: string;
      message: string;
      artifactId: string | null;
      line: number | null;
    } | null;
  }>;
}

interface OrphanRow {
  stable_key: string;
  file_path: string;
  file_sha256: string;
}

function digest(rows: readonly OrphanRow[]): string {
  return createHash("sha256")
    .update(
      canonicalJson(
        rows.map((row) => ({
          stableKey: row.stable_key,
          file: row.file_path,
          sha256: row.file_sha256,
        })),
      ),
    )
    .digest("hex");
}

export function orphanBaseState(
  db: Database.Database,
  projectId: string,
  pvId: string,
): {
  rows: OrphanRow[];
  sha256: string;
} {
  const rows = db
    .prepare(
      `SELECT stable_key, file_path, file_sha256
       FROM overlay_index
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'vexDecision' AND drift_state = 'orphaned'
      ORDER BY stable_key ASC`,
    )
    .all(projectId, pvId) as OrphanRow[];
  return { rows, sha256: digest(rows) };
}

/** Explicitly removes only still-proven orphan decisions; listing and classification never call this. */
export async function pruneOrphans(
  deps: OrphanDeps,
  options: OrphanPruneOptions,
): Promise<OrphanPruneResult> {
  if (options.stableKeys.length === 0 || options.stableKeys.length > 500) {
    throw new TypeError("Orphan prune requires between 1 and 500 stable keys");
  }
  const state = orphanBaseState(deps.db, deps.projectId, deps.pvId);
  if (state.sha256 !== options.expectedBaseStateSha256)
    throw new Error("ORPHAN_BASE_STATE_CHANGED");
  const selected = new Set(options.stableKeys);
  const proven = state.rows.filter((row) => selected.has(row.stable_key));
  if (proven.length !== selected.size)
    throw new Error("ORPHAN_SELECTION_NOT_PROVEN");
  const overlays = await readOverlayFiles(deps.root);
  if (overlays.errors.length > 0)
    throw new Error("ORPHAN_OVERLAY_PARSE_FAILED");
  const authored = new Map<
    string,
    {
      project: string;
      component: (typeof overlays.files)[number]["overlay"]["component"];
      cve: string;
      file: string;
      sha256: string;
    }
  >();
  for (const parsed of overlays.files) {
    if (parsed.overlay.project !== deps.projectId) continue;
    for (const cve of Object.keys(parsed.overlay.decisions)) {
      const stableKey = stableKeyFor(
        parsed.overlay.project,
        parsed.overlay.component,
        cve,
      );
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
  const actions: Array<{
    stableKey: string;
    project: string;
    component: (typeof overlays.files)[number]["overlay"]["component"];
    cve: string;
    file: string;
    sha256: string;
  }> = [];
  for (const row of proven) {
    const entry = authored.get(row.stable_key);
    if (
      entry === undefined ||
      entry.file !== row.file_path ||
      entry.sha256 !== row.file_sha256
    ) {
      throw new Error("ORPHAN_OVERLAY_CHANGED");
    }
    actions.push({
      stableKey: row.stable_key,
      project: entry.project,
      component: entry.component,
      cve: entry.cve,
      file: entry.file,
      sha256: entry.sha256,
    });
  }
  const results: OrphanPruneResult["results"] = [];
  for (const action of actions) {
    try {
      const expected = chainedSha.get(action.file) ?? action.sha256;
      const result = await removeDecision(
        deps.root,
        {
          project: action.project,
          component: action.component,
          cve: action.cve,
          stableKey: action.stableKey,
        },
        expected,
      );
      chainedSha.set(action.file, result.afterSha256);
      files.add(result.file);
      results.push({ stableKey: action.stableKey, success: true, error: null });
    } catch (cause) {
      const code =
        typeof cause === "object" &&
        cause !== null &&
        typeof Reflect.get(cause, "code") === "string"
          ? String(Reflect.get(cause, "code")).slice(0, 512)
          : "ORPHAN_PRUNE_FAILED";
      results.push({
        stableKey: action.stableKey,
        success: false,
        error: {
          code,
          message: "The local YAML decision could not be pruned",
          artifactId: action.file,
          line: null,
        },
      });
    }
  }
  const pruned = results.filter((result) => result.success).length;
  if (pruned > 0) {
    await rebuildOverlayIndex(deps.db, deps.root);
    classifyDrift(
      { db: deps.db, root: deps.root, projectId: deps.projectId },
      deps.pvId,
    );
  }
  return {
    baseStateSha256: state.sha256,
    selected: proven.length,
    pruned,
    files: [...files].sort(),
    results,
  };
}
