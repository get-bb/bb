import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { rebuildOverlayIndex } from "./indexer.js";
import { readOverlayFiles } from "./reader.js";
import { stableKeyFor, type DecisionInput } from "./schema.js";
import { createOverlayWatcher, TRIAGE_OVERLAY_CHANGED_CHANNEL } from "./watcher.js";
import { setDecision } from "./writer.js";

const roots: string[] = [];
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fs-overlay-index-")));
  roots.push(root);
  const host = createFakePluginHost({ pluginId: `overlay-index-${hosts.length}` });
  hosts.push(host);
  return { root, db: createPluginContext(host.bb).db() };
}

function decision(): DecisionInput {
  const component = { purl: null, name: "busybox", group: null, version: "1.36.1" };
  const cve = "CVE-2026-700";
  return {
    project: "project-1",
    component,
    cve,
    stableKey: stableKeyFor("project-1", component, cve),
    status: "IN_TRIAGE",
    justification: null,
    response: null,
    reason: "review in progress",
    pin: "exact_version",
    provenance: { by: "engineer", at: "2026-08-13T09:00:00.000Z", evidence: "ticket FS-41" },
    sync: { base: { status: null, justification: null, response: null, reason: null }, pushed_at: null },
  };
}

describe("triage overlay indexer", () => {
  it("rebuilds YAML transactionally and removes rows after file deletion", async () => {
    const { root, db } = await fixture();
    const written = await setDecision(root, decision());
    await expect(rebuildOverlayIndex(db, root)).resolves.toEqual({ indexed: 1, errors: [] });
    const row = db.prepare("SELECT * FROM overlay_index").get() as Record<string, unknown>;
    expect(row).toMatchObject({
      project_id: "project-1",
      project_version_id: "@project",
      stable_key: decision().stableKey,
      file_path: written.file,
      vex_status: "IN_TRIAGE",
      local_state: "dirty",
      provenance_by: "engineer",
      evidence: "ticket FS-41",
    });
    db.prepare(
      `UPDATE overlay_index
          SET vex_status = 'EXPLOITABLE', local_state = 'pushed',
              drift_state = 'reapply', policy_warning_count = 2,
              policy_violation_count = 3`,
    ).run();
    await expect(rebuildOverlayIndex(db, root)).resolves.toEqual({ indexed: 1, errors: [] });
    expect(db.prepare(
      `SELECT vex_status, local_state, drift_state, policy_warning_count,
              policy_violation_count, indexed_at
         FROM overlay_index`,
    ).get()).toEqual({
      vex_status: "IN_TRIAGE",
      local_state: "dirty",
      drift_state: "reapply",
      policy_warning_count: 2,
      policy_violation_count: 3,
      indexed_at: expect.not.stringMatching(/^2026-08-13T09:00:00/u),
    });
    db.prepare("DELETE FROM overlay_index").run();
    await expect(rebuildOverlayIndex(db, root)).resolves.toEqual({ indexed: 1, errors: [] });
    expect(db.prepare("SELECT COUNT(*) AS count FROM overlay_index").get()).toEqual({ count: 1 });
    await rm(join(root, ".fs", "triage", "project-1"), { recursive: true, force: true });
    await expect(rebuildOverlayIndex(db, root)).resolves.toEqual({ indexed: 0, errors: [] });
    expect(db.prepare("SELECT COUNT(*) AS count FROM overlay_index").get()).toEqual({ count: 0 });

    await setDecision(root, decision());
    await rebuildOverlayIndex(db, root);
    await rm(join(root, ".fs"), { recursive: true, force: true });
    await expect(rebuildOverlayIndex(db, root)).resolves.toEqual({ indexed: 0, errors: [] });
    expect(db.prepare("SELECT COUNT(*) AS count FROM overlay_index").get()).toEqual({ count: 0 });
  });

  it("allows the same frozen stable key in separate project scopes", async () => {
    const { root, db } = await fixture();
    const first = decision();
    const second = { ...decision(), project: "project-2" };
    await setDecision(root, first);
    await setDecision(root, second);
    const parsed = await readOverlayFiles(root);
    expect(parsed.errors).toEqual([]);
    expect(parsed.files.map((file) => file.overlay.project)).toEqual(["project-1", "project-2"]);
    await expect(rebuildOverlayIndex(db, root)).resolves.toEqual({ indexed: 2, errors: [] });
    expect(db.prepare("SELECT project_id FROM overlay_index ORDER BY project_id").all())
      .toEqual([{ project_id: "project-1" }, { project_id: "project-2" }]);
  });

  it("isolates malformed siblings and reports duplicate YAML keys with a line", async () => {
    const { root, db } = await fixture();
    await setDecision(root, decision());
    const directory = join(root, ".fs", "triage", "project-1");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "bad.yaml"), `schema: fs-triage/v1
schema: fs-triage/v1
project: project-1
component: {purl: null, name: bad, group: null, version: null}
decisions: {}
`, "utf8");
    const report = await rebuildOverlayIndex(db, root);
    expect(report.indexed).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ file: ".fs/triage/project-1/bad.yaml" });
    expect(report.errors[0]?.line).not.toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS count FROM overlay_index").get()).toEqual({ count: 1 });
  });

  it("uses the full-domain resolver and marks exact-version changes stale", async () => {
    const { root, db } = await fixture();
    await setDecision(root, decision());
    const at = "2026-08-13T09:30:00.000Z";
    db.prepare(
      `INSERT INTO pull_generation
        (project_id, project_version_id, generation_id, status, requested_kinds_json,
         started_at, completed_at, accepted_at, error)
       VALUES ('project-1', 'pv-2', 'generation-2', 'accepted', '["finding"]', ?, ?, ?, NULL)`,
    ).run(at, at, at);
    db.prepare(
      `INSERT INTO sync_state
        (project_id, project_version_id, entity_kind, accepted_generation_id,
         staging_generation_id, base_revision, staging_continuation, staged_pages,
         staged_rows, last_pull, error)
       VALUES ('project-1', 'pv-2', 'finding', 'generation-2', NULL, 1, NULL, 0, 1, ?, NULL)`,
    ).run(at);
    db.prepare(
      `INSERT INTO findings
        (project_id, project_version_id, generation_id, finding_id, stable_key,
         cve, component_name, component_group, component_version, component_purl,
         raw, pulled_at)
       VALUES ('project-1', 'pv-2', 'generation-2', 'finding-2', ?,
               'CVE-2026-700', 'BUSYBOX', NULL, '2.0.0', NULL, '{}', ?)`,
    ).run(decision().stableKey, at);
    await rebuildOverlayIndex(db, root);
    expect(db.prepare(
      "SELECT local_state, match_tier FROM overlay_index WHERE project_version_id = 'pv-2'",
    ).get()).toEqual({ local_state: "stale", match_tier: null });
  });

  it("coalesces a watcher burst into one rebuild and refetch hint", async () => {
    const { root, db } = await fixture();
    await setDecision(root, decision());
    const hints: Array<{ channel: string; payload: null }> = [];
    const watcher = createOverlayWatcher({
      db,
      root,
      debounceMs: 1_000,
      publish(channel, payload) { hints.push({ channel, payload }); },
    });
    watcher.notify();
    watcher.notify();
    watcher.notify();
    await watcher.flush();
    watcher.close();
    expect(hints).toEqual([{ channel: TRIAGE_OVERLAY_CHANGED_CHANNEL, payload: null }]);
    const file = db.prepare("SELECT file_path FROM overlay_index").get() as { file_path: string };
    expect(await readFile(join(root, file.file_path), "utf8")).toContain("fs-triage/v1");
  });
});
