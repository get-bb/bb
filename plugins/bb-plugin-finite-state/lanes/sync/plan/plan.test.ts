import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { RemoteError } from "../../../lib/remote/types.js";
import { ENTITIES } from "../../../lib/sync/registry.js";
import type { EntityAdapter, ServerEntity, WorkingEntity } from "../engine/adapter.js";
import { pull, type EngineDeps } from "../engine/pull.js";
import { canonicalJson } from "../serialize/canonical.js";
import { createSerializer } from "../serialize/serializer.js";
import { blastRadius } from "./blast-radius.js";
import { classifyThreeWay } from "./diff.js";
import { computePlan, loadPlan } from "./index.js";
import { renderPlanCli } from "./render-cli.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];
const scope = { projectId: "project-plan", projectVersionId: "version-plan" };

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function requirement(reqId: string, title: string, fields: Record<string, unknown> = {}): ServerEntity {
  return {
    key: ENTITIES.requirement.key({ reqId }),
    remoteId: `remote-${reqId}`,
    payload: {
      id: `remote-${reqId}`,
      projectId: scope.projectId,
      kind: "requirement",
      fields: { reqId, title, ...fields },
      humanEdited: null,
      reviewStatus: null,
      reviewVersion: null,
    },
  };
}

function working(entity: ServerEntity, title?: string): WorkingEntity {
  const payload = createSerializer("requirement").semanticPayload(entity.payload);
  return {
    key: entity.key,
    payload: { ...payload, title: title ?? payload["title"] },
    file: `product-security/requirements/${String(payload["reqId"])}.yaml`,
  };
}

async function fixture(
  remote: () => ServerEntity[],
  authored: () => WorkingEntity[],
): Promise<{ adapter: EntityAdapter; deps: EngineDeps; root: string }> {
  const host = createFakePluginHost({ pluginId: `finite-state-plan-${hosts.length}` });
  hosts.push(host);
  const root = await mkdtemp(join(tmpdir(), "finite-state-plan-"));
  roots.push(root);
  const adapter: EntityAdapter = {
    kind: "requirement",
    klass: "VERSIONED",
    serializer: createSerializer("requirement"),
    async *fetchRemote(_scope, progress) {
      progress({ page: 1, of: 1 });
      yield remote();
    },
    async readWorking() {
      return authored();
    },
  };
  const deps: EngineDeps = {
    db: createPluginContext(host.bb).db(),
    worktreeRoot: null,
    adapters: [adapter],
    createGenerationId: () => `generation-plan-${hosts.length}`,
    now: () => new Date("2026-08-12T20:00:00.000Z"),
  };
  return { adapter, deps, root };
}

function databaseSnapshot(deps: EngineDeps): string {
  return canonicalJson({
    generations: deps.db.prepare("SELECT * FROM pull_generation ORDER BY generation_id").all(),
    state: deps.db.prepare("SELECT * FROM sync_state ORDER BY entity_kind").all(),
    base: deps.db.prepare("SELECT * FROM base_snapshot ORDER BY entity_kind, entity_key").all(),
    ids: deps.db.prepare("SELECT * FROM id_map ORDER BY entity_kind, entity_key").all(),
  });
}

describe("three-way plan", () => {
  it("classifies create, update, delete, noop, and conflict without treating noops as writes", async () => {
    const update = requirement("REQ-UPDATE", "base update");
    const deleted = requirement("REQ-DELETE", "base delete");
    const noop = requirement("REQ-NOOP", "same");
    const conflict = requirement("REQ-CONFLICT", "base conflict");
    const created = requirement("REQ-CREATE", "new");
    let remote = [update, deleted, noop, conflict];
    let authored = remote.map((entity) => working(entity));
    const setup = await fixture(() => remote, () => authored);
    await pull(setup.deps, scope, ["requirement"]);

    remote = [update, deleted, noop, requirement("REQ-CONFLICT", "their conflict")];
    authored = [
      working(created),
      working(update, "our update"),
      working(noop),
      working(conflict, "our conflict"),
    ];
    const plan = await computePlan({ ...setup.deps, worktreeRoot: setup.root }, scope, ["requirement"]);
    expect(Object.fromEntries(plan.items.map((item) => [item.label, item.operation]))).toEqual({
      "REQ-CREATE": "create",
      "REQ-UPDATE": "update",
      "REQ-DELETE": "delete",
      "REQ-CONFLICT": "conflict",
      "REQ-NOOP": "noop",
    });
    expect(plan.summary).toEqual({
      creates: 1,
      updates: 1,
      deletes: 1,
      noops: 1,
      conflicts: 1,
      orphans: 0,
    });
    expect(plan.items.find((item) => item.label === "REQ-NOOP")?.fields).toEqual([]);
  });

  it("computes the SPEC summary and blocks its referenced delete", async () => {
    const updates = Array.from({ length: 3 }, (_, index) => requirement(`REQ-UPDATE-${index + 1}`, "base"));
    const conflicts = Array.from({ length: 2 }, (_, index) => requirement(`REQ-CONFLICT-${index + 1}`, "base"));
    const deleted = requirement("REQ-DELETE-1", "base delete");
    const referrer = requirement("REQ-REFERRER", "referrer", { dependsOn: ["REQ-DELETE-1"] });
    const creates = Array.from({ length: 6 }, (_, index) => requirement(`REQ-CREATE-${index + 1}`, "new"));
    let remote = [...updates, ...conflicts, deleted, referrer];
    let authored = remote.map((entity) => working(entity));
    const setup = await fixture(() => remote, () => authored);
    await pull(setup.deps, scope, ["requirement"]);

    remote = [
      ...updates,
      ...conflicts.map((entity, index) => requirement(`REQ-CONFLICT-${index + 1}`, "theirs")),
      deleted,
      referrer,
    ];
    authored = [
      ...creates.map((entity) => working(entity)),
      ...updates.map((entity) => working(entity, "ours")),
      ...conflicts.map((entity) => working(entity, "ours")),
      working(referrer),
    ];

    const plan = await computePlan({ ...setup.deps, worktreeRoot: setup.root }, scope, ["requirement"]);
    expect(renderPlanCli(plan).split("\n", 1)[0]).toBe(
      "Plan: 6 to create, 3 to update, 1 to delete, 2 conflicts",
    );
    expect(plan.items.find((entry) => entry.label === "REQ-DELETE-1")).toMatchObject({
      operation: "delete",
      referrers: [{ label: "REQ-REFERRER" }],
      error: { code: "REFERENTIAL_INTEGRITY", message: "referenced by REQ-REFERRER" },
    });
  });

  it("blocks a delete when a fresh upstream-only referrer now targets it", async () => {
    const target = requirement("REQ-UPSTREAM-TARGET", "target");
    const referrer = requirement("REQ-UPSTREAM-REF", "referrer");
    let remote = [target, referrer];
    let authored = remote.map((entity) => working(entity));
    const setup = await fixture(() => remote, () => authored);
    await pull(setup.deps, scope, ["requirement"]);

    remote = [target, requirement("REQ-UPSTREAM-REF", "referrer", {
      dependsOn: ["REQ-UPSTREAM-TARGET"],
    })];
    authored = [working(referrer)];
    const plan = await computePlan({ ...setup.deps, worktreeRoot: setup.root }, scope, ["requirement"]);
    expect(plan.items.find((entry) => entry.label === "REQ-UPSTREAM-TARGET")).toMatchObject({
      operation: "delete",
      referrers: [{ label: "REQ-UPSTREAM-REF" }],
      error: { code: "REFERENTIAL_INTEGRITY" },
    });
  });

  it("is read-only across accepted base, authored YAML, and remote state while persisting its sidecar", async () => {
    const entity = requirement("REQ-READ-ONLY", "base");
    let remote = [entity];
    let authored = [working(entity)];
    const setup = await fixture(() => remote, () => authored);
    await pull(setup.deps, scope, ["requirement"]);
    authored = [working(entity, "local edit")];
    const yamlFile = join(setup.root, "requirement.yaml");
    await writeFile(yamlFile, "reqId: REQ-READ-ONLY\ntitle: local edit\n", "utf8");
    const beforeDb = databaseSnapshot(setup.deps);
    const beforeYaml = await readFile(yamlFile, "utf8");
    const beforeRemote = canonicalJson(remote);

    const plan = await computePlan({ ...setup.deps, worktreeRoot: setup.root }, scope, ["requirement"]);

    expect(databaseSnapshot(setup.deps)).toBe(beforeDb);
    expect(await readFile(yamlFile, "utf8")).toBe(beforeYaml);
    expect(canonicalJson(remote)).toBe(beforeRemote);
    expect(loadPlan(setup.root, plan.planId)).toEqual(plan);
    const sidecar = join(setup.root, ".fs-sync", `plan-${plan.planId}.json`);
    const persisted = await readFile(sidecar, "utf8");
    await writeFile(sidecar, persisted.replace("local edit", "tampered edit"), "utf8");
    expect(loadPlan(setup.root, plan.planId)).toBeNull();
  });

  it("degrades atomically to the accepted base after repeated 429 exhaustion", async () => {
    const entity = requirement("REQ-RATE", "base");
    let failing = false;
    let authored = [working(entity)];
    const setup = await fixture(() => {
      if (failing) {
        throw new RemoteError("rate limited", {
          service: "assurance-studio",
          code: "REMOTE_RATE_LIMITED",
          status: 429,
          retryable: true,
          retryAfterMs: 0,
          details: null,
        });
      }
      return [entity];
    }, () => authored);
    await pull(setup.deps, scope, ["requirement"]);
    failing = true;
    authored = [working(entity, "local edit")];

    const plan = await computePlan({ ...setup.deps, worktreeRoot: setup.root }, scope, ["requirement"]);
    expect(plan.staleness).toEqual({ asOf: "2026-08-12T20:00:00.000Z", degraded: true });
    expect(plan.items).toEqual([
      expect.objectContaining({ label: "REQ-RATE", operation: "update" }),
    ]);
  });

  it("discards a partially received refresh after a connection reset", async () => {
    const first = requirement("REQ-FIRST", "base first");
    const second = requirement("REQ-SECOND", "base second");
    let reset = false;
    let authored = [working(first), working(second)];
    const setup = await fixture(() => [first, second], () => authored);
    await pull(setup.deps, scope, ["requirement"]);
    setup.adapter.fetchRemote = async function* (_scope, progress) {
      progress({ page: 1, of: 2 });
      yield [requirement("REQ-FIRST", "partial remote edit")];
      if (reset) throw new TypeError("connection reset");
      yield [second];
    };
    reset = true;
    authored = [working(first, "local first"), working(second)];

    const plan = await computePlan({ ...setup.deps, worktreeRoot: setup.root }, scope, ["requirement"]);
    expect(plan.staleness.degraded).toBe(true);
    expect(plan.items.find((item) => item.label === "REQ-FIRST")?.operation).toBe("update");
    expect(plan.summary.conflicts).toBe(0);
  });

  it("reports the exact aggregate YAML block for an incomplete NOT_AFFECTED decision", async () => {
    const host = createFakePluginHost({ pluginId: `finite-state-plan-vex-${hosts.length}` });
    hosts.push(host);
    const root = await mkdtemp(join(tmpdir(), "finite-state-plan-vex-"));
    roots.push(root);
    const file = ".fs/triage/aggregate.yaml";
    await mkdir(join(root, ".fs/triage"), { recursive: true });
    await writeFile(join(root, file), `component:
  name: busybox
  version: "1.36.1"
decisions:
  CVE-2026-3200:
    status: NOT_AFFECTED
    justification: null
`, "utf8");
    const key = ENTITIES.vexDecision.key({
      cve: "CVE-2026-3200",
      name: "busybox",
      version: "1.36.1",
    });
    const adapter: EntityAdapter = {
      kind: "vexDecision",
      klass: "OVERLAY",
      serializer: createSerializer("vexDecision"),
      async *fetchRemote() { yield []; },
      async readWorking() {
        return [{
          key,
          file,
          payload: {
            status: "NOT_AFFECTED",
            justification: null,
            response: null,
            reason: null,
          },
        }];
      },
    };
    const plan = await computePlan({
      db: createPluginContext(host.bb).db(),
      worktreeRoot: root,
      adapters: [adapter],
      now: () => new Date("2026-08-12T20:00:00.000Z"),
    }, scope, ["vexDecision"]);
    expect(plan.validationErrors).toEqual([
      expect.objectContaining({
        code: "VEX_JUSTIFICATION_REQUIRED",
        artifactId: file,
        line: 5,
      }),
    ]);
  });

  it("sets the blast-radius gate at twenty-one changes and for every delete", () => {
    const item = (index: number, operation: "create" | "delete") => ({
      projectId: scope.projectId,
      projectVersionId: scope.projectVersionId,
      kind: "requirement" as const,
      key: `key-${index}`,
      label: `REQ-${index}`,
      operation,
      expectedBaseContentHash: null,
      fields: [],
      conflicts: [],
      referrers: [],
      error: null,
    });
    expect(blastRadius(Array.from({ length: 20 }, (_, index) => item(index, "create"))).requiresHumanReview)
      .toBe(false);
    expect(blastRadius(Array.from({ length: 21 }, (_, index) => item(index, "create"))).requiresHumanReview)
      .toBe(true);
    expect(blastRadius([item(1, "delete")]).requiresHumanReview).toBe(true);
    const conflicts = Array.from({ length: 21 }, (_, index) => ({
      ...item(index, "create"),
      operation: "conflict" as const,
    }));
    expect(blastRadius(conflicts).requiresHumanReview).toBe(true);
  });
});

describe("three-way classification matrix", () => {
  const base = { title: "base" };

  it.each([
    [undefined, { title: "ours" }, undefined, "create"],
    [base, { title: "ours" }, base, "update"],
    [base, undefined, base, "delete"],
    [base, base, base, "noop"],
    [base, { title: "ours" }, { title: "theirs" }, "conflict"],
    [base, { title: "same" }, { title: "same" }, "noop"],
  ] as const)("classifies %#", (prior, ours, theirs, expected) => {
    expect(classifyThreeWay(prior, ours, theirs)).toBe(expected);
  });
});
