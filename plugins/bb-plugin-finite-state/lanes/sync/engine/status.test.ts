import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { ENTITIES } from "../../../lib/sync/registry.js";
import { createSerializer } from "../serialize/serializer.js";
import type { EntityAdapter, ServerEntity, WorkingEntity } from "./adapter.js";
import { pull as pullEngine, type EngineDeps } from "./pull.js";
import { status as statusEngine, statusPerKind } from "./status.js";

function pull(
  deps: Parameters<typeof pullEngine>[0],
  scope: Parameters<typeof pullEngine>[1],
  kinds?: Parameters<typeof pullEngine>[2],
) {
  return pullEngine(deps, scope, kinds, {
    assuranceStudioProjectId: `as-${scope.projectId}`,
  });
}

function status(
  deps: Parameters<typeof statusEngine>[0],
  scope: Parameters<typeof statusEngine>[1],
  kinds?: Parameters<typeof statusEngine>[2],
) {
  return statusEngine(deps, scope, kinds, {
    assuranceStudioProjectId: `as-${scope.projectId}`,
  });
}

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const scope = { projectId: "project-wp17", projectVersionId: "version-wp17" };

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

function deps(adapter: EntityAdapter): EngineDeps {
  const host = createFakePluginHost({
    pluginId: `finite-state-status-${hosts.length}`,
  });
  hosts.push(host);
  return {
    db: createPluginContext(host.bb).db(),
    worktreeRoot: "/worktree",
    adapters: [adapter],
    createGenerationId: () => `generation-${hosts.length}`,
    now: () => new Date("2026-08-12T18:00:00.000Z"),
    isFileClean: async () => true,
  };
}

function requirementAdapter(
  remote: () => ServerEntity[],
  working: () => WorkingEntity[],
): EntityAdapter {
  return {
    kind: "requirement",
    klass: "VERSIONED",
    serializer: createSerializer("requirement"),
    async *fetchRemote(_scope, progress) {
      progress({ page: 1, of: 1 });
      yield remote();
    },
    async readWorking() {
      return working();
    },
  };
}

function requirement(reqId: string, title: string): ServerEntity {
  return {
    key: ENTITIES.requirement.key({ reqId }),
    remoteId: `remote-${reqId}`,
    payload: {
      id: `remote-${reqId}`,
      projectId: "project-wp17",
      kind: "requirement",
      fields: { reqId, title },
      humanEdited: null,
      reviewStatus: null,
      reviewVersion: null,
    },
  };
}

function authored(entity: ServerEntity, title?: string): WorkingEntity {
  const payload = createSerializer("requirement").semanticPayload(
    entity.payload,
  );
  return {
    key: entity.key,
    payload: { ...payload, title: title ?? String(payload["title"]) },
    file: `product-security/requirements/${String(payload["reqId"])}.yaml`,
  };
}

describe("sync status", () => {
  it("returns disjoint local, upstream, and conflict lists in contract order", async () => {
    const local = requirement("REQ-LOCAL", "base local");
    const upstream = requirement("REQ-UPSTREAM", "base upstream");
    const conflict = requirement("REQ-CONFLICT", "base conflict");
    let remote = [local, upstream, conflict];
    let working = remote.map((entity) => authored(entity));
    const adapter = requirementAdapter(
      () => remote,
      () => working,
    );
    const engine = deps(adapter);
    await pull(engine, scope, ["requirement"]);

    remote = [
      local,
      requirement("REQ-UPSTREAM", "remote edit"),
      requirement("REQ-CONFLICT", "remote conflict"),
    ];
    working = [
      authored(local, "local edit"),
      authored(upstream),
      authored(conflict, "local conflict"),
    ];
    const report = await status(engine, scope, ["requirement"]);

    expect(Object.keys(report)).toEqual([
      "local",
      "upstream",
      "conflicts",
      "orphans",
    ]);
    expect(report.local).toEqual([
      expect.objectContaining({ key: local.key, fields: ["title"] }),
    ]);
    expect(report.upstream).toEqual([
      expect.objectContaining({ key: upstream.key, fields: ["title"] }),
    ]);
    expect(report.conflicts).toEqual([
      { kind: "requirement", key: conflict.key },
    ]);
    expect(report.orphans).toEqual([]);
  });

  it("reports an overlay key absent from the current server key set as an orphan", async () => {
    const presentKey = ENTITIES.vexDecision.key({
      cve: "CVE-2026-1",
      purl: "pkg:generic/present@1",
      name: "present",
      version: "1",
    });
    const orphanKey = ENTITIES.vexDecision.key({
      cve: "CVE-2026-2",
      purl: "pkg:generic/missing@1",
      name: "missing",
      version: "1",
    });
    const present = {
      key: presentKey,
      remoteId: "finding-present",
      payload: {
        status: "IN_TRIAGE",
        justification: null,
        response: null,
        reason: null,
      },
    } satisfies ServerEntity;
    let working: WorkingEntity[] = [
      { ...present, file: ".fs/triage/present.yaml" },
    ];
    const adapter: EntityAdapter = {
      kind: "vexDecision",
      klass: "OVERLAY",
      serializer: createSerializer("vexDecision"),
      async *fetchRemote(_scope, progress) {
        progress({ page: 1, of: 1 });
        yield [present];
      },
      async readWorking() {
        return working;
      },
    };
    const engine = deps(adapter);
    await pull(engine, scope, ["vexDecision"]);
    working = [
      { ...present, file: ".fs/triage/present.yaml" },
      {
        key: orphanKey,
        file: ".fs/triage/missing.yaml",
        payload: {
          status: "NOT_AFFECTED",
          justification: null,
          response: null,
          reason: "local",
        },
      },
    ];

    const report = await status(engine, scope, ["vexDecision"]);
    expect(report.orphans).toEqual([
      { kind: "vexDecision", key: orphanKey, file: ".fs/triage/missing.yaml" },
    ]);
  });

  it("returns four empty lists when working, base, and remote are equal", async () => {
    const entity = requirement("REQ-CLEAN", "same");
    const adapter = requirementAdapter(
      () => [entity],
      () => [authored(entity)],
    );
    const engine = deps(adapter);
    await pull(engine, scope, ["requirement"]);
    await expect(status(engine, scope, ["requirement"])).resolves.toEqual({
      local: [],
      upstream: [],
      conflicts: [],
      orphans: [],
    });
  });

  it("rethrows local working-tree faults instead of classifying the kind as remotely unavailable", async () => {
    const adapter = requirementAdapter(
      () => [],
      () => {
        throw new Error("local working tree failed");
      },
    );

    await expect(
      statusPerKind(deps(adapter), scope, ["requirement"], {
        assuranceStudioProjectId: `as-${scope.projectId}`,
      }),
    ).rejects.toThrow("local working tree failed");
  });

  it("inverts UUID-shaped base references through accepted id_map before comparing YAML slugs", async () => {
    const componentKey = ENTITIES.component.key({ slug: "component-one" });
    const requirementKey = ENTITIES.requirement.key({ reqId: "REQ-REF" });
    const component: EntityAdapter = {
      kind: "component",
      klass: "VERSIONED",
      serializer: createSerializer("component"),
      async *fetchRemote(_scope, progress) {
        progress({ page: 1, of: 1 });
        yield [
          {
            key: componentKey,
            remoteId: "00000000-0000-4000-8000-000000000001",
            payload: {
              id: "00000000-0000-4000-8000-000000000001",
              projectId: scope.projectId,
              kind: "component",
              fields: { slug: "component-one", name: "Component One" },
              humanEdited: null,
              reviewStatus: null,
              reviewVersion: null,
            },
          },
        ];
      },
      async readWorking() {
        return [
          {
            key: componentKey,
            payload: { slug: "component-one", name: "Component One" },
            file: "product-security/architecture/components/component-one.yaml",
          },
        ];
      },
    };
    const requirement: EntityAdapter = {
      kind: "requirement",
      klass: "VERSIONED",
      serializer: createSerializer("requirement"),
      async *fetchRemote(_scope, progress) {
        progress({ page: 1, of: 1 });
        yield [
          {
            key: requirementKey,
            remoteId: "00000000-0000-4000-8000-000000000002",
            payload: {
              id: "00000000-0000-4000-8000-000000000002",
              projectId: scope.projectId,
              kind: "requirement",
              fields: {
                reqId: "REQ-REF",
                componentId: "00000000-0000-4000-8000-000000000001",
              },
              humanEdited: null,
              reviewStatus: null,
              reviewVersion: null,
            },
          },
        ];
      },
      async readWorking() {
        return [
          {
            key: requirementKey,
            payload: { reqId: "REQ-REF", componentId: "component-one" },
            file: "product-security/requirements/REQ-REF.yaml",
          },
        ];
      },
    };
    const engine = { ...deps(requirement), adapters: [component, requirement] };
    await pull(engine, scope, ["component", "requirement"]);
    await expect(status(engine, scope, ["requirement"])).resolves.toEqual({
      local: [],
      upstream: [],
      conflicts: [],
      orphans: [],
    });
  });
});
