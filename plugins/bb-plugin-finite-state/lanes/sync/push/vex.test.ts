import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { RemoteLimiter } from "../../../lib/remote/rate-limit.js";
import type { PlatformClient, VexDecisionInput } from "../../../lib/remote/types.js";
import { ENTITIES } from "../../../lib/sync/registry.js";
import type { JsonValue } from "../../../shared/contract.js";
import { syncMetadata } from "../engine/status.js";
import type { FieldDiff, FieldValue, Plan, PlanItem } from "../plan/index.js";
import { canonicalJson, contentHash } from "../serialize/canonical.js";
import { createSerializer } from "../serialize/serializer.js";
import { BaseSnapshotStore } from "../store/base-snapshot.js";
import { push } from "./index.js";
import { createVexPusher } from "./vex.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];
const PROJECT = "project-vex-push";
const VERSION = "version-vex-push";
const GENERATION = "generation-vex-push";
const PULLED_AT = "2026-08-13T02:00:00.000Z";
const BEFORE = { status: "IN_TRIAGE", response: null, justification: null, reason: "before" };
const AFTER = { status: "RESOLVED", response: null, justification: null, reason: "human rationale" };
const HASH_OPTIONS = { idToSlug: (_id: string): null => null, onWarning: (): void => undefined };

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function value(payload: Record<string, JsonValue>, field: string): FieldValue {
  return Object.hasOwn(payload, field)
    ? { present: true, value: payload[field] ?? null }
    : { present: false, value: null };
}

function changedFields(base: Record<string, JsonValue>, ours: Record<string, JsonValue>): FieldDiff[] {
  return [...new Set([...Object.keys(base), ...Object.keys(ours)])].sort().map((field) => ({
    field,
    base: value(base, field),
    ours: value(ours, field),
    theirs: value(base, field),
  })).filter((field) => canonicalJson(field.base) !== canonicalJson(field.ours));
}

function limiter(): RemoteLimiter {
  return new RemoteLimiter({
    concurrency: 1,
    maxAttempts: 1,
    maxBackoffMs: 1,
    scheduler: { now: Date.now, sleep: async (): Promise<void> => undefined },
    random: () => 0,
  });
}

function unsigned(plan: Plan): Omit<Plan, "planSha256"> {
  const { planSha256: _ignored, ...rest } = plan;
  return rest;
}

describe("VEX resumable push", () => {
  it("chunks 501 decisions as 500+1 and advances only successful outcomes", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-wp19-vex" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const root = await mkdtemp(join(tmpdir(), "finite-state-wp19-vex-"));
    roots.push(root);
    db.prepare(
      `INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status,
          requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?)`,
    ).run(PROJECT, VERSION, GENERATION, JSON.stringify(["finding", "vexDecision"]), PULLED_AT, PULLED_AT, PULLED_AT);
    const insertState = db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id, base_revision, last_pull)
       VALUES (?, ?, ?, ?, 0, ?)`,
    );
    insertState.run(PROJECT, VERSION, "finding", GENERATION, PULLED_AT);
    insertState.run(PROJECT, VERSION, "vexDecision", GENERATION, PULLED_AT);

    const insertFinding = db.prepare(
      `INSERT INTO findings
         (project_id, project_version_id, generation_id, finding_id, stable_key,
          cve, component_purl, vex_status, vex_reason, raw, pulled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertBase = db.prepare(
      `INSERT INTO base_snapshot
         (project_id, project_version_id, entity_kind, generation_id,
          entity_key, remote_id, payload, content_hash, pulled_at)
       VALUES (?, ?, 'vexDecision', ?, ?, ?, ?, ?, ?)`,
    );
    const insertMap = db.prepare(
      `INSERT INTO id_map
         (project_id, project_version_id, entity_kind, generation_id,
          entity_key, remote_id, pulled_at)
       VALUES (?, ?, 'vexDecision', ?, ?, ?, ?)`,
    );
    const details = new Map<string, Record<string, JsonValue>>();
    const items: PlanItem[] = [];
    const beforeHash = createSerializer("vexDecision").contentHash(BEFORE, HASH_OPTIONS);
    db.transaction(() => {
      for (let index = 0; index < 501; index += 1) {
        const findingId = String(10_000 + index);
        const cve = `CVE-2026-${String(index).padStart(4, "0")}`;
        const purl = `pkg:npm/component-${index}@1.0.0`;
        const key = ENTITIES.vexDecision.key({ cve, purl, name: `component-${index}`, group: null, version: "1.0.0" });
        const detail = {
          id: findingId,
          cve,
          componentId: `component-${index}`,
          componentFallbackIdentity: `component-${index}`,
          componentPurl: purl,
          vexStatus: BEFORE.status,
          vexResponse: null,
          vexJustification: null,
          vexReason: BEFORE.reason,
        } satisfies Record<string, JsonValue>;
        details.set(findingId, detail);
        insertFinding.run(
          PROJECT, VERSION, GENERATION, findingId, key, cve, purl,
          BEFORE.status, BEFORE.reason, canonicalJson(detail), PULLED_AT,
        );
        insertBase.run(
          PROJECT, VERSION, GENERATION, key, findingId,
          canonicalJson(BEFORE), beforeHash, PULLED_AT,
        );
        insertMap.run(PROJECT, VERSION, GENERATION, key, findingId, PULLED_AT);
        items.push({
          projectId: PROJECT,
          projectVersionId: VERSION,
          kind: "vexDecision",
          key,
          label: cve,
          operation: "update",
          expectedBaseContentHash: beforeHash,
          fields: changedFields(BEFORE, AFTER),
          conflicts: [],
          referrers: [],
          error: null,
        });
      }
    })();

    const metadata = syncMetadata({ db }, { projectId: PROJECT, projectVersionId: VERSION }, ["vexDecision"]);
    const draft: Plan = {
      projectId: PROJECT,
      projectVersionId: VERSION,
      planId: "01K00000000000000000000042",
      planSha256: "",
      baseGenerationIds: metadata.acceptedGenerationIds,
      baseRevisions: metadata.baseRevisions,
      baseStateSha256: metadata.baseStateSha256,
      createdAt: PULLED_AT,
      staleness: { asOf: PULLED_AT, degraded: false },
      items,
      summary: { creates: 0, updates: 501, deletes: 0, noops: 0, conflicts: 0, orphans: 0 },
      blastRadius: {
        requiresHumanReview: true,
        changed: 501,
        deletes: 0,
        remoteCalls: 501,
        surfaces: ["vexDecision"],
      },
      validationErrors: [],
      total: 501,
      next: null,
      cache: {
        state: "fresh",
        asOf: PULLED_AT,
        message: null,
        acceptedGenerationId: GENERATION,
        baseRevision: 0,
      },
    };
    const plan = { ...draft, planSha256: contentHash(unsigned(draft)) };
    await mkdir(join(root, ".fs-sync"), { recursive: true });
    await writeFile(join(root, ".fs-sync", `plan-${plan.planId}.json`), `${JSON.stringify(plan)}\n`);

    const batchSizes: number[] = [];
    const sentReasons: string[] = [];
    const client = {
      async batchSetVexStatus(input: { projectVersionId: string; findings: VexDecisionInput[] }) {
        expect(input.projectVersionId).toBe(VERSION);
        batchSizes.push(input.findings.length);
        const fail = batchSizes.length === 2;
        for (const finding of input.findings) {
          sentReasons.push(finding.reason ?? "");
          if (!fail) {
            const detail = details.get(finding.findingId);
            if (detail !== undefined) {
              detail["vexStatus"] = finding.status;
              detail["vexResponse"] = finding.response ?? null;
              detail["vexJustification"] = finding.justification ?? null;
              detail["vexReason"] = finding.reason ?? null;
            }
          }
        }
        return {
          status: fail ? "failure" as const : "success" as const,
          summary: {
            total: input.findings.length,
            succeeded: fail ? 0 : input.findings.length,
            failed: fail ? input.findings.length : 0,
          },
          results: input.findings.map((finding) => ({
            findingId: finding.findingId,
            success: !fail,
            status: fail ? null : finding.status,
            error: fail ? "injected item failure" : null,
          })),
        };
      },
      async clearVexStatus(): Promise<void> { return undefined; },
      async getFindingDetail(input: { projectVersionId: string; findingId: string }) {
        expect(input.projectVersionId).toBe(VERSION);
        const detail = details.get(input.findingId);
        if (detail === undefined) throw new Error("missing fake finding");
        return structuredClone(detail);
      },
    } satisfies Pick<PlatformClient, "batchSetVexStatus" | "clearVexStatus" | "getFindingDetail">;
    const runId = "vex-501-run";
    const report = await push({
      db,
      worktreeRoot: root,
      pushers: [createVexPusher({ db, client, limiter: limiter() })],
      createRunId: () => runId,
    }, {
      scope: { projectId: PROJECT, projectVersionId: VERSION },
      planId: plan.planId,
      expectedPlanSha256: plan.planSha256,
      expectedBaseStateSha256: plan.baseStateSha256,
      confirmed: true,
    });

    expect(batchSizes).toEqual([500, 1]);
    expect(sentReasons).toHaveLength(501);
    expect(sentReasons.every((reason) => reason === `[bb:${runId}] ${AFTER.reason}`)).toBe(true);
    expect(report.status).toBe("partial");
    expect(report.summary).toEqual({ total: 501, applied: 500, failed: 1, skipped: 0 });
    const base = new BaseSnapshotStore(db);
    expect(base.getAccepted(PROJECT, VERSION, "vexDecision", items[0]?.key ?? "")?.payload).toEqual(AFTER);
    expect(base.getAccepted(PROJECT, VERSION, "vexDecision", items[500]?.key ?? "")?.payload).toEqual(BEFORE);
    expect(metadata.baseRevisions).toEqual({ vexDecision: 0 });
    expect(syncMetadata({ db }, { projectId: PROJECT, projectVersionId: VERSION }, ["vexDecision"]).baseRevisions)
      .toEqual({ vexDecision: 500 });
  });

  it("treats void bulk clear as unverified until read-back proves absence", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-wp19-vex-clear" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const findingId = "44001";
    const cve = "CVE-2026-4401";
    const purl = "pkg:npm/clear-me@1.0.0";
    const key = ENTITIES.vexDecision.key({ cve, purl, name: "clear-me", group: null, version: "1.0.0" });
    db.prepare(
      `INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status,
          requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES (?, ?, ?, 'accepted', '["finding"]', ?, ?, ?)`,
    ).run(PROJECT, VERSION, GENERATION, PULLED_AT, PULLED_AT, PULLED_AT);
    db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id, base_revision, last_pull)
       VALUES (?, ?, 'finding', ?, 0, ?)`,
    ).run(PROJECT, VERSION, GENERATION, PULLED_AT);
    const detail: Record<string, JsonValue> = {
      id: findingId,
      cve,
      componentId: "clear-me",
      componentFallbackIdentity: "clear-me",
      componentPurl: purl,
      vexStatus: BEFORE.status,
      vexResponse: null,
      vexJustification: null,
      vexReason: BEFORE.reason,
    };
    db.prepare(
      `INSERT INTO findings
         (project_id, project_version_id, generation_id, finding_id, stable_key,
          cve, component_purl, vex_status, vex_reason, raw, pulled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      PROJECT, VERSION, GENERATION, findingId, key, cve, purl,
      BEFORE.status, BEFORE.reason, canonicalJson(detail), PULLED_AT,
    );
    const cleared: string[][] = [];
    const client = {
      async batchSetVexStatus() { throw new Error("unexpected VEX set"); },
      async clearVexStatus(input: { projectVersionId: string; findingIds: string[] }): Promise<void> {
        expect(input.projectVersionId).toBe(VERSION);
        cleared.push(input.findingIds);
        detail["vexStatus"] = null;
        detail["vexResponse"] = null;
        detail["vexJustification"] = null;
        detail["vexReason"] = null;
      },
      async getFindingDetail() { return structuredClone(detail); },
    } satisfies Pick<PlatformClient, "batchSetVexStatus" | "clearVexStatus" | "getFindingDetail">;
    const pusher = createVexPusher({ db, client, limiter: limiter() });
    const item: PlanItem = {
      projectId: PROJECT,
      projectVersionId: VERSION,
      kind: "vexDecision",
      key,
      label: cve,
      operation: "delete",
      expectedBaseContentHash: "planned-base-hash",
      fields: [],
      conflicts: [],
      referrers: [],
      error: null,
    };
    const context = {
      runId: "vex-clear-run",
      scope: { projectId: PROJECT, projectVersionId: VERSION },
    };

    const outcome = (await pusher.applyBatch([item], context))[0];

    expect(cleared).toEqual([[findingId]]);
    expect(outcome).toMatchObject({ error: null, result: { verification: "required" } });
    await expect(pusher.readBack(item, context)).resolves.toEqual({
      exists: false,
      remoteId: null,
      payload: null,
    });
  });
});
