import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { rebuildOverlayIndex } from "../overlay/indexer.js";
import { readOverlayFiles } from "../overlay/reader.js";
import { stableKeyFor } from "../overlay/schema.js";
import { setDecision } from "../overlay/writer.js";
import { classifyDrift, readDriftReport } from "./classify.js";
import { orphanBaseState, pruneOrphans } from "./orphans.js";

const PROJECT = "project-orphans";
const PV = "pv-orphans";
const GENERATION = "generation-orphans";
const AT = "2026-08-13T14:00:00.000Z";
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

describe("orphan pruning", () => {
  it("is digest gated and removes only explicitly selected proven orphans", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "fs-orphans-")));
    roots.push(root);
    const host = createFakePluginHost({ pluginId: "orphan-prune" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    db.prepare(
      `INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status, requested_kinds_json,
          started_at, completed_at, accepted_at, error)
       VALUES (?, ?, ?, 'accepted', '["finding"]', ?, ?, ?, NULL)`,
    ).run(PROJECT, PV, GENERATION, AT, AT, AT);
    db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id,
          staging_generation_id, base_revision, staging_continuation, staged_pages,
          staged_rows, last_pull, error)
       VALUES (?, ?, 'finding', ?, NULL, 1, NULL, 0, 0, ?, NULL)`,
    ).run(PROJECT, PV, GENERATION, AT);
    const component = {
      purl: null,
      name: "removed",
      group: "acme",
      version: "1",
    };
    const keys: string[] = [];
    let sha: string | undefined;
    for (const cve of ["CVE-ORPHAN-1", "CVE-ORPHAN-2"]) {
      const key = stableKeyFor(PROJECT, component, cve);
      keys.push(key);
      const result = await setDecision(
        root,
        {
          project: PROJECT,
          component,
          cve,
          stableKey: key,
          status: "IN_TRIAGE",
          justification: null,
          response: null,
          reason: `Retained evidence for ${cve}`,
          provenance: { by: "engineer", at: AT, evidence: "ticket FS-44" },
        },
        sha,
      );
      sha = result.afterSha256;
    }
    await rebuildOverlayIndex(db, root);
    const beforePrune = classifyDrift({ db, root, projectId: PROJECT }, PV);
    expect(beforePrune.totals.orphaned).toBe(2);
    const state = orphanBaseState(db, PROJECT, PV);
    const deps = { db, root, projectId: PROJECT, pvId: PV };
    await expect(
      pruneOrphans(deps, {
        stableKeys: [keys[0] ?? ""],
        expectedBaseStateSha256: "f".repeat(64),
      }),
    ).rejects.toThrow("ORPHAN_BASE_STATE_CHANGED");
    await expect(
      pruneOrphans(deps, {
        stableKeys: [keys[0] ?? ""],
        expectedBaseStateSha256: state.sha256,
      }),
    ).resolves.toMatchObject({
      selected: 1,
      pruned: 1,
      results: [{ stableKey: keys[0], success: true, error: null }],
    });
    expect(
      Object.keys(
        (await readOverlayFiles(root)).files[0]?.overlay.decisions ?? {},
      ),
    ).toEqual(["CVE-ORPHAN-2"]);
    expect(
      orphanBaseState(db, PROJECT, PV).rows.map((row) => row.stable_key),
    ).toEqual([keys[1]]);
    const afterPrune = readDriftReport({ db, projectId: PROJECT }, PV);
    expect(afterPrune).toMatchObject({
      totals: { orphaned: 1 },
      unclassifiedCount: 0,
    });
    expect(afterPrune.runId).not.toBe(beforePrune.runId);
    expect(afterPrune.items.map((item) => item.stableKey)).toEqual([keys[1]]);
  });
});
