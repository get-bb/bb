import { readFileSync } from "node:fs";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import type { PlanItem } from "../../sync/plan/index.js";
import { BaseSnapshotStore } from "../../sync/store/base-snapshot.js";
import type { EntityPusher, PushContext } from "../../sync/push/types.js";
import { withProductSecurityHeadFence } from "./pusher.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())); });

function item(key: string): PlanItem { return { projectId: "p1", projectVersionId: "v1", kind: "threat", key, label: key, operation: "update", expectedBaseContentHash: "hash", fields: [], conflicts: [], referrers: [], error: null }; }
function context(): PushContext { return { runId: "push-1", scope: { projectId: "p1", projectVersionId: "v1" } }; }

describe("product security head-only concurrency", () => {
  it("requires an accepted head before any row writes", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-wp40-no-head" }); hosts.push(host);
    const db = createPluginContext(host.bb).db();
    let writes = 0;
    const fenced = withProductSecurityHeadFence(db, { kind: "threat", maxConcurrency: 8, async apply() { writes += 1; return { remoteId: "remote", serverPayload: {}, verification: "response-is-authoritative" }; }, async readBack() { return { exists: false, remoteId: null, payload: null }; } });
    await expect(fenced.beginGroup!([item("one")], context())).rejects.toThrow(/STALE_TARA_STATE/u);
    expect(writes).toBe(0);
  });

  it("brackets real per-row base advances and detects a moved accepted head", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-wp40-head" }); hosts.push(host);
    const db = createPluginContext(host.bb).db();
    db.prepare(`INSERT INTO pull_generation (project_id,project_version_id,generation_id,status,requested_kinds_json,started_at,completed_at,accepted_at) VALUES ('p1','v1','generation-1','accepted','["threat"]','2026-08-13','2026-08-13','2026-08-13')`).run();
    db.prepare(`INSERT INTO sync_state (project_id,project_version_id,entity_kind,accepted_generation_id,base_revision) VALUES ('p1','v1','threat','generation-1',3)`).run();
    const store = new BaseSnapshotStore(db); const calls: string[] = [];
    const base: EntityPusher = { kind: "threat", maxConcurrency: 8, async apply(planItem) {
      calls.push(planItem.key);
      const revision = Number(db.prepare(`SELECT base_revision FROM sync_state WHERE project_id='p1' AND project_version_id='v1' AND entity_kind='threat'`).pluck().get());
      store.advanceAccepted("p1", "v1", "threat", planItem.key, { generationId: "generation-1", baseRevision: revision, contentHash: null }, { payload: { slug: planItem.key, title: planItem.key }, remoteId: `remote-${planItem.key}`, pulledAt: "2026-08-13T12:00:00.000Z" });
      return { remoteId: planItem.key, serverPayload: {}, verification: "response-is-authoritative" };
    }, async readBack() { return { exists: true, remoteId: "remote", payload: {} }; } };
    const fenced = withProductSecurityHeadFence(db, base); const items = [item("one"), item("two")]; const ctx = context();
    const token = await fenced.beginGroup!(items, ctx);
    for (const planItem of items) await fenced.apply(planItem, ctx, token);
    await expect(fenced.commitGroup!(items, ctx, token)).resolves.toBeUndefined(); expect(calls).toEqual(["one", "two"]); expect(fenced.maxConcurrency).toBe(1);
    const secondToken = await fenced.beginGroup!([item("three")], ctx); db.prepare(`UPDATE sync_state SET base_revision=99 WHERE project_id='p1'`).run();
    await expect(fenced.commitGroup!([item("three")], ctx, secondToken)).rejects.toThrow(/STALE_TARA_STATE/);
  });

  it("contains no agents-only trial call or entity_version substitution", () => {
    const sources = ["checkpoint.ts", "pusher.ts", "review.ts"]
      .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8"))
      .join("\n");
    expect(sources).not.toContain(["begin", "tara", "trial"].join("_"));
    expect(sources).not.toContain(["entity", "version"].join("_"));
    expect(sources).toContain("expectedReviewVersion");
    expect(sources).toContain('REVIEW_TRANSITION_REGISTRATION = "unavailable"');
  });
});
