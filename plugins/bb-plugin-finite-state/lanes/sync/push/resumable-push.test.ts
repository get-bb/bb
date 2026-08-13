import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { IndeterminateRemoteWriteError } from "../../../lib/remote/errors.js";
import { RemoteError } from "../../../lib/remote/types.js";
import { ENTITIES } from "../../../lib/sync/registry.js";
import type { JsonValue } from "../../../shared/contract.js";
import { syncMetadata } from "../engine/status.js";
import type { FieldDiff, FieldValue, Plan, PlanItem, PlanOp } from "../plan/index.js";
import { canonicalJson, contentHash } from "../serialize/canonical.js";
import { createSerializer } from "../serialize/serializer.js";
import { BaseSnapshotStore } from "../store/base-snapshot.js";
import { push, resumePush } from "./index.js";
import type { EntityPusher, PushContext, ReadBackResult } from "./types.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];
const PROJECT = "project-push";
const VERSION = "version-push";
const GENERATION = "generation-push";
const PULLED_AT = "2026-08-13T01:00:00.000Z";
let planSequence = 0;

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createDb(label: string): Database.Database {
  const host = createFakePluginHost({ pluginId: `finite-state-wp19-${label}` });
  hosts.push(host);
  return createPluginContext(host.bb).db();
}

async function createRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `finite-state-wp19-${label}-`));
  roots.push(root);
  return root;
}

function seedGeneration(db: Database.Database, kinds: readonly string[]): void {
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
     VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?)`,
  ).run(PROJECT, VERSION, GENERATION, JSON.stringify(kinds), PULLED_AT, PULLED_AT, PULLED_AT);
  const insert = db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        base_revision, last_pull)
     VALUES (?, ?, ?, ?, 0, ?)`,
  );
  for (const kind of kinds) insert.run(PROJECT, VERSION, kind, GENERATION, PULLED_AT);
}

const HASH_OPTIONS = {
  idToSlug: (_remoteId: string): null => null,
  onWarning: (): void => undefined,
};

function seedBase(
  db: Database.Database,
  item: Pick<PlanItem, "kind" | "key">,
  payload: Record<string, unknown>,
  remoteId: string,
): string {
  const hash = createSerializer(item.kind).contentHash(payload, HASH_OPTIONS);
  db.prepare(
    `INSERT INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id,
        entity_key, remote_id, payload, content_hash, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(PROJECT, VERSION, item.kind, GENERATION, item.key, remoteId, canonicalJson(payload), hash, PULLED_AT);
  db.prepare(
    `INSERT INTO id_map
       (project_id, project_version_id, entity_kind, generation_id,
        entity_key, remote_id, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(PROJECT, VERSION, item.kind, GENERATION, item.key, remoteId, PULLED_AT);
  return hash;
}

function value(payload: Record<string, JsonValue> | null, field: string): FieldValue {
  if (payload === null || !Object.hasOwn(payload, field)) return { present: false, value: null };
  return { present: true, value: payload[field] ?? null };
}

function fields(
  base: Record<string, JsonValue> | null,
  ours: Record<string, JsonValue> | null,
): FieldDiff[] {
  const names = new Set([...Object.keys(base ?? {}), ...Object.keys(ours ?? {})]);
  return [...names].sort().map((field) => ({
    field,
    base: value(base, field),
    ours: value(ours, field),
    theirs: value(base, field),
  })).filter((field) => canonicalJson(field.base) !== canonicalJson(field.ours));
}

function item(
  operation: PlanOp,
  slug: string,
  base: Record<string, JsonValue> | null,
  ours: Record<string, JsonValue> | null,
): PlanItem {
  return {
    projectId: PROJECT,
    projectVersionId: VERSION,
    kind: "threat",
    key: ENTITIES.threat.key({ slug }),
    label: slug,
    operation,
    expectedBaseContentHash: base === null
      ? null
      : createSerializer("threat").contentHash(base, HASH_OPTIONS),
    fields: operation === "noop" ? [] : fields(base, ours),
    conflicts: [],
    referrers: [],
    error: null,
  };
}

function operationSummary(items: readonly PlanItem[]): Plan["summary"] {
  const count = (operation: PlanOp): number => items.filter((candidate) => candidate.operation === operation).length;
  return {
    creates: count("create"),
    updates: count("update"),
    deletes: count("delete"),
    noops: count("noop"),
    conflicts: count("conflict"),
    orphans: count("orphan"),
  };
}

function planWithoutSha(plan: Plan): Omit<Plan, "planSha256"> {
  const { planSha256: _ignored, ...unsigned } = plan;
  return unsigned;
}

async function persistPlan(
  db: Database.Database,
  root: string,
  items: PlanItem[],
  options: { degraded?: boolean; requiresHumanReview?: boolean } = {},
): Promise<Plan> {
  planSequence += 1;
  const metadata = syncMetadata(
    { db },
    { projectId: PROJECT, projectVersionId: VERSION },
    [...new Set(items.map((candidate) => candidate.kind))],
  );
  const unsigned: Plan = {
    projectId: PROJECT,
    projectVersionId: VERSION,
    planId: `01K${String(planSequence).padStart(23, "0")}`,
    planSha256: "",
    baseGenerationIds: metadata.acceptedGenerationIds,
    baseRevisions: metadata.baseRevisions,
    baseStateSha256: metadata.baseStateSha256,
    createdAt: PULLED_AT,
    staleness: { asOf: PULLED_AT, degraded: options.degraded ?? false },
    items,
    summary: operationSummary(items),
    blastRadius: {
      requiresHumanReview: options.requiresHumanReview ?? items.some((candidate) => candidate.operation === "delete"),
      changed: items.filter((candidate) => ["create", "update", "delete"].includes(candidate.operation)).length,
      deletes: items.filter((candidate) => candidate.operation === "delete").length,
      remoteCalls: items.filter((candidate) => ["create", "update", "delete"].includes(candidate.operation)).length,
      surfaces: ["threat"],
    },
    validationErrors: items.flatMap((candidate) => candidate.error === null ? [] : [candidate.error]),
    total: items.length,
    next: null,
    cache: {
      state: options.degraded ? "stale" : "fresh",
      asOf: PULLED_AT,
      message: options.degraded ? "degraded" : null,
      acceptedGenerationId: GENERATION,
      baseRevision: 0,
    },
  };
  const complete = { ...unsigned, planSha256: contentHash(planWithoutSha(unsigned)) };
  await mkdir(join(root, ".fs-sync"), { recursive: true });
  await writeFile(join(root, ".fs-sync", `plan-${complete.planId}.json`), `${JSON.stringify(complete)}\n`);
  return complete;
}

function applyFields(
  payload: Record<string, unknown> | null,
  planItem: PlanItem,
): Record<string, unknown> | null {
  if (planItem.operation === "delete") return null;
  const next = structuredClone(payload ?? {});
  for (const field of planItem.fields) {
    if (field.ours.present) next[field.field] = structuredClone(field.ours.value);
    else delete next[field.field];
  }
  return next;
}

interface FakePusherOptions {
  indeterminateKey?: string;
  dropField?: string;
}

function fakePusher(
  initial: ReadonlyMap<string, { payload: Record<string, unknown>; remoteId: string }>,
  audit: string[],
  options: FakePusherOptions = {},
): EntityPusher & { remote: Map<string, { payload: Record<string, unknown>; remoteId: string }> } {
  const remote = new Map([...initial.entries()].map(([key, entry]) => [key, structuredClone(entry)]));
  let resetInjected = false;
  const pusher: EntityPusher & {
    remote: Map<string, { payload: Record<string, unknown>; remoteId: string }>;
  } = {
    kind: "threat",
    maxConcurrency: 2,
    remote,
    async apply(planItem): Promise<{
      remoteId: string | null;
      serverPayload: Record<string, unknown> | null;
      verification: "required";
    }> {
      audit.push(planItem.key);
      const prior = remote.get(planItem.key)?.payload ?? null;
      const next = applyFields(prior, planItem);
      if (next === null) {
        remote.delete(planItem.key);
      } else {
        if (options.dropField !== undefined) delete next[options.dropField];
        remote.set(planItem.key, {
          payload: next,
          remoteId: remote.get(planItem.key)?.remoteId ?? `created-${audit.length}`,
        });
      }
      if (options.indeterminateKey === planItem.key && !resetInjected) {
        resetInjected = true;
        throw new IndeterminateRemoteWriteError("assurance-studio", "fake-update");
      }
      return {
        remoteId: remote.get(planItem.key)?.remoteId ?? null,
        serverPayload: next,
        verification: "required",
      };
    },
    async readBack(planItem): Promise<ReadBackResult> {
      const current = remote.get(planItem.key);
      return current === undefined
        ? { exists: false, remoteId: null, payload: null }
        : { exists: true, remoteId: current.remoteId, payload: structuredClone(current.payload) };
    },
  };
  return pusher;
}

function pushOptions(plan: Plan, confirmed = true) {
  return {
    scope: { projectId: PROJECT, projectVersionId: VERSION },
    planId: plan.planId,
    expectedPlanSha256: plan.planSha256,
    expectedBaseStateSha256: plan.baseStateSha256,
    confirmed,
    pageSize: 200,
  };
}

describe("resumable push", () => {
  it("applies six creates, three updates, and one delete in plan order and learns ids", async () => {
    const db = createDb("ordered");
    const root = await createRoot("ordered");
    seedGeneration(db, ["threat"]);
    const creates = Array.from({ length: 6 }, (_, index) => item(
      "create",
      `create-${index}`,
      null,
      { slug: `create-${index}`, title: `Created ${index}` },
    ));
    const updates = Array.from({ length: 3 }, (_, index) => item(
      "update",
      `update-${index}`,
      { slug: `update-${index}`, title: "before" },
      { slug: `update-${index}`, title: "after" },
    ));
    const deletion = item("delete", "delete-0", { slug: "delete-0", title: "remove" }, null);
    const all = [...creates, ...updates, deletion];
    const initial = new Map<string, { payload: Record<string, unknown>; remoteId: string }>();
    for (const candidate of [...updates, deletion]) {
      const payload = {
        slug: candidate.label,
        title: candidate.operation === "delete" ? "remove" : "before",
      };
      const remoteId = `remote-${candidate.label}`;
      seedBase(db, candidate, payload, remoteId);
      initial.set(candidate.key, { payload, remoteId });
    }
    const plan = await persistPlan(db, root, all);
    const audit: string[] = [];
    const pusher = fakePusher(initial, audit);

    const report = await push({ db, worktreeRoot: root, pushers: [pusher] }, pushOptions(plan));

    expect(report.status).toBe("completed");
    expect(report.summary).toEqual({ total: 10, applied: 10, failed: 0, skipped: 0 });
    expect(audit).toEqual(all.map((candidate) => candidate.key));
    const store = new BaseSnapshotStore(db);
    for (const candidate of creates) {
      expect(store.getAccepted(PROJECT, VERSION, "threat", candidate.key)?.remoteId).toMatch(/^created-/u);
    }
    expect(store.getAccepted(PROJECT, VERSION, "threat", deletion.key)).toBeNull();
    expect(syncMetadata({ db }, { projectId: PROJECT, projectVersionId: VERSION }, ["threat"]).baseRevisions)
      .toEqual({ threat: 10 });
  });

  it("logs noop as skipped without touching the remote audit stream", async () => {
    const db = createDb("noop");
    const root = await createRoot("noop");
    seedGeneration(db, ["threat"]);
    const noop = item("noop", "unchanged", { slug: "unchanged", title: "same" }, { slug: "unchanged", title: "same" });
    seedBase(db, noop, { slug: "unchanged", title: "same" }, "remote-unchanged");
    const plan = await persistPlan(db, root, [noop]);
    const audit: string[] = [];
    const report = await push(
      { db, worktreeRoot: root, pushers: [fakePusher(new Map(), audit)] },
      pushOptions(plan),
    );

    expect(audit).toEqual([]);
    expect(report.summary).toEqual({ total: 1, applied: 0, failed: 0, skipped: 1 });
    expect(db.prepare("SELECT status FROM push_log").pluck().get()).toBe("skipped");
  });

  it("does not advance base when required read-back exposes a silently dropped key", async () => {
    const db = createDb("read-back");
    const root = await createRoot("read-back");
    seedGeneration(db, ["threat"]);
    const update = item(
      "update",
      "silent-drop",
      { slug: "silent-drop", title: "before" },
      { slug: "silent-drop", title: "after" },
    );
    seedBase(db, update, { slug: "silent-drop", title: "before" }, "remote-drop");
    const plan = await persistPlan(db, root, [update]);
    const audit: string[] = [];
    const pusher = fakePusher(new Map([[update.key, {
      payload: { slug: "silent-drop", title: "before" },
      remoteId: "remote-drop",
    }]]), audit, { dropField: "title" });

    const report = await push({ db, worktreeRoot: root, pushers: [pusher] }, pushOptions(plan));

    expect(report.status).toBe("failed");
    expect(report.requiresPull).toBe(true);
    expect(report.items[0]?.error?.code).toBe("READ_BACK_MISMATCH");
    expect(new BaseSnapshotStore(db).getAccepted(PROJECT, VERSION, "threat", update.key)?.payload)
      .toEqual({ slug: "silent-drop", title: "before" });
  });

  it("reconciles a reset after write and resume never duplicates its audit write", async () => {
    const db = createDb("reset");
    const root = await createRoot("reset");
    seedGeneration(db, ["threat"]);
    const updates = Array.from({ length: 3 }, (_, index) => item(
      "update",
      `reset-${index}`,
      { slug: `reset-${index}`, title: "before" },
      { slug: `reset-${index}`, title: "after" },
    ));
    const initial = new Map<string, { payload: Record<string, unknown>; remoteId: string }>();
    for (const candidate of updates) {
      const payload = { slug: candidate.label, title: "before" };
      seedBase(db, candidate, payload, `remote-${candidate.label}`);
      initial.set(candidate.key, { payload, remoteId: `remote-${candidate.label}` });
    }
    const plan = await persistPlan(db, root, updates);
    const audit: string[] = [];
    const pusher = fakePusher(initial, audit, { indeterminateKey: updates[1]?.key });
    const report = await push(
      { db, worktreeRoot: root, pushers: [pusher], createRunId: () => "reset-run" },
      pushOptions(plan),
    );
    expect(report.status).toBe("completed");
    expect(audit).toEqual(updates.map((candidate) => candidate.key));

    const resumed = await resumePush({ db, worktreeRoot: root, pushers: [pusher] }, "reset-run");
    expect(resumed.status).toBe("completed");
    expect(audit).toHaveLength(3);
    const reused = await push(
      { db, worktreeRoot: root, pushers: [pusher] },
      { ...pushOptions(plan), runId: "reset-run" },
    );
    expect(reused.status).toBe("completed");
    expect(audit).toHaveLength(3);
    expect(db.prepare("SELECT COUNT(*) FROM push_log WHERE run_id = 'reset-run'").pluck().get()).toBe(3);
  });

  it("does not cross a failed ordered item or a requires-pull fence on resume", async () => {
    const db = createDb("resume-barrier");
    const root = await createRoot("resume-barrier");
    seedGeneration(db, ["threat"]);
    const updates = ["barrier-a", "barrier-b"].map((slug) => item(
      "update",
      slug,
      { slug, title: "before" },
      { slug, title: "after" },
    ));
    const initial = new Map<string, { payload: Record<string, unknown>; remoteId: string }>();
    for (const candidate of updates) {
      const payload = { slug: candidate.label, title: "before" };
      seedBase(db, candidate, payload, `remote-${candidate.label}`);
      initial.set(candidate.key, { payload, remoteId: `remote-${candidate.label}` });
    }
    const plan = await persistPlan(db, root, updates);
    const audit: string[] = [];
    const pusher = fakePusher(initial, audit, { dropField: "title" });
    const first = await push(
      { db, worktreeRoot: root, pushers: [pusher], createRunId: () => "barrier-run" },
      pushOptions(plan),
    );
    expect(first.requiresPull).toBe(true);
    expect(audit).toEqual([updates[0]?.key]);

    const resumed = await resumePush({ db, worktreeRoot: root, pushers: [pusher] }, "barrier-run");

    expect(resumed.status).toBe("failed");
    expect(resumed.requiresPull).toBe(true);
    expect(audit).toEqual([updates[0]?.key]);
  });

  it("rejects stale, unresolved, invalid, and unconfirmed plans before any server or journal write", async () => {
    const db = createDb("preflight");
    const root = await createRoot("preflight");
    seedGeneration(db, ["threat"]);
    const create = item("create", "stale", null, { slug: "stale", title: "new" });
    const stale = await persistPlan(db, root, [create]);
    db.prepare(
      `UPDATE sync_state SET base_revision = 1
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'threat'`,
    ).run(PROJECT, VERSION);
    const audit: string[] = [];
    const pusher = fakePusher(new Map(), audit);
    await expect(push({ db, worktreeRoot: root, pushers: [pusher] }, pushOptions(stale)))
      .rejects.toMatchObject({ code: "PLAN_STALE" });

    db.prepare(
      `UPDATE sync_state SET base_revision = 0
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'threat'`,
    ).run(PROJECT, VERSION);
    const conflict = { ...create, operation: "conflict" as const };
    const unresolved = await persistPlan(db, root, [conflict]);
    await expect(push({ db, worktreeRoot: root, pushers: [pusher] }, pushOptions(unresolved)))
      .rejects.toMatchObject({ code: "PLAN_CONFLICT_UNRESOLVED" });

    const invalid = await persistPlan(db, root, [{
      ...create,
      error: {
        code: "WORKING_INVALID",
        message: "injected validation failure",
        artifactId: "product-security/threats/stale.yaml",
        line: 1,
      },
    }]);
    await expect(push({ db, worktreeRoot: root, pushers: [pusher] }, pushOptions(invalid)))
      .rejects.toMatchObject({ code: "PLAN_VALIDATION_FAILED" });

    const unconfirmed = await persistPlan(db, root, [create], { requiresHumanReview: true });
    await expect(push({ db, worktreeRoot: root, pushers: [pusher] }, pushOptions(unconfirmed, false)))
      .rejects.toMatchObject({ code: "BLAST_RADIUS_UNCONFIRMED" });
    expect(audit).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) FROM push_log").pluck().get()).toBe(0);
  });

  it("rejects degraded plans with PLAN_STALE before any server write", async () => {
    const db = createDb("degraded-preflight");
    const root = await createRoot("degraded-preflight");
    seedGeneration(db, ["threat"]);
    const create = item("create", "degraded", null, { slug: "degraded", title: "new" });
    const degraded = await persistPlan(db, root, [create], { degraded: true });
    const audit: string[] = [];
    const pusher = fakePusher(new Map(), audit);

    await expect(push({ db, worktreeRoot: root, pushers: [pusher] }, pushOptions(degraded)))
      .rejects.toMatchObject({ code: "PLAN_STALE" });
    expect(audit).toEqual([]);
  });

  it("maps TARA pre-head 409 and preserves already-applied rows on checkpoint failure", async () => {
    const db = createDb("tara");
    const root = await createRoot("tara");
    seedGeneration(db, ["threat"]);
    const updates = ["tara-a", "tara-b"].map((slug) => item(
      "update",
      slug,
      { slug, title: "before" },
      { slug, title: "after" },
    ));
    const initial = new Map<string, { payload: Record<string, unknown>; remoteId: string }>();
    for (const candidate of updates) {
      const payload = { slug: candidate.label, title: "before" };
      seedBase(db, candidate, payload, `remote-${candidate.label}`);
      initial.set(candidate.key, { payload, remoteId: `remote-${candidate.label}` });
    }
    const plan = await persistPlan(db, root, updates);
    const staleError = () => new RemoteError("stale", {
      service: "assurance-studio",
      code: "REMOTE_HTTP_409",
      status: 409,
      retryable: false,
      retryAfterMs: null,
      details: { code: "stale_tara_state" },
    });
    const noAudit: string[] = [];
    const preHeadBase = fakePusher(initial, noAudit);
    const preHead: EntityPusher = {
      ...preHeadBase,
      async beginGroup() { throw staleError(); },
      async commitGroup() { return undefined; },
    };
    const preHeadReport = await push(
      { db, worktreeRoot: root, pushers: [preHead], createRunId: () => "tara-pre-head" },
      pushOptions(plan),
    );
    expect(preHeadReport.items[0]?.error?.code).toBe("STALE_TARA_STATE");
    expect(noAudit).toEqual([]);

    db.prepare("DELETE FROM push_log").run();
    await rm(join(root, ".fs-sync", "push-tara-pre-head.json"), { force: true });
    const audit: string[] = [];
    const checkpointBase = fakePusher(initial, audit);
    const checkpoint: EntityPusher = {
      ...checkpointBase,
      async beginGroup(_items: readonly PlanItem[], _ctx: PushContext) { return { expectedHeadVersionId: "head-1" }; },
      async commitGroup() { throw staleError(); },
    };
    const checkpointReport = await push(
      { db, worktreeRoot: root, pushers: [checkpoint], createRunId: () => "tara-checkpoint" },
      pushOptions(plan),
    );
    expect(checkpointReport.status).toBe("failed");
    expect(checkpointReport.requiresPull).toBe(true);
    expect(checkpointReport.summary.applied).toBe(2);
    expect(audit).toEqual(updates.map((candidate) => candidate.key));
    for (const candidate of updates) {
      expect(new BaseSnapshotStore(db).getAccepted(PROJECT, VERSION, "threat", candidate.key)?.payload)
        .toEqual({ slug: candidate.label, title: "after" });
    }
  });

  it("publishes only tiny progress hints and never entity payloads", async () => {
    const db = createDb("progress");
    const root = await createRoot("progress");
    seedGeneration(db, ["threat"]);
    const create = item("create", "progress", null, { slug: "progress", title: "secret model data" });
    const plan = await persistPlan(db, root, [create]);
    const hints: unknown[] = [];
    await push({
      db,
      worktreeRoot: root,
      pushers: [fakePusher(new Map(), [])],
      publishPush: (hint) => hints.push(hint),
    }, pushOptions(plan));
    expect(hints.length).toBeGreaterThan(1);
    expect(JSON.stringify(hints)).not.toContain("secret model data");
    expect(hints.every((hint) => {
      if (typeof hint !== "object" || hint === null) return false;
      return Object.keys(hint).every((key) => [
        "runId", "phase", "completed", "total", "applied", "failed", "skipped",
      ].includes(key));
    })).toBe(true);
  });

  it("treats progress fanout as best-effort observation", async () => {
    const db = createDb("progress-failure");
    const root = await createRoot("progress-failure");
    seedGeneration(db, ["threat"]);
    const create = item("create", "progress-failure", null, { slug: "progress-failure", title: "new" });
    const plan = await persistPlan(db, root, [create]);
    const report = await push({
      db,
      worktreeRoot: root,
      pushers: [fakePusher(new Map(), [])],
      publishPush: () => { throw new Error("fanout offline"); },
    }, pushOptions(plan));

    expect(report.status).toBe("completed");
    expect(report.summary.applied).toBe(1);
  });
});
