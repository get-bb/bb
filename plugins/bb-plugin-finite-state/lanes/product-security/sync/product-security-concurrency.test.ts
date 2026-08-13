import { readFileSync } from "node:fs";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import type { Plan, PlanItem } from "../../sync/plan/index.js";
import type { EntityPusher, PushContext, PushReport } from "../../sync/push/types.js";
import { pushProductSecurity, withProductSecurityHeadFence } from "./pusher.js";
import { transitionReview } from "./review.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())); });

function item(key: string): PlanItem { return { projectId: "p1", projectVersionId: "v1", kind: "threat", key, label: key, operation: "update", expectedBaseContentHash: "hash", fields: [], conflicts: [], referrers: [], error: null }; }
function context(): PushContext { return { runId: "push-1", scope: { projectId: "p1", projectVersionId: "v1" } }; }

describe("product security head-only concurrency", () => {
  it("aborts on head mismatch before writes", async () => {
    let writes = 0;
    const plan = { items: [item("one")] } as Plan;
    await expect(pushProductSecurity({ ...context(), currentFence: () => ({ headVersionId: "head-2" }), execute: async () => { writes += 1; return {} as PushReport; } }, plan, { headVersionId: "head-1" })).rejects.toThrow(/STALE_TARA_STATE/);
    expect(writes).toBe(0);
  });

  it("orders rows inside the local head bracket and detects a moved commit head", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-wp40-head" }); hosts.push(host);
    const db = createPluginContext(host.bb).db();
    db.prepare(`INSERT INTO pull_generation (project_id,project_version_id,generation_id,status,requested_kinds_json,started_at,completed_at,accepted_at) VALUES ('p1','v1','generation-1','accepted','["threat"]','2026-08-13','2026-08-13','2026-08-13')`).run();
    db.prepare(`INSERT INTO sync_state (project_id,project_version_id,entity_kind,accepted_generation_id,base_revision) VALUES ('p1','v1','threat','generation-1',3)`).run();
    const calls: string[] = [];
    const base: EntityPusher = { kind: "threat", maxConcurrency: 8, async apply(planItem) { calls.push(planItem.key); db.prepare(`UPDATE sync_state SET base_revision=base_revision+1 WHERE project_id='p1' AND project_version_id='v1' AND entity_kind='threat'`).run(); return { remoteId: planItem.key, serverPayload: {}, verification: "response-is-authoritative" }; }, async readBack() { return { exists: true, remoteId: "remote", payload: {} }; } };
    const fenced = withProductSecurityHeadFence(db, base); const items = [item("one"), item("two")]; const ctx = context();
    const token = await fenced.beginGroup!(items, ctx);
    for (const planItem of items) await fenced.apply(planItem, ctx, token);
    await expect(fenced.commitGroup!(items, ctx, token)).resolves.toBeUndefined(); expect(calls).toEqual(["one", "two"]); expect(fenced.maxConcurrency).toBe(1);
    const secondToken = await fenced.beginGroup!([item("three")], ctx); db.prepare(`UPDATE sync_state SET base_revision=99 WHERE project_id='p1'`).run();
    await expect(fenced.commitGroup!([item("three")], ctx, secondToken)).rejects.toThrow(/STALE_TARA_STATE/);
  });

  it("retries review conflicts with refreshed review_version and no entity version", async () => {
    const sent: string[] = [];
    const result = await transitionReview({
      async send(input) { sent.push(input.expectedReviewVersion); if (sent.length === 1) throw Object.assign(new Error("conflict"), { status: 409 }); return "approved"; },
      async refresh() { return { reviewVersion: "9007199254740993" }; },
      isConflict(error) { return typeof error === "object" && error !== null && Reflect.get(error, "status") === 409; },
    }, { entityId: "threat-1", operationId: "op-1", expectedReviewVersion: "4", action: "approve" });
    expect(result).toBe("approved"); expect(sent).toEqual(["4", "9007199254740993"]);
  });

  it("contains no agents-only trial call or entity_version substitution", () => {
    const sources = ["checkpoint.ts", "pusher.ts", "review.ts"]
      .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8"))
      .join("\n");
    expect(sources).not.toContain(["begin", "tara", "trial"].join("_"));
    expect(sources).not.toContain(["entity", "version"].join("_"));
    expect(sources).toContain("expectedReviewVersion");
  });
});
