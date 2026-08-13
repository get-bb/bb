import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { ENTITIES, type EntityKind } from "../../../lib/sync/registry.js";
import type { EntityAdapter, ServerEntity } from "../engine/adapter.js";
import { syncMetadata } from "../engine/status.js";
import { conflictingFields, threeWayDiff } from "../plan/diff.js";
import { computePlan, type Plan, type PlanItem, type PlanOp } from "../plan/index.js";
import { blastRadius } from "../plan/blast-radius.js";
import { registerValidator } from "../plan/validate.js";
import { canonicalJson, contentHash } from "../serialize/canonical.js";
import { createSerializer } from "../serialize/serializer.js";
import { emitYaml } from "../serialize/yaml.js";
import { BaseSnapshotStore } from "../store/base-snapshot.js";
import {
  ConflictResolutionError,
  materializeExistingWorking,
  resolveConflict,
  type ConflictDeps,
} from "./resolve.js";

const PROJECT = "project-conflicts";
const VERSION = "version-conflicts";
const GENERATION = "generation-conflicts";
const NOW = "2026-08-13T02:00:00.000Z";
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];
let sequence = 0;

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createDb(): Database.Database {
  const host = createFakePluginHost({ pluginId: `finite-state-conflicts-${hosts.length}` });
  hosts.push(host);
  return createPluginContext(host.bb).db();
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "finite-state-conflicts-"));
  roots.push(root);
  return root;
}

function seedGeneration(db: Database.Database, kind: EntityKind): void {
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
     VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?)`,
  ).run(PROJECT, VERSION, GENERATION, JSON.stringify([kind]), NOW, NOW, NOW);
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        base_revision, last_pull)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(PROJECT, VERSION, kind, GENERATION, NOW);
}

const HASH_OPTIONS = {
  idToSlug: (_remoteId: string): null => null,
  onWarning: (): void => undefined,
};

function seedBase(
  db: Database.Database,
  kind: EntityKind,
  key: string,
  payload: Record<string, unknown>,
): string {
  const hash = createSerializer(kind).contentHash(payload, HASH_OPTIONS);
  db.prepare(
    `INSERT INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id,
        entity_key, remote_id, payload, content_hash, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(PROJECT, VERSION, kind, GENERATION, key, `remote-${key}`, canonicalJson(payload), hash, NOW);
  db.prepare(
    `INSERT INTO id_map
       (project_id, project_version_id, entity_kind, generation_id,
        entity_key, remote_id, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(PROJECT, VERSION, kind, GENERATION, key, `remote-${key}`, NOW);
  return hash;
}

function summary(items: readonly PlanItem[]): Plan["summary"] {
  const count = (operation: PlanOp): number => items.filter((item) => item.operation === operation).length;
  return {
    creates: count("create"),
    updates: count("update"),
    deletes: count("delete"),
    noops: count("noop"),
    conflicts: count("conflict"),
    orphans: count("orphan"),
  };
}

function withoutPlanSha(plan: Plan): Omit<Plan, "planSha256"> {
  const { planSha256: _ignored, ...unsigned } = plan;
  return unsigned;
}

async function persistPlan(
  deps: Pick<ConflictDeps, "db" | "worktreeRoot">,
  item: PlanItem,
): Promise<Plan> {
  sequence += 1;
  const metadata = syncMetadata(deps, { projectId: PROJECT, projectVersionId: VERSION }, [item.kind]);
  const unsigned: Plan = {
    projectId: PROJECT,
    projectVersionId: VERSION,
    planId: `01K${String(sequence).padStart(23, "0")}`,
    planSha256: "",
    baseGenerationIds: metadata.acceptedGenerationIds,
    baseRevisions: metadata.baseRevisions,
    baseStateSha256: metadata.baseStateSha256,
    createdAt: NOW,
    staleness: { asOf: NOW, degraded: false },
    items: [item],
    summary: summary([item]),
    blastRadius: blastRadius([item]),
    validationErrors: [],
    total: 1,
    next: null,
    cache: {
      state: "fresh",
      asOf: NOW,
      message: null,
      acceptedGenerationId: GENERATION,
      baseRevision: 0,
    },
  };
  const plan = { ...unsigned, planSha256: contentHash(withoutPlanSha(unsigned)) };
  await mkdir(join(deps.worktreeRoot, ".fs-sync"), { recursive: true });
  await writeFile(
    join(deps.worktreeRoot, ".fs-sync", `plan-${plan.planId}.json`),
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8",
  );
  return plan;
}

function conflictItem(
  kind: EntityKind,
  key: string,
  base: Record<string, unknown>,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
  expectedBaseContentHash: string,
): PlanItem {
  const fields = threeWayDiff(base, ours, theirs);
  return {
    projectId: PROJECT,
    projectVersionId: VERSION,
    kind,
    key,
    label: key,
    operation: "conflict",
    expectedBaseContentHash,
    fields,
    conflicts: conflictingFields(fields).map((field) => ({
      ...field,
      attribution: null,
      suggestion: null,
      resolution: null,
    })),
    referrers: [],
    error: null,
  };
}

async function fixture(input: {
  kind: "threat" | "vexDecision";
  base: Record<string, unknown>;
  ours: Record<string, unknown>;
  theirs: Record<string, unknown>;
}): Promise<{
  deps: ConflictDeps;
  plan: Plan;
  key: string;
  file: string;
  setRemote(next: Record<string, unknown>): void;
}> {
  const db = createDb();
  const root = await createRoot();
  const key = input.kind === "threat"
    ? ENTITIES.threat.key({ slug: String(input.base["slug"]) })
    : ENTITIES.vexDecision.key({
      cve: "CVE-2026-0001",
      purl: "pkg:generic/example@1.0.0",
      name: "example",
      group: null,
      version: "1.0.0",
    });
  const relativeFile = `working/${input.kind}.yaml`;
  const file = join(root, relativeFile);
  await mkdir(join(root, "working"), { recursive: true });
  await writeFile(file, emitYaml(input.ours), "utf8");
  let remotePayload = structuredClone(input.theirs);
  const serverPayload = (): Record<string, unknown> => input.kind === "threat"
    ? {
      id: `remote-${key}`,
      projectId: PROJECT,
      kind: "threat",
      fields: structuredClone(remotePayload),
      humanEdited: null,
      reviewStatus: null,
      reviewVersion: null,
    }
    : structuredClone(remotePayload);
  const adapter: EntityAdapter = {
    kind: input.kind,
    klass: input.kind === "vexDecision" ? "OVERLAY" : "VERSIONED",
    serializer: createSerializer(input.kind),
    async *fetchRemote() {
      const row: ServerEntity = {
        key,
        remoteId: `remote-${key}`,
        payload: serverPayload(),
      };
      yield [row];
    },
    async readWorking(worktreeRoot) {
      const payload = this.serializer.fromYaml(await readFile(join(worktreeRoot, relativeFile), "utf8"), relativeFile);
      return [{ key, payload, file: relativeFile }];
    },
  };
  seedGeneration(db, input.kind);
  const baseHash = seedBase(db, input.kind, key, input.base);
  const deps: ConflictDeps = {
    db,
    worktreeRoot: root,
    adapters: [adapter],
    resolvedBy: "reviewer@example.com",
    now: () => new Date(NOW),
  };
  const plan = await persistPlan(deps, conflictItem(
    input.kind,
    key,
    input.base,
    input.ours,
    input.theirs,
    baseHash,
  ));
  return {
    deps,
    plan,
    key,
    file,
    setRemote(next) {
      remotePayload = structuredClone(next);
    },
  };
}

describe("explicit conflict resolution", () => {
  it("take-ours changes only the CAS-protected plan and preserves working YAML/base", async () => {
    const value = await fixture({
      kind: "threat",
      base: { slug: "threat-a", title: "base" },
      ours: { slug: "threat-a", title: "ours" },
      theirs: { slug: "threat-a", title: "theirs" },
    });
    const beforeFile = await readFile(value.file, "utf8");
    const beforeBase = new BaseSnapshotStore(value.deps.db).getAccepted(PROJECT, VERSION, "threat", value.key);
    const resolved = await resolveConflict(value.deps, {
      planId: value.plan.planId,
      expectedPlanSha256: value.plan.planSha256,
      kind: "threat",
      key: value.key,
      path: "/title",
      resolution: { choice: "take-ours" },
    });
    expect(await readFile(value.file, "utf8")).toBe(beforeFile);
    expect(new BaseSnapshotStore(value.deps.db).getAccepted(PROJECT, VERSION, "threat", value.key)).toEqual(beforeBase);
    expect(resolved.planSha256).not.toBe(value.plan.planSha256);
    expect(resolved.items[0]).toMatchObject({
      operation: "update",
      conflicts: [{ field: "/title", resolution: { choice: "take-ours" } }],
    });
    expect(resolved.summary).toMatchObject({ updates: 1, conflicts: 0 });
    expect(resolved.blastRadius).toMatchObject({ changed: 1, remoteCalls: 1 });
  });

  it("take-theirs CAS-writes YAML and advances the base to identical remote semantics", async () => {
    const value = await fixture({
      kind: "threat",
      base: { slug: "threat-b", title: "base" },
      ours: { slug: "threat-b", title: "ours" },
      theirs: { slug: "threat-b", title: "theirs" },
    });
    const resolved = await resolveConflict(value.deps, {
      planId: value.plan.planId,
      expectedPlanSha256: value.plan.planSha256,
      kind: "threat",
      key: value.key,
      path: "/title",
      resolution: { choice: "take-theirs" },
    });
    const authored = createSerializer("threat").fromYaml(await readFile(value.file, "utf8"), value.file);
    const base = new BaseSnapshotStore(value.deps.db).getAccepted(PROJECT, VERSION, "threat", value.key);
    expect(authored).toEqual({ slug: "threat-b", title: "theirs" });
    expect(base?.payload).toEqual(authored);
    expect(resolved.items[0]?.operation).toBe("noop");
    expect(resolved.summary).toMatchObject({ noops: 1, conflicts: 0 });
    expect(resolved.blastRadius).toMatchObject({ changed: 0, remoteCalls: 0 });
    expect(resolved.baseRevisions.threat).toBe(1);
    expect(resolved.items[0]?.expectedBaseContentHash).toBe(base?.contentHash);
  });

  it("edited CAS-writes the validated value, retains the original base, and becomes planned ours", async () => {
    const value = await fixture({
      kind: "threat",
      base: { slug: "threat-edited", title: "base" },
      ours: { slug: "threat-edited", title: "ours" },
      theirs: { slug: "threat-edited", title: "theirs" },
    });
    const baseBefore = new BaseSnapshotStore(value.deps.db).getAccepted(PROJECT, VERSION, "threat", value.key);
    const resolved = await resolveConflict(value.deps, {
      planId: value.plan.planId,
      expectedPlanSha256: value.plan.planSha256,
      kind: "threat",
      key: value.key,
      path: "/title",
      resolution: { choice: "edited", value: "reviewed" },
    });
    expect(createSerializer("threat").fromYaml(await readFile(value.file, "utf8"), value.file))
      .toEqual({ slug: "threat-edited", title: "reviewed" });
    expect(new BaseSnapshotStore(value.deps.db).getAccepted(PROJECT, VERSION, "threat", value.key))
      .toEqual(baseBefore);
    expect(resolved.items[0]).toMatchObject({
      operation: "update",
      conflicts: [{
        field: "/title",
        resolution: { choice: "edited", value: "reviewed" },
      }],
    });
  });

  it.each([
    { first: "title", title: "take-theirs", description: "take-ours" },
    { first: "description", title: "take-theirs", description: "take-ours" },
    { first: "title", title: "take-ours", description: "take-theirs" },
    { first: "description", title: "take-ours", description: "take-theirs" },
  ] as const)(
    "keeps the sibling conflict live when resolving $first first ($title/$description)",
    async ({ first, title, description }) => {
      const basePayload = { slug: "threat-multi", title: "base-title", description: "base-description" };
      const oursPayload = { slug: "threat-multi", title: "ours-title", description: "ours-description" };
      const theirsPayload = { slug: "threat-multi", title: "theirs-title", description: "theirs-description" };
      const value = await fixture({
        kind: "threat",
        base: basePayload,
        ours: oursPayload,
        theirs: theirsPayload,
      });
      const choices = { title, description };
      const second = first === "title" ? "description" : "title";
      const firstPlan = await resolveConflict(value.deps, {
        planId: value.plan.planId,
        expectedPlanSha256: value.plan.planSha256,
        kind: "threat",
        key: value.key,
        path: `/${first}`,
        resolution: { choice: choices[first] },
      });

      const firstItem = firstPlan.items[0];
      expect(firstItem?.operation).toBe("conflict");
      expect(firstItem?.conflicts.find((conflict) => conflict.field === `/${first}`)?.resolution)
        .toEqual({ choice: choices[first] });
      expect(firstItem?.conflicts.find((conflict) => conflict.field === `/${second}`)?.resolution)
        .toBeNull();
      const baseAfterFirst = new BaseSnapshotStore(value.deps.db)
        .getAccepted(PROJECT, VERSION, "threat", value.key)?.payload;
      expect(baseAfterFirst).toEqual({
        ...basePayload,
        ...(choices[first] === "take-theirs" ? { [first]: theirsPayload[first] } : {}),
      });

      const replanned = await computePlan(
        value.deps,
        { projectId: PROJECT, projectVersionId: VERSION },
        ["threat"],
      );
      const replannedItem = replanned.items.find((item) => item.key === value.key);
      expect(replannedItem?.operation).toBe("conflict");
      expect(replannedItem?.conflicts.some((conflict) => conflict.field === `/${second}`)).toBe(true);

      const resolved = await resolveConflict(value.deps, {
        planId: firstPlan.planId,
        expectedPlanSha256: firstPlan.planSha256,
        kind: "threat",
        key: value.key,
        path: `/${second}`,
        resolution: { choice: choices[second] },
      });
      const authored = createSerializer("threat").fromYaml(await readFile(value.file, "utf8"), value.file);
      expect(authored).toEqual({
        slug: "threat-multi",
        title: title === "take-theirs" ? theirsPayload.title : oursPayload.title,
        description: description === "take-theirs" ? theirsPayload.description : oursPayload.description,
      });
      expect(new BaseSnapshotStore(value.deps.db).getAccepted(PROJECT, VERSION, "threat", value.key)?.payload)
        .toEqual({
          ...basePayload,
          ...(title === "take-theirs" ? { title: theirsPayload.title } : {}),
          ...(description === "take-theirs" ? { description: theirsPayload.description } : {}),
        });
      expect(resolved.items[0]?.operation).toBe("update");
      expect(resolved.items[0]?.conflicts).toHaveLength(2);
      expect(resolved.items[0]?.conflicts.every((conflict) => conflict.resolution !== null)).toBe(true);
    },
  );

  it("rejects stale plan/working fences without a partial base or plan write", async () => {
    const value = await fixture({
      kind: "threat",
      base: { slug: "threat-c", title: "base" },
      ours: { slug: "threat-c", title: "ours" },
      theirs: { slug: "threat-c", title: "theirs" },
    });
    await expect(resolveConflict(value.deps, {
      planId: value.plan.planId,
      expectedPlanSha256: "f".repeat(64),
      kind: "threat",
      key: value.key,
      path: "/title",
      resolution: { choice: "take-theirs" },
    })).rejects.toMatchObject({ code: "PLAN_FENCE_MISMATCH" });

    await writeFile(value.file, emitYaml({ slug: "threat-c", title: "newer" }), "utf8");
    const planBefore = await readFile(join(value.deps.worktreeRoot, ".fs-sync", `plan-${value.plan.planId}.json`), "utf8");
    const baseBefore = new BaseSnapshotStore(value.deps.db).getAccepted(PROJECT, VERSION, "threat", value.key);
    await expect(resolveConflict(value.deps, {
      planId: value.plan.planId,
      expectedPlanSha256: value.plan.planSha256,
      kind: "threat",
      key: value.key,
      path: "/title",
      resolution: { choice: "take-theirs" },
    })).rejects.toMatchObject({ code: "WORKING_STALE" });
    expect(await readFile(join(value.deps.worktreeRoot, ".fs-sync", `plan-${value.plan.planId}.json`), "utf8"))
      .toBe(planBefore);
    expect(new BaseSnapshotStore(value.deps.db).getAccepted(PROJECT, VERSION, "threat", value.key))
      .toEqual(baseBefore);
  });

  it("rolls back a materialized file when the remote tuple moves before base advance", async () => {
    const value = await fixture({
      kind: "threat",
      base: { slug: "threat-d", title: "base" },
      ours: { slug: "threat-d", title: "ours" },
      theirs: { slug: "threat-d", title: "theirs" },
    });
    const original = await readFile(value.file, "utf8");
    const originalBase = new BaseSnapshotStore(value.deps.db).getAccepted(PROJECT, VERSION, "threat", value.key);
    value.setRemote({ slug: "threat-d", title: "newer-remote" });
    value.deps.materializeWorking = materializeExistingWorking;
    await expect(resolveConflict(value.deps, {
      planId: value.plan.planId,
      expectedPlanSha256: value.plan.planSha256,
      kind: "threat",
      key: value.key,
      path: "/title",
      resolution: { choice: "take-theirs" },
    })).rejects.toMatchObject({ code: "REMOTE_STALE" });
    expect(await readFile(value.file, "utf8")).toBe(original);
    expect(new BaseSnapshotStore(value.deps.db).getAccepted(PROJECT, VERSION, "threat", value.key))
      .toEqual(originalBase);
  });

  it("rejects an edited invalid VEX vocabulary value and leaves the plan unresolved", async () => {
    const value = await fixture({
      kind: "vexDecision",
      base: { status: "AFFECTED", justification: null, response: null, reason: "base" },
      ours: { status: "NOT_AFFECTED", justification: "CODE_NOT_REACHABLE", response: null, reason: "ours" },
      theirs: { status: "RESOLVED", justification: null, response: null, reason: "theirs" },
    });
    const fileBefore = await readFile(value.file, "utf8");
    const planFile = join(value.deps.worktreeRoot, ".fs-sync", `plan-${value.plan.planId}.json`);
    const planBefore = await readFile(planFile, "utf8");
    await expect(resolveConflict(value.deps, {
      planId: value.plan.planId,
      expectedPlanSha256: value.plan.planSha256,
      kind: "vexDecision",
      key: value.key,
      path: "/status",
      resolution: { choice: "edited", value: "NOT_A_VEX_STATUS" },
    })).rejects.toBeInstanceOf(ConflictResolutionError);
    expect(await readFile(value.file, "utf8")).toBe(fileBefore);
    expect(await readFile(planFile, "utf8")).toBe(planBefore);
  });

  it("rejects a registered referential validator failure before materialization", async () => {
    registerValidator("threat", (item, context) => {
      const payload = context.payloads.get(`${item.kind}\0${item.key}`);
      return payload?.["target"] === "missing-target"
        ? {
          ...item,
          error: {
            code: "REFERENCE_MISSING",
            message: "edited target does not resolve",
            artifactId: null,
            line: null,
          },
        }
        : item;
    });
    const value = await fixture({
      kind: "threat",
      base: { slug: "threat-reference", target: "base-target" },
      ours: { slug: "threat-reference", target: "ours-target" },
      theirs: { slug: "threat-reference", target: "theirs-target" },
    });
    const fileBefore = await readFile(value.file, "utf8");
    const planFile = join(value.deps.worktreeRoot, ".fs-sync", `plan-${value.plan.planId}.json`);
    const planBefore = await readFile(planFile, "utf8");
    await expect(resolveConflict(value.deps, {
      planId: value.plan.planId,
      expectedPlanSha256: value.plan.planSha256,
      kind: "threat",
      key: value.key,
      path: "/target",
      resolution: { choice: "edited", value: "missing-target" },
    })).rejects.toMatchObject({ code: "EDITED_VALUE_INVALID" });
    expect(await readFile(value.file, "utf8")).toBe(fileBefore);
    expect(await readFile(planFile, "utf8")).toBe(planBefore);
  });
});
