import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import type { Scheduler } from "../../../lib/remote/rate-limit.js";
import {
  RemoteError,
  type Json,
  type PlatformClient,
  type VexBulkSetResult,
  type VexDecisionInput,
} from "../../../lib/remote/types.js";
import { findingStableKey } from "../../../lib/sync/registry.js";
import type { JsonValue } from "../../../shared/contract.js";
import { syncMetadata } from "../../sync/engine/status.js";
import { projectVexDecision } from "../../sync/entities/vex-decision.js";
import type { FieldDiff, FieldValue, Plan, PlanItem } from "../../sync/plan/index.js";
import { push, resumePush } from "../../sync/push/index.js";
import { pusherFor } from "../../sync/push/pushers.js";
import { contentHash } from "../../sync/serialize/canonical.js";
import { createSerializer } from "../../sync/serialize/serializer.js";
import { BaseSnapshotStore } from "../../sync/store/base-snapshot.js";
import { registerFindingsStableKeyStub } from "../stable-key/index.js";
import type { VexTuple } from "../overlay/schema.js";
import { chunkVexTargets } from "./chunk.js";
import { consumeSetEnvelope } from "./results.js";
import {
  createVexBulkPusher,
  pushVexItems,
  registerFindingsBulk,
  type PushContext,
} from "./index.js";

const PROJECT = "project-wp29";
const PV = "pv-wp29";
const GENERATION = "generation-wp29";
const AT = "2026-08-13T12:00:00.000Z";
const DESIRED: VexTuple = {
  status: "RESOLVED",
  response: null,
  justification: null,
  reason: "human rationale",
};

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function value(payload: Readonly<Record<string, JsonValue>>, field: string): FieldValue {
  return Object.hasOwn(payload, field)
    ? { present: true, value: payload[field] ?? null }
    : { present: false, value: null };
}

function fields(payload: VexTuple): FieldDiff[] {
  const ours: Record<string, JsonValue> = { ...payload };
  return Object.keys(ours).sort().map((field) => ({
    field,
    base: { present: false, value: null },
    ours: value(ours, field),
    theirs: { present: false, value: null },
  }));
}

interface Fixture {
  db: ReturnType<ReturnType<typeof createPluginContext>["db"]>;
  details: Map<string, Record<string, Json>>;
}

function fixture(): Fixture {
  const host = createFakePluginHost({ pluginId: `finite-state-wp29-${hosts.length}` });
  hosts.push(host);
  const db = createPluginContext(host.bb).db();
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status, requested_kinds_json,
        started_at, completed_at, accepted_at, error)
     VALUES (?, ?, ?, 'accepted', '["finding","vexDecision"]', ?, ?, ?, NULL)`,
  ).run(PROJECT, PV, GENERATION, AT, AT, AT);
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        staging_generation_id, base_revision, staging_continuation, staged_pages,
        staged_rows, last_pull, error)
     VALUES (?, ?, 'finding', ?, NULL, 0, NULL, 0, 0, ?, NULL)`,
  ).run(PROJECT, PV, GENERATION, AT);
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        staging_generation_id, base_revision, staging_continuation, staged_pages,
        staged_rows, last_pull, error)
     VALUES (?, ?, 'vexDecision', ?, NULL, 0, NULL, 0, 0, ?, NULL)`,
  ).run(PROJECT, PV, GENERATION, AT);
  registerFindingsStableKeyStub(db);
  return { db, details: new Map() };
}

interface FindingInput {
  id: string;
  cve: string;
  purl: string;
  name: string;
  version?: string;
  tuple?: VexTuple | null;
}

function insertFinding(state: Fixture, input: FindingInput): string {
  const version = input.version ?? "1.0.0";
  const key = findingStableKey({
    cve: input.cve,
    purl: input.purl,
    name: input.name,
    group: null,
    version,
  });
  const tuple = input.tuple ?? null;
  const detail = {
    id: input.id,
    cve: input.cve,
    componentId: input.name,
    componentFallbackIdentity: input.name,
    componentPurl: input.purl,
    vexStatus: tuple?.status ?? null,
    vexResponse: tuple?.response ?? null,
    vexJustification: tuple?.justification ?? null,
    vexReason: tuple?.reason ?? null,
  } satisfies Record<string, Json>;
  state.details.set(input.id, detail);
  state.db.prepare(
    `INSERT INTO findings
       (project_id, project_version_id, generation_id, finding_id, stable_key,
        cve, component_name, component_group, component_version, component_purl,
        vex_status, vex_response, vex_justification, vex_reason, raw, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    PROJECT,
    PV,
    GENERATION,
    input.id,
    key,
    input.cve,
    input.name,
    version,
    input.purl,
    tuple?.status ?? null,
    tuple?.response ?? null,
    tuple?.justification ?? null,
    tuple?.reason ?? null,
    JSON.stringify(detail),
    AT,
  );
  return key;
}

function insertGuard(state: Fixture, key: string, cve: string, tuple = DESIRED, pin = "exact_version"): void {
  state.db.prepare(
    `INSERT INTO overlay_index
       (project_id, project_version_id, entity_kind, stable_key, cve, file_path,
        file_sha256, vex_status, vex_response, vex_justification, vex_reason, pin,
        provenance_by, provenance_at, evidence, sync_base, pushed_at, local_state,
        drift_state, match_tier, indexed_at)
     VALUES (?, ?, 'vexDecision', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engineer', ?, 'test',
             NULL, NULL, 'dirty', NULL, 'purl', ?)`,
  ).run(
    PROJECT,
    PV,
    key,
    cve,
    `.fs/triage/${PROJECT}/${cve}.yaml`,
    "a".repeat(64),
    tuple.status,
    tuple.response,
    tuple.justification,
    tuple.reason,
    pin,
    AT,
    AT,
  );
}

function item(key: string, cve: string, tuple = DESIRED): PlanItem {
  return {
    projectId: PROJECT,
    projectVersionId: PV,
    kind: "vexDecision",
    key,
    label: cve,
    operation: "create",
    expectedBaseContentHash: null,
    fields: fields(tuple),
    conflicts: [],
    referrers: [],
    error: null,
  };
}

function unsigned(plan: Plan): Omit<Plan, "planSha256"> {
  const { planSha256: _ignored, ...rest } = plan;
  return rest;
}

async function persistPlan(state: Fixture, items: PlanItem[], planId: string): Promise<{ plan: Plan; root: string }> {
  const metadata = syncMetadata({ db: state.db }, { projectId: PROJECT, projectVersionId: PV }, ["vexDecision"]);
  const creates = items.filter((entry) => entry.operation === "create").length;
  const updates = items.filter((entry) => entry.operation === "update").length;
  const deletes = items.filter((entry) => entry.operation === "delete").length;
  const draft: Plan = {
    projectId: PROJECT,
    projectVersionId: PV,
    planId,
    planSha256: "",
    baseGenerationIds: metadata.acceptedGenerationIds,
    baseRevisions: metadata.baseRevisions,
    baseStateSha256: metadata.baseStateSha256,
    createdAt: AT,
    staleness: { asOf: AT, degraded: false },
    items,
    summary: { creates, updates, deletes, noops: 0, conflicts: 0, orphans: 0 },
    blastRadius: {
      requiresHumanReview: true,
      changed: items.length,
      deletes,
      remoteCalls: items.length,
      surfaces: ["vexDecision"],
    },
    validationErrors: [],
    total: items.length,
    next: null,
    cache: {
      state: "fresh",
      asOf: AT,
      message: null,
      acceptedGenerationId: GENERATION,
      baseRevision: metadata.baseRevisions["vexDecision"] ?? 0,
    },
  };
  const plan = { ...draft, planSha256: contentHash(unsigned(draft)) };
  const root = await mkdtemp(join(tmpdir(), "finite-state-wp29-"));
  roots.push(root);
  await mkdir(join(root, ".fs-sync"), { recursive: true });
  await writeFile(join(root, ".fs-sync", `plan-${planId}.json`), `${JSON.stringify(plan)}\n`);
  return { plan, root };
}

function insertBase(state: Fixture, key: string, findingId: string, tuple: VexTuple): string {
  const payload = { ...tuple };
  const hash = createSerializer("vexDecision").contentHash(payload, {
    idToSlug: (_remoteId: string): null => null,
    onWarning: (): void => undefined,
  });
  state.db.prepare(
    `INSERT INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id, entity_key,
        remote_id, payload, content_hash, pulled_at)
     VALUES (?, ?, 'vexDecision', ?, ?, ?, ?, ?, ?)`,
  ).run(PROJECT, PV, GENERATION, key, findingId, JSON.stringify(payload), hash, AT);
  state.db.prepare(
    `INSERT INTO id_map
       (project_id, project_version_id, entity_kind, generation_id, entity_key,
        remote_id, pulled_at)
     VALUES (?, ?, 'vexDecision', ?, ?, ?, ?)`,
  ).run(PROJECT, PV, GENERATION, key, findingId, AT);
  return hash;
}

function setDetail(detail: Record<string, Json>, input: VexDecisionInput): void {
  detail["vexStatus"] = input.status;
  detail["vexResponse"] = input.response ?? null;
  detail["vexJustification"] = input.justification ?? null;
  detail["vexReason"] = input.reason ?? null;
}

interface ReadStats {
  details: number;
  pages: number;
  rows: number;
}

function successfulPlatform(
  state: Fixture,
  batches: number[],
  reads: ReadStats = { details: 0, pages: 0, rows: 0 },
  corpusPadding = 0,
): Pick<PlatformClient, "batchSetVexStatus" | "clearVexStatus" | "getFindingDetail" | "getFindings"> {
  return {
    async batchSetVexStatus(input): Promise<VexBulkSetResult> {
      batches.push(input.findings.length);
      for (const finding of input.findings) {
        const detail = state.details.get(finding.findingId);
        if (detail !== undefined) setDetail(detail, finding);
      }
      return {
        status: "success",
        summary: { total: input.findings.length, succeeded: input.findings.length, failed: 0 },
        results: input.findings.map((finding) => ({
          findingId: finding.findingId,
          success: true,
          status: finding.status,
          error: null,
        })),
      };
    },
    async clearVexStatus(input): Promise<void> {
      for (const findingId of input.findingIds) {
        const detail = state.details.get(findingId);
        if (detail !== undefined) {
          detail["vexStatus"] = null;
          detail["vexResponse"] = null;
          detail["vexJustification"] = null;
          detail["vexReason"] = null;
        }
      }
    },
    async getFindingDetail(input) {
      reads.details += 1;
      const detail = state.details.get(input.findingId);
      if (detail === undefined) throw new Error(`Missing fake finding ${input.findingId}`);
      return structuredClone(detail);
    },
    async *getFindings(input) {
      const padding = Array.from({ length: corpusPadding }, (_, index): Record<string, Json> => ({
        id: `pad-${index}`,
        cve: "CVE-0000-0000",
        componentId: "pad",
        componentFallbackIdentity: "pad",
        componentPurl: `pkg:npm/pad-${index}@1.0.0`,
        vexStatus: null,
        vexResponse: null,
        vexJustification: null,
        vexReason: null,
      }));
      const corpus = [...padding, ...[...state.details.values()].map((detail) => structuredClone(detail))];
      const pageSize = input.page?.pageSize ?? 1_000;
      for (let offset = 0; offset < corpus.length; offset += pageSize) {
        const items = corpus.slice(offset, offset + pageSize);
        reads.pages += 1;
        reads.rows += items.length;
        yield { items, total: corpus.length, next: null };
      }
    },
  };
}

function context(
  state: Fixture,
  platform: PushContext["platform"],
  publish: PushContext["publish"] = () => undefined,
  scheduler?: Scheduler,
): PushContext {
  return {
    db: state.db,
    platform,
    publish,
    ...(scheduler === undefined ? {} : { scheduler }),
    random: () => 0,
    runId: "run-wp29",
    scope: { projectId: PROJECT, projectVersionId: PV },
  };
}

describe("WP-29 VEX bulk pusher", () => {
  it("chunks 501 duplicate targets as 500+1, preserves the human reason, and suppresses a repeat noop", async () => {
    const state = fixture();
    const cve = "CVE-2026-2901";
    const purl = "pkg:npm/widget@1.0.0";
    let key = "";
    for (let index = 0; index < 501; index += 1) {
      key = insertFinding(state, { id: String(10_000 + index), cve, purl, name: "widget" });
    }
    insertGuard(state, key, cve);
    const batches: number[] = [];
    const progress: Array<{ completed: number; total: number }> = [];
    const reads: ReadStats = { details: 0, pages: 0, rows: 0 };
    const platform = successfulPlatform(state, batches, reads, 20_000);
    const applyContext = context(state, platform, (event) => progress.push(event));

    const first = await pushVexItems(applyContext, [item(key, cve)]);
    expect(batches).toEqual([500, 1]);
    expect(first).toEqual([expect.objectContaining({
      stableKey: key,
      targets: 501,
      succeeded: 501,
      failed: 0,
      state: "applied",
    })]);
    expect([...state.details.values()].every((detail) => detail["vexReason"] === "[bb:run-wp29] human rationale")).toBe(true);
    expect(progress.length).toBeLessThanOrEqual(3);
    expect(progress.at(-1)).toEqual({ runId: "run-wp29", completed: 501, total: 501 });
    expect(reads).toEqual({ details: 1_002, pages: 0, rows: 0 });

    const second = await pushVexItems(applyContext, [item(key, cve)]);
    expect(batches).toEqual([500, 1]);
    expect(second[0]).toMatchObject({ targets: 501, succeeded: 501, failed: 0, state: "noop" });
    expect(reads).toEqual({ details: 1_503, pages: 0, rows: 0 });
  });

  it("keeps a one-target push independent of a padded remote corpus", async () => {
    const state = fixture();
    const cve = "CVE-2026-2925";
    const key = insertFinding(state, {
      id: "29251", cve, purl: "pkg:npm/common@1.0.0", name: "common",
    });
    insertGuard(state, key, cve);
    const batches: number[] = [];
    const reads: ReadStats = { details: 0, pages: 0, rows: 0 };

    const result = await pushVexItems(
      context(state, successfulPlatform(state, batches, reads, 20_000)),
      [item(key, cve)],
    );

    expect(result[0]).toMatchObject({ state: "applied" });
    expect(batches).toEqual([1]);
    expect(reads).toEqual({ details: 2, pages: 0, rows: 0 });
  });

  it("suppresses a cached noop write only after targeted Platform proof", async () => {
    const state = fixture();
    const cve = "CVE-2026-2926";
    const key = insertFinding(state, {
      id: "29261", cve, purl: "pkg:npm/cached-noop@1.0.0", name: "cached-noop", tuple: DESIRED,
    });
    insertGuard(state, key, cve);
    const batches: number[] = [];
    const reads: ReadStats = { details: 0, pages: 0, rows: 0 };

    const result = await pushVexItems(
      context(state, successfulPlatform(state, batches, reads, 20_000)),
      [item(key, cve)],
    );

    expect(result[0]).toMatchObject({ state: "noop" });
    expect(batches).toEqual([]);
    expect(reads).toEqual({ details: 1, pages: 0, rows: 0 });
  });

  it("keeps a cached noop dirty when targeted Platform proof disagrees", async () => {
    const state = fixture();
    const cve = "CVE-2026-2927";
    const key = insertFinding(state, {
      id: "29271", cve, purl: "pkg:npm/cached-drift@1.0.0", name: "cached-drift", tuple: DESIRED,
    });
    insertGuard(state, key, cve);
    const remote = state.details.get("29271");
    if (remote === undefined) throw new Error("Missing cached-drift fixture");
    remote["vexStatus"] = "FALSE_POSITIVE";
    remote["vexReason"] = "changed remotely after the accepted pull";
    const persisted = await persistPlan(state, [item(key, cve)], "01KWP290000000000000000006");
    const batches: number[] = [];
    const reads: ReadStats = { details: 0, pages: 0, rows: 0 };

    const report = await push({
      db: state.db,
      worktreeRoot: persisted.root,
      pushers: [createVexBulkPusher({
        db: state.db,
        platform: successfulPlatform(state, batches, reads, 20_000),
        publish: () => undefined,
      })],
      createRunId: () => "wp29-cached-drift",
    }, {
      scope: { projectId: PROJECT, projectVersionId: PV },
      planId: persisted.plan.planId,
      expectedPlanSha256: persisted.plan.planSha256,
      expectedBaseStateSha256: persisted.plan.baseStateSha256,
      confirmed: true,
    });

    expect(report.summary).toEqual({ total: 1, applied: 0, failed: 1, skipped: 0 });
    expect(report.items[0]?.error).toMatchObject({
      code: "VEX_READ_BACK_MISMATCH",
      retryable: false,
    });
    expect(report.requiresPull).toBe(true);
    expect(batches).toEqual([]);
    expect(reads).toEqual({ details: 1, pages: 0, rows: 0 });
    expect(new BaseSnapshotStore(state.db).getAccepted(PROJECT, PV, "vexDecision", key)).toBeNull();
    expect(state.db.prepare(
      "SELECT local_state FROM overlay_index WHERE stable_key = ?",
    ).get(key)).toEqual({ local_state: "dirty" });
  });

  it("groups mixed project versions, set/clear operations, and distinct tuples separately", () => {
    const one: VexTuple = { status: "IN_TRIAGE", response: null, justification: null, reason: "one" };
    const two: VexTuple = { status: "RESOLVED", response: null, justification: null, reason: "two" };
    const batches = chunkVexTargets([
      { pvId: "pv-a", findingId: "1", stableKey: "key-1", action: "set", tuple: one },
      { pvId: "pv-a", findingId: "2", stableKey: "key-2", action: "clear" },
      { pvId: "pv-b", findingId: "3", stableKey: "key-3", action: "set", tuple: one },
      { pvId: "pv-a", findingId: "4", stableKey: "key-4", action: "set", tuple: two },
    ]);
    expect(batches).toHaveLength(4);
    expect(batches.every((batch) => batch.targets.every((target) => (
      target.pvId === batch.pvId
      && target.action === batch.action
      && (target.action === "clear" || JSON.stringify(target.tuple) === JSON.stringify(batch.tuple))
    )))).toBe(true);
    expect(chunkVexTargets(Array.from({ length: 501 }, (_, index) => ({
      pvId: "pv-clear",
      findingId: String(index + 1),
      stableKey: `clear-${index}`,
      action: "clear" as const,
    }))).map((batch) => batch.targets.length)).toEqual([500, 1]);
  });

  it("keeps a partially failed duplicate decision dirty while an unrelated item succeeds", async () => {
    const state = fixture();
    const firstCve = "CVE-2026-2902";
    const secondCve = "CVE-2026-2903";
    const firstKey = insertFinding(state, { id: "29021", cve: firstCve, purl: "pkg:npm/partial@1.0.0", name: "partial" });
    insertFinding(state, { id: "29022", cve: firstCve, purl: "pkg:npm/partial@1.0.0", name: "partial" });
    const secondKey = insertFinding(state, { id: "29031", cve: secondCve, purl: "pkg:npm/other@1.0.0", name: "other" });
    insertGuard(state, firstKey, firstCve);
    insertGuard(state, secondKey, secondCve);
    const platform = successfulPlatform(state, []);
    const original = platform.batchSetVexStatus;
    platform.batchSetVexStatus = async (input, callContext) => {
      const response = await original(input, callContext);
      const failed = response.results.find((result) => result.findingId === "29022");
      if (failed !== undefined) {
        failed.success = false;
        failed.status = null;
        failed.error = "injected partial failure";
        response.status = "partial_success";
        response.summary.succeeded -= 1;
        response.summary.failed += 1;
        const detail = state.details.get("29022");
        if (detail !== undefined) {
          detail["vexStatus"] = null;
          detail["vexReason"] = null;
        }
      }
      return response;
    };

    const results = await pushVexItems(context(state, platform), [item(firstKey, firstCve), item(secondKey, secondCve)]);
    expect(results).toEqual([
      expect.objectContaining({ stableKey: firstKey, targets: 2, succeeded: 1, failed: 1, state: "partial" }),
      expect.objectContaining({ stableKey: secondKey, targets: 1, succeeded: 1, failed: 0, state: "applied" }),
    ]);
    expect(state.db.prepare(
      "SELECT local_state FROM overlay_index WHERE stable_key = ?",
    ).get(firstKey)).toEqual({ local_state: "dirty" });
  });

  it("rejects every stable item contending for one resolved finding before transport", async () => {
    const state = fixture();
    const cve = "CVE-2026-2920";
    const purlKey = insertFinding(state, {
      id: "29201", cve, purl: "pkg:npm/contended@1.0.0", name: "contended",
    });
    const broadKey = findingStableKey({
      cve, purl: null, name: "contended", group: null, version: null,
    }, "name-group-any-version");
    const other = { ...DESIRED, status: "FALSE_POSITIVE" as const, reason: "other decision" };
    insertGuard(state, purlKey, cve, DESIRED, "exact_version");
    insertGuard(state, broadKey, cve, other, "any_version");
    const batches: number[] = [];

    const results = await pushVexItems(context(state, successfulPlatform(state, batches)), [
      item(purlKey, cve),
      item(broadKey, cve, other),
    ]);

    expect(batches).toEqual([]);
    expect(results).toEqual([
      expect.objectContaining({ state: "failed", errors: [expect.objectContaining({
        code: "VEX_TARGET_CONTENDED", message: expect.stringContaining(broadKey), retryable: false,
      })] }),
      expect.objectContaining({ state: "failed", errors: [expect.objectContaining({
        code: "VEX_TARGET_CONTENDED", message: expect.stringContaining(purlKey), retryable: false,
      })] }),
    ]);
  });

  it("still suppresses an already-correct sibling target after another target is contended", async () => {
    const state = fixture();
    const cve = "CVE-2026-2923";
    insertFinding(state, {
      id: "29231", cve, purl: "pkg:npm/mixed@1.0.0", name: "mixed", version: "1.0.0",
    });
    insertFinding(state, {
      id: "29232", cve, purl: "pkg:npm/mixed@2.0.0", name: "mixed", version: "2.0.0", tuple: DESIRED,
    });
    const exactKey = findingStableKey({
      cve, purl: "pkg:npm/mixed@1.0.0", name: "mixed", group: null, version: "1.0.0",
    });
    const broadKey = findingStableKey({
      cve, purl: null, name: "mixed", group: null, version: null,
    }, "name-group-any-version");
    insertGuard(state, exactKey, cve, DESIRED, "exact_version");
    insertGuard(state, broadKey, cve, DESIRED, "any_version");
    const batches: number[] = [];

    const results = await pushVexItems(context(state, successfulPlatform(state, batches)), [
      item(exactKey, cve),
      item(broadKey, cve),
    ]);

    expect(batches).toEqual([]);
    expect(results[1]).toMatchObject({
      state: "partial",
      targets: 2,
      succeeded: 1,
      failed: 1,
      errors: [expect.objectContaining({ code: "VEX_TARGET_CONTENDED" })],
    });
  });

  it("never writes a sibling target whose remote identity moved after another target is contended", async () => {
    const state = fixture();
    const cve = "CVE-2026-2924";
    insertFinding(state, {
      id: "29241", cve, purl: "pkg:npm/moved@1.0.0", name: "moved", version: "1.0.0",
    });
    insertFinding(state, {
      id: "29242", cve, purl: "pkg:npm/moved@2.0.0", name: "moved", version: "2.0.0",
    });
    const exactKey = findingStableKey({
      cve, purl: "pkg:npm/moved@1.0.0", name: "moved", group: null, version: "1.0.0",
    });
    const broadKey = findingStableKey({
      cve, purl: null, name: "moved", group: null, version: null,
    }, "name-group-any-version");
    insertGuard(state, exactKey, cve, DESIRED, "exact_version");
    insertGuard(state, broadKey, cve, DESIRED, "any_version");
    const moved = state.details.get("29242");
    if (moved === undefined) throw new Error("Missing moved test finding");
    moved["componentPurl"] = "pkg:npm/different@9.9.9";
    moved["componentId"] = "different";
    moved["componentFallbackIdentity"] = "different";
    const batches: number[] = [];

    const results = await pushVexItems(context(state, successfulPlatform(state, batches)), [
      item(exactKey, cve),
      item(broadKey, cve),
    ]);

    expect(batches).toEqual([]);
    expect(moved["vexStatus"]).toBeNull();
    expect(results[1]).toMatchObject({
      state: "stale",
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "VEX_TARGET_CONTENDED" }),
        expect.objectContaining({ code: "VEX_TARGET_MOVED" }),
      ]),
    });
  });

  it("fails unknown result ids closed and never treats top-level success as row proof", async () => {
    const state = fixture();
    const cve = "CVE-2026-2904";
    const key = insertFinding(state, { id: "29041", cve, purl: "pkg:npm/unknown@1.0.0", name: "unknown" });
    insertGuard(state, key, cve);
    const platform = successfulPlatform(state, []);
    platform.batchSetVexStatus = async (input) => ({
      status: "success",
      summary: { total: input.findings.length, succeeded: input.findings.length, failed: 0 },
      results: input.findings.map((finding) => ({ ...finding, findingId: "999999", success: true, error: null })),
    });
    const result = (await pushVexItems(context(state, platform), [item(key, cve)]))[0];
    expect(result).toMatchObject({ state: "failed", succeeded: 0, failed: 1 });
    expect(result?.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "VEX_RESULT_INVALID", retryable: true }),
      expect.objectContaining({ code: "REMOTE_WRITE_INDETERMINATE", retryable: true }),
    ]));
  });

  it("rejects missing, duplicate, and summary-mismatched success envelopes", () => {
    const targets = [
      { pvId: PV, findingId: "1", stableKey: "key-1", action: "set" as const, tuple: DESIRED },
      { pvId: PV, findingId: "2", stableKey: "key-2", action: "set" as const, tuple: DESIRED },
    ];
    const success = (findingId: string) => ({
      findingId,
      success: true,
      status: DESIRED.status,
      error: null,
    });
    expect(consumeSetEnvelope(targets, {
      status: "success",
      summary: { total: 2, succeeded: 2, failed: 0 },
      results: [success("1")],
    })).toMatchObject({ ok: false, code: "VEX_RESULT_INVALID" });
    expect(consumeSetEnvelope(targets, {
      status: "success",
      summary: { total: 2, succeeded: 2, failed: 0 },
      results: [success("1"), success("1")],
    })).toMatchObject({ ok: false, code: "VEX_RESULT_INVALID" });
    expect(consumeSetEnvelope(targets, {
      status: "success",
      summary: { total: 2, succeeded: 1, failed: 1 },
      results: [success("1"), success("2")],
    })).toMatchObject({ ok: false, code: "VEX_RESULT_INVALID" });
  });

  it("honors Retry-After for 429 but does not retry a semantic 400", async () => {
    const state = fixture();
    const cve = "CVE-2026-2905";
    const key = insertFinding(state, { id: "29051", cve, purl: "pkg:npm/rate@1.0.0", name: "rate" });
    insertGuard(state, key, cve);
    const sleeps: number[] = [];
    const scheduler: Scheduler = {
      now: Date.now,
      async sleep(ms): Promise<void> { sleeps.push(ms); },
    };
    const platform = successfulPlatform(state, []);
    const success = platform.batchSetVexStatus;
    let calls = 0;
    platform.batchSetVexStatus = async (input, callContext) => {
      calls += 1;
      if (calls === 1) throw new RemoteError("rate limited", {
        service: "platform",
        code: "REMOTE_RATE_LIMITED",
        status: 429,
        retryable: false,
        retryAfterMs: 2_300,
        details: null,
      });
      return success(input, callContext);
    };
    await expect(pushVexItems(context(state, platform, () => undefined, scheduler), [item(key, cve)]))
      .resolves.toEqual([expect.objectContaining({ state: "applied" })]);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([2_300]);

    const semanticState = fixture();
    const semanticKey = insertFinding(semanticState, {
      id: "29052",
      cve,
      purl: "pkg:npm/semantic@1.0.0",
      name: "semantic",
    });
    insertGuard(semanticState, semanticKey, cve);
    let semanticCalls = 0;
    const semanticPlatform = successfulPlatform(semanticState, []);
    semanticPlatform.batchSetVexStatus = async () => {
      semanticCalls += 1;
      throw new RemoteError("bad request", {
        service: "platform",
        code: "REMOTE_HTTP_400",
        status: 400,
        retryable: false,
        retryAfterMs: null,
        details: null,
      });
    };
    const semantic = await pushVexItems(context(semanticState, semanticPlatform, () => undefined, scheduler), [
      item(semanticKey, cve),
    ]);
    expect(semanticCalls).toBe(1);
    expect(semantic[0]).toMatchObject({ state: "failed", errors: [expect.objectContaining({ retryable: false })] });
  });

  it("floors zero Retry-After responses and applies bounded jitter", async () => {
    const state = fixture();
    const cve = "CVE-2026-2921";
    const key = insertFinding(state, { id: "29211", cve, purl: "pkg:npm/floor@1.0.0", name: "floor" });
    insertGuard(state, key, cve);
    const sleeps: number[] = [];
    const scheduler: Scheduler = { now: Date.now, async sleep(ms) { sleeps.push(ms); } };
    const platform = successfulPlatform(state, []);
    platform.batchSetVexStatus = async () => {
      throw new RemoteError("rate limited", {
        service: "platform", code: "REMOTE_RATE_LIMITED", status: 429,
        retryable: false, retryAfterMs: 0, details: null,
      });
    };
    const pushContext = { ...context(state, platform, () => undefined, scheduler), random: () => 0.5 };

    const result = await pushVexItems(pushContext, [item(key, cve)]);

    expect(sleeps).toEqual([375, 375, 375, 375, 375]);
    expect(result[0]).toMatchObject({ state: "failed", errors: [expect.objectContaining({ retryable: true })] });
  });

  it("fails before transport when provenance cannot fit without truncating the human reason", async () => {
    const state = fixture();
    const cve = "CVE-2026-2915";
    const tuple = { ...DESIRED, reason: "r".repeat(10_000) };
    const key = insertFinding(state, { id: "29151", cve, purl: "pkg:npm/reason@1.0.0", name: "reason" });
    insertGuard(state, key, cve, tuple);
    const batches: number[] = [];
    const result = await pushVexItems(context(state, successfulPlatform(state, batches)), [item(key, cve, tuple)]);
    expect(batches).toEqual([]);
    expect(result[0]).toMatchObject({
      state: "failed",
      errors: [expect.objectContaining({ code: "VEX_REASON_TOO_LONG", retryable: false })],
    });
  });

  it("isolates an exact-version guard failure and rejects orphaned decisions before any send", async () => {
    const state = fixture();
    const badCve = "CVE-2026-2906";
    const goodCve = "CVE-2026-2907";
    const badKey = insertFinding(state, { id: "29061", cve: badCve, purl: "pkg:npm/bad@1.0.0", name: "bad" });
    const goodKey = insertFinding(state, { id: "29071", cve: goodCve, purl: "pkg:npm/good@1.0.0", name: "good" });
    const staleCve = "CVE-2026-2908";
    const staleKey = insertFinding(state, { id: "29081", cve: staleCve, purl: "pkg:npm/stale@1.0.0", name: "stale" });
    insertGuard(state, badKey, badCve, { ...DESIRED, justification: "CODE_NOT_REACHABLE" }, "any_version");
    insertGuard(state, goodKey, goodCve);
    insertGuard(state, staleKey, staleCve);
    const staleDetail = state.details.get("29081");
    if (staleDetail !== undefined) staleDetail["componentPurl"] = "pkg:npm/moved@2.0.0";
    const orphanKey = findingStableKey({
      cve: "CVE-2026-2999",
      purl: "pkg:npm/missing@1.0.0",
      name: "missing",
      group: null,
      version: "1.0.0",
    });
    insertGuard(state, orphanKey, "CVE-2026-2999");
    const batches: number[] = [];
    const results = await pushVexItems(context(state, successfulPlatform(state, batches)), [
      item(badKey, badCve, { ...DESIRED, justification: "CODE_NOT_REACHABLE" }),
      item(goodKey, goodCve),
      item(staleKey, staleCve),
      item(orphanKey, "CVE-2026-2999"),
    ]);
    expect(results[0]).toMatchObject({ state: "failed", errors: [expect.objectContaining({ code: "VEX_EXACT_VERSION_REQUIRED" })] });
    expect(results[1]).toMatchObject({ state: "applied" });
    expect(results[2]).toMatchObject({ state: "stale" });
    expect(results[3]).toMatchObject({ state: "orphaned" });
    expect(batches).toEqual([1]);
  });

  it("advances a successful stable-item base and clears to a null base only through the dedicated clear path", async () => {
    const setState = fixture();
    const setCve = "CVE-2026-2910";
    const setKey = insertFinding(setState, {
      id: "29101",
      cve: setCve,
      purl: "pkg:npm/advance@1.0.0",
      name: "advance",
    });
    insertGuard(setState, setKey, setCve);
    const setPlan = await persistPlan(setState, [item(setKey, setCve)], "01KWP290000000000000000001");
    const setPlatform = successfulPlatform(setState, []);
    const setReport = await push({
      db: setState.db,
      worktreeRoot: setPlan.root,
      pushers: [createVexBulkPusher({ db: setState.db, platform: setPlatform, publish: () => undefined })],
      createRunId: () => "wp29-set-base",
    }, {
      scope: { projectId: PROJECT, projectVersionId: PV },
      planId: setPlan.plan.planId,
      expectedPlanSha256: setPlan.plan.planSha256,
      expectedBaseStateSha256: setPlan.plan.baseStateSha256,
      confirmed: true,
    });
    expect(setReport.summary).toEqual({ total: 1, applied: 1, failed: 0, skipped: 0 });
    const advanced = new BaseSnapshotStore(setState.db).getAccepted(PROJECT, PV, "vexDecision", setKey)?.payload;
    expect(advanced).toEqual(DESIRED);
    expect(projectVexDecision(setState.details.get("29101") ?? {})?.payload).toEqual(advanced);

    const clearState = fixture();
    const clearCve = "CVE-2026-2911";
    const clearKey = insertFinding(clearState, {
      id: "29111",
      cve: clearCve,
      purl: "pkg:npm/clear@1.0.0",
      name: "clear",
      tuple: DESIRED,
    });
    const expectedBaseContentHash = insertBase(clearState, clearKey, "29111", DESIRED);
    const clearItem: PlanItem = {
      ...item(clearKey, clearCve),
      operation: "delete",
      expectedBaseContentHash,
      fields: [],
    };
    const clearPlan = await persistPlan(clearState, [clearItem], "01KWP290000000000000000002");
    const clearCalls: string[][] = [];
    const clearPlatform = successfulPlatform(clearState, []);
    const clear = clearPlatform.clearVexStatus;
    clearPlatform.clearVexStatus = async (input, callContext) => {
      clearCalls.push([...input.findingIds]);
      await clear(input, callContext);
    };
    const clearReport = await push({
      db: clearState.db,
      worktreeRoot: clearPlan.root,
      pushers: [createVexBulkPusher({ db: clearState.db, platform: clearPlatform, publish: () => undefined })],
      createRunId: () => "wp29-clear-base",
    }, {
      scope: { projectId: PROJECT, projectVersionId: PV },
      planId: clearPlan.plan.planId,
      expectedPlanSha256: clearPlan.plan.planSha256,
      expectedBaseStateSha256: clearPlan.plan.baseStateSha256,
      confirmed: true,
    });
    expect(clearCalls).toEqual([["29111"]]);
    expect(clearReport.summary).toEqual({ total: 1, applied: 1, failed: 0, skipped: 0 });
    expect(new BaseSnapshotStore(clearState.db).getAccepted(PROJECT, PV, "vexDecision", clearKey)).toBeNull();
  });

  it("advances an unrelated stable item while a duplicate-row partial failure keeps its base old", async () => {
    const state = fixture();
    const partialCve = "CVE-2026-2913";
    const appliedCve = "CVE-2026-2914";
    const partialKey = insertFinding(state, {
      id: "29131",
      cve: partialCve,
      purl: "pkg:npm/base-partial@1.0.0",
      name: "base-partial",
    });
    insertFinding(state, {
      id: "29132",
      cve: partialCve,
      purl: "pkg:npm/base-partial@1.0.0",
      name: "base-partial",
    });
    const appliedKey = insertFinding(state, {
      id: "29141",
      cve: appliedCve,
      purl: "pkg:npm/base-applied@1.0.0",
      name: "base-applied",
    });
    insertGuard(state, partialKey, partialCve);
    insertGuard(state, appliedKey, appliedCve);
    const persisted = await persistPlan(
      state,
      [item(partialKey, partialCve), item(appliedKey, appliedCve)],
      "01KWP290000000000000000004",
    );
    const platform = successfulPlatform(state, []);
    const success = platform.batchSetVexStatus;
    platform.batchSetVexStatus = async (input, callContext) => {
      const response = await success(input, callContext);
      const failed = response.results.find((result) => result.findingId === "29132");
      if (failed !== undefined) {
        failed.success = false;
        failed.status = null;
        failed.error = "injected duplicate-row failure";
        response.status = "partial_success";
        response.summary.succeeded -= 1;
        response.summary.failed += 1;
        const detail = state.details.get("29132");
        if (detail !== undefined) {
          detail["vexStatus"] = null;
          detail["vexReason"] = null;
        }
      }
      return response;
    };
    const report = await push({
      db: state.db,
      worktreeRoot: persisted.root,
      pushers: [createVexBulkPusher({ db: state.db, platform, publish: () => undefined })],
      createRunId: () => "wp29-partial-base",
    }, {
      scope: { projectId: PROJECT, projectVersionId: PV },
      planId: persisted.plan.planId,
      expectedPlanSha256: persisted.plan.planSha256,
      expectedBaseStateSha256: persisted.plan.baseStateSha256,
      confirmed: true,
    });
    expect(report.status).toBe("partial");
    expect(report.summary).toEqual({ total: 2, applied: 1, failed: 1, skipped: 0 });
    expect(new BaseSnapshotStore(state.db).getAccepted(PROJECT, PV, "vexDecision", partialKey)).toBeNull();
    expect(new BaseSnapshotStore(state.db).getAccepted(PROJECT, PV, "vexDecision", appliedKey)?.payload).toEqual(DESIRED);
    expect(report.items[0]?.error).toMatchObject({ code: "VEX_PARTIAL_FAILURE", retryable: true });
  });

  it("resumes after the second chunk without replaying the first confirmed 500 targets", async () => {
    const state = fixture();
    const cve = "CVE-2026-2912";
    const purl = "pkg:npm/resume@1.0.0";
    let key = "";
    for (let index = 0; index < 501; index += 1) {
      key = insertFinding(state, { id: String(40_000 + index), cve, purl, name: "resume" });
    }
    insertGuard(state, key, cve);
    const persisted = await persistPlan(state, [item(key, cve)], "01KWP290000000000000000003");
    const calls: number[] = [];
    const platform = successfulPlatform(state, []);
    const success = platform.batchSetVexStatus;
    let resetInjected = false;
    platform.batchSetVexStatus = async (input, callContext) => {
      calls.push(input.findings.length);
      if (input.findings.length === 1 && !resetInjected) {
        resetInjected = true;
        throw new Error("injected connection reset");
      }
      return success(input, callContext);
    };
    const deps = {
      db: state.db,
      worktreeRoot: persisted.root,
      pushers: [createVexBulkPusher({ db: state.db, platform, publish: () => undefined })],
      createRunId: () => "wp29-resume",
    };
    const first = await push(deps, {
      scope: { projectId: PROJECT, projectVersionId: PV },
      planId: persisted.plan.planId,
      expectedPlanSha256: persisted.plan.planSha256,
      expectedBaseStateSha256: persisted.plan.baseStateSha256,
      confirmed: true,
    });
    expect(first.summary).toEqual({ total: 1, applied: 0, failed: 1, skipped: 0 });
    expect(first.items[0]?.error).toMatchObject({ code: "VEX_PARTIAL_FAILURE", retryable: true });
    expect(calls).toEqual([500, 1]);
    expect(new BaseSnapshotStore(state.db).getAccepted(PROJECT, PV, "vexDecision", key)).toBeNull();

    const resumed = await resumePush(deps, "wp29-resume");
    expect(resumed.summary).toEqual({ total: 1, applied: 1, failed: 0, skipped: 0 });
    expect(calls).toEqual([500, 1, 1]);
    expect(new BaseSnapshotStore(state.db).getAccepted(PROJECT, PV, "vexDecision", key)?.payload).toEqual(DESIRED);
  });

  it("resumes without replay when the final write lands before the socket dies", async () => {
    const state = fixture();
    const cve = "CVE-2026-2922";
    const purl = "pkg:npm/indeterminate@1.0.0";
    let key = "";
    for (let index = 0; index < 501; index += 1) {
      key = insertFinding(state, { id: String(50_000 + index), cve, purl, name: "indeterminate" });
    }
    insertGuard(state, key, cve);
    const persisted = await persistPlan(state, [item(key, cve)], "01KWP290000000000000000005");
    const calls: number[] = [];
    const platform = successfulPlatform(state, []);
    const success = platform.batchSetVexStatus;
    let injected = false;
    platform.batchSetVexStatus = async (input, callContext) => {
      calls.push(input.findings.length);
      const response = await success(input, callContext);
      if (input.findings.length === 1 && !injected) {
        injected = true;
        throw new RemoteError("write outcome unknown", {
          service: "platform", code: "REMOTE_WRITE_INDETERMINATE", status: null,
          retryable: false, retryAfterMs: null, details: null,
        });
      }
      return response;
    };
    const deps = {
      db: state.db,
      worktreeRoot: persisted.root,
      pushers: [createVexBulkPusher({ db: state.db, platform, publish: () => undefined })],
      createRunId: () => "wp29-indeterminate",
    };
    const first = await push(deps, {
      scope: { projectId: PROJECT, projectVersionId: PV },
      planId: persisted.plan.planId,
      expectedPlanSha256: persisted.plan.planSha256,
      expectedBaseStateSha256: persisted.plan.baseStateSha256,
      confirmed: true,
    });
    expect(first.summary.failed).toBe(1);
    expect(calls).toEqual([500, 1]);

    const resumed = await resumePush(deps, "wp29-indeterminate");

    expect(resumed.summary).toEqual({ total: 1, applied: 1, failed: 0, skipped: 0 });
    expect(calls).toEqual([500, 1]);
  });

  it("processes 400 guarded items linearly without reparsing overlay files", async () => {
    const state = fixture();
    const items: PlanItem[] = [];
    for (let index = 0; index < 400; index += 1) {
      const cve = `CVE-2026-${String(3_000 + index)}`;
      const key = insertFinding(state, {
        id: String(30_000 + index),
        cve,
        purl: `pkg:npm/scale-${index}@1.0.0`,
        name: `scale-${index}`,
      });
      insertGuard(state, key, cve);
      items.push(item(key, cve));
    }
    const batches: number[] = [];
    const started = performance.now();
    const results = await pushVexItems(context(state, successfulPlatform(state, batches)), items);
    const elapsed = performance.now() - started;
    expect(results).toHaveLength(400);
    expect(results.every((result) => result.state === "applied")).toBe(true);
    expect(batches).toEqual([400]);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("registers the typed pusher with the existing real database and Platform dependency instances", () => {
    const state = fixture();
    const platform = successfulPlatform(state, []);
    const publish = (): void => undefined;
    registerFindingsBulk({ db: state.db, platform, publish });
    const registered = pusherFor("vexDecision");
    expect(registered).not.toBeNull();
    expect(registered?.kind).toBe("vexDecision");
    expect(createVexBulkPusher({ db: state.db, platform, publish }).kind).toBe("vexDecision");
  });
});
