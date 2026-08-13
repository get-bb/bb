import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import type {
  AsEntity,
  AssuranceStudioClient,
  Json,
  RemotePage,
} from "../../../../lib/remote/types.js";
import { ENTITIES } from "../../../../lib/sync/registry.js";
import { computePlan } from "../../../sync/plan/index.js";
import {
  classifyThreeWay,
  conflictingFields,
  threeWayDiff,
} from "../../../sync/plan/diff.js";
import {
  assetProjectionRoundTrip,
  createCanvasEntityAdapters,
  dataflowProjectionRoundTrip,
  type AdapterSlugResolver,
} from "./adapters.js";
import {
  applyCanvasCommand,
  CanvasCasConflictError,
  CanvasSlugReuseError,
  type EditDeps,
} from "./commands.js";
import { CanvasEditHistory } from "./history.js";
import {
  architectureEntityPayload,
  parseArchitectureEntity,
  type ArchitectureYamlEntity,
  type CanvasEntityKind,
} from "./schema.js";
import {
  CanvasEntityValidationError,
  computeDeletionImpact,
  registerCanvasValidators,
  validateArchitecturePayload,
} from "./validators.js";
import {
  canvasEntityFile,
  parseCanvasEntity,
  serializeCanvasEntity,
  type CanvasFileStore,
  type CanvasRemoveOutcome,
  type CanvasWriteOutcome,
  type StoredCanvasEntity,
} from "./writer.js";

const roots: string[] = [];
const scope = {
  projectId: "project-canvas",
  projectVersionId: "version-canvas",
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

beforeAll(() => {
  registerCanvasValidators({ exists: () => false });
});

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const ENTITY_KINDS = [
  "component",
  "zone",
  "asset",
  "dataflow",
  "threat",
] as const satisfies readonly CanvasEntityKind[];

class MemoryCanvasStore implements CanvasFileStore {
  readonly documents = new Map<string, { content: string; sha256: string }>();

  kindFor(file: string): CanvasEntityKind {
    const kind = ENTITY_KINDS.find((candidate) =>
      file.startsWith(`${ENTITIES[candidate].dir}/`),
    );
    if (!kind) throw new Error(`Unknown canvas file ${file}`);
    return kind;
  }

  async read(file: string): Promise<StoredCanvasEntity | null> {
    const stored = this.documents.get(file);
    if (!stored) return null;
    return {
      entity: parseCanvasEntity(this.kindFor(file), stored.content, file),
      file,
      content: stored.content,
      sha256: stored.sha256,
    };
  }

  async list(kind: CanvasEntityKind): Promise<StoredCanvasEntity[]> {
    const files = [...this.documents.keys()]
      .filter((file) => file.startsWith(`${ENTITIES[kind].dir}/`))
      .sort();
    const documents = await Promise.all(files.map((file) => this.read(file)));
    return documents.filter(
      (document): document is StoredCanvasEntity => document !== null,
    );
  }

  async write(
    file: string,
    content: string,
    expectedSha256: string | null,
  ): Promise<CanvasWriteOutcome> {
    const current = this.documents.get(file);
    if (
      (expectedSha256 === null && current !== undefined) ||
      (expectedSha256 !== null && current?.sha256 !== expectedSha256)
    ) {
      return {
        outcome: "conflict",
        currentSha256: current?.sha256 ?? null,
      };
    }
    const sha256 = hash(content);
    this.documents.set(file, { content, sha256 });
    return { outcome: "written", sha256 };
  }

  async remove(
    file: string,
    expectedSha256: string,
  ): Promise<CanvasRemoveOutcome> {
    const current = this.documents.get(file);
    if (current?.sha256 !== expectedSha256) {
      return {
        outcome: "conflict",
        currentSha256: current?.sha256 ?? null,
        preservedFile: null,
      };
    }
    this.documents.delete(file);
    return { outcome: "removed" };
  }

  seed(entity: ArchitectureYamlEntity): string {
    const file = canvasEntityFile(entity.kind, entity.slug);
    const content = serializeCanvasEntity(entity);
    this.documents.set(file, { content, sha256: hash(content) });
    return file;
  }

  externalWrite(entity: ArchitectureYamlEntity): void {
    this.seed(entity);
  }
}

function component(slug: string, name = slug): ArchitectureYamlEntity {
  return parseArchitectureEntity("component", {
    slug,
    name,
    component_type: "software",
    criticality: "high",
    interfaces: [],
    technologies: [],
    is_entry_point: false,
    stores_data: false,
  });
}

function dataflow(
  slug: string,
  from: string,
  to: string,
): ArchitectureYamlEntity {
  return parseArchitectureEntity("dataflow", {
    slug,
    name: slug,
    from,
    to,
    data_types: ["telemetry"],
    encrypted: true,
    authenticated: true,
    bidirectional: false,
  });
}

function dependencies(store = new MemoryCanvasStore()): {
  store: MemoryCanvasStore;
  deps: EditDeps;
  used: Set<string>;
} {
  const used = new Set<string>();
  const deps: EditDeps = {
    files: store,
    async slugWasUsed(kind, slug) {
      return used.has(`${kind}/${slug}`);
    },
    recordSlugUse(kind, slug) {
      used.add(`${kind}/${slug}`);
    },
    async referenceExists(kind, slug) {
      if (kind === "mitigation") return false;
      return (await store.read(canvasEntityFile(kind, slug))) !== null;
    },
    async deletionImpact(kind, slug) {
      const groups = await Promise.all(
        ENTITY_KINDS.map((candidate) => store.list(candidate)),
      );
      return computeDeletionImpact(
        kind,
        slug,
        groups.flatMap((group) => group.map((stored) => stored.entity)),
      );
    },
  };
  return { store, deps, used };
}

function emptyPages<T>(): AsyncIterable<RemotePage<T>> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { items: [], total: 0, next: null };
    },
  };
}

const remoteEntity: AsEntity = {
  id: "remote",
  projectId: scope.projectId,
  kind: "component",
  reviewVersion: null,
  reviewStatus: null,
  humanEdited: null,
  fields: {},
};
const remoteClient = {
  async health() {
    return { configured: true, reachable: true, detail: null };
  },
  listEntities() {
    return emptyPages<AsEntity>();
  },
  async getEntity() {
    return remoteEntity;
  },
  async createEntity() {
    return {
      success: true as const,
      entity: remoteEntity,
      reviewStatusSet: false,
      reviewStatusReason: null,
    };
  },
  async updateEntity() {
    return {
      success: true as const,
      entity: remoteEntity,
      reviewStatusSet: false,
      reviewStatusReason: null,
    };
  },
  async deleteEntity() {
    return { success: true as const };
  },
  listProjectSbomPackages() {
    return emptyPages<Record<string, Json>>();
  },
  listVerificationChecks() {
    return emptyPages<Record<string, Json>>();
  },
  async getVerificationCheck() {
    return { results: [] };
  },
  async runVerificationChecks() {
    return { runId: "run", checksQueued: 0, status: "queued" };
  },
} satisfies AssuranceStudioClient;

const projectionResolver: AdapterSlugResolver = {
  remoteToSlug(_scope, kind, remoteId) {
    return remoteId.startsWith("remote-")
      ? `${kind}-${remoteId.slice("remote-".length)}`
      : null;
  },
  slugToRemote(_scope, _kind, slug) {
    return `remote-${slug}`;
  },
};

describe("WP-35 canvas commands and canonical YAML", () => {
  it("creates and edits canonical YAML without a remote call or no-op write", async () => {
    const { store, deps } = dependencies();
    const entity = component("gateway", "Gateway");
    const created = await applyCanvasCommand(deps, { kind: "create", entity });
    expect(created).toMatchObject({
      operation: "create",
      slug: "gateway",
      beforeSha256: null,
    });
    const stored = await store.read(created.file);
    expect(stored?.content).toBe(serializeCanvasEntity(entity));
    expect(stored?.content.startsWith("slug: gateway\n")).toBe(true);
    expect(stored?.content).not.toMatch(
      /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/iu,
    );

    const edited = await applyCanvasCommand(
      deps,
      {
        kind: "update",
        entityKind: "component",
        slug: "gateway",
        patch: { name: "Edge gateway" },
      },
      created.afterSha256 ?? undefined,
    );
    expect(edited.changedFields).toEqual(["name"]);
    const writesBeforeNoop = store.documents.size;
    const noop = await applyCanvasCommand(
      deps,
      {
        kind: "update",
        entityKind: "component",
        slug: "gateway",
        patch: { name: "Edge gateway" },
      },
      edited.afterSha256 ?? undefined,
    );
    expect(noop.changedFields).toEqual([]);
    expect(store.documents.size).toBe(writesBeforeNoop);
  });

  it("never reuses a slug, even after a session-local delete", async () => {
    const { deps } = dependencies();
    const entity = component("controller");
    const created = await applyCanvasCommand(deps, { kind: "create", entity });
    await applyCanvasCommand(
      deps,
      {
        kind: "delete",
        entityKind: "component",
        slug: "controller",
        mode: "cascade",
      },
      created.afterSha256 ?? undefined,
    );
    await expect(
      applyCanvasCommand(deps, { kind: "create", entity }),
    ).rejects.toBeInstanceOf(CanvasSlugReuseError);
  });

  it("rejects derived/review fields, verification_status, UUIDs, and unresolved slugs before writing", async () => {
    const { store, deps } = dependencies();
    store.seed(component("device"));
    await expect(
      applyCanvasCommand(deps, {
        kind: "update",
        entityKind: "component",
        slug: "device",
        patch: { verification_status: "passed" },
      }),
    ).rejects.toBeInstanceOf(CanvasEntityValidationError);
    await expect(
      applyCanvasCommand(deps, {
        kind: "update",
        entityKind: "component",
        slug: "device",
        patch: { reviewStatus: "human_approved" },
      }),
    ).rejects.toMatchObject({ code: "DERIVED_FIELD" });
    await expect(
      applyCanvasCommand(deps, {
        kind: "create",
        entity: dataflow("unresolved", "device", "missing-component"),
      }),
    ).rejects.toMatchObject({ code: "UNRESOLVED_SLUG" });
    await expect(
      applyCanvasCommand(deps, {
        kind: "update",
        entityKind: "component",
        slug: "device",
        patch: { description: "550e8400-e29b-41d4-a716-446655440000" },
      }),
    ).rejects.toMatchObject({ code: "SERVER_UUID_AUTHORED" });
    expect(store.documents.size).toBe(1);
  });

  it("rejects a threat category outside the methodology vocabulary", () => {
    expect(() =>
      validateArchitecturePayload("threat", {
        slug: "credential-phishing",
        name: "Credential phishing",
        category: "social_engineering",
        threat_source: "manual",
        severity: "high",
        affected_components: [],
        affected_assets: [],
        dataflows: [],
        mitigations: [],
        assumptions: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_METHODOLOGY_VOCABULARY" }),
    );
  });
});

describe("WP-35 plan ordering and adapter projections", () => {
  it("plans all five entity kinds after their dependencies and carries pulled base fences", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs49-plan-"));
    roots.push(root);
    const trustZone = parseArchitectureEntity("zone", {
      slug: "edge-zone",
      name: "Edge zone",
      trust_level: "untrusted",
    });
    const device = parseArchitectureEntity("component", {
      ...architectureEntityPayload(component("device")),
      zone: "edge-zone",
    });
    const cloud = parseArchitectureEntity("component", {
      ...architectureEntityPayload(component("cloud")),
      zone: "edge-zone",
    });
    const credentials = parseArchitectureEntity("asset", {
      slug: "credentials",
      name: "Credentials",
      asset_type: "credential",
      criticality: "critical",
      zone: "edge-zone",
    });
    const telemetry = dataflow("telemetry", "device", "cloud");
    const threat = parseArchitectureEntity("threat", {
      slug: "spoof-device",
      name: "Spoof device",
      category: "spoofing",
      threat_source: "stride_analysis",
      severity: "high",
      affected_components: ["device"],
      affected_assets: ["credentials"],
      dataflows: ["telemetry"],
      mitigations: [],
      assumptions: [],
    });
    const entities = [trustZone, device, cloud, credentials, telemetry, threat];
    for (const entity of entities) {
      const file = canvasEntityFile(entity.kind, entity.slug);
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), serializeCanvasEntity(entity), "utf8");
    }
    const adapters = createCanvasEntityAdapters(
      remoteClient,
      projectionResolver,
    );
    const host = createFakePluginHost({ pluginId: "finite-state-fs49-plan" });
    const db = createPluginContext(host.bb).db();
    db.prepare(
      `INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status,
          requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES (?, ?, 'generation-canvas', 'accepted', ?, ?, ?, ?)`,
    ).run(
      scope.projectId,
      scope.projectVersionId,
      JSON.stringify(["component", "zone", "asset", "dataflow", "threat"]),
      "2026-08-13T12:00:00.000Z",
      "2026-08-13T12:00:01.000Z",
      "2026-08-13T12:00:01.000Z",
    );
    const insertSync = db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind,
          accepted_generation_id, base_revision, last_pull, error)
       VALUES (?, ?, ?, 'generation-canvas', 7, ?, NULL)`,
    );
    for (const kind of ["component", "zone", "asset", "dataflow", "threat"]) {
      insertSync.run(
        scope.projectId,
        scope.projectVersionId,
        kind,
        "2026-08-13T12:00:01.000Z",
      );
    }
    const plan = await computePlan(
      {
        db,
        worktreeRoot: root,
        adapters,
      },
      scope,
      ["component", "zone", "asset", "dataflow", "threat"],
    );
    const creates = plan.items.filter((item) => item.operation === "create");
    expect(new Set(creates.map((item) => item.kind))).toEqual(
      new Set(["component", "zone", "asset", "dataflow", "threat"]),
    );
    expect(creates.every((item) => item.error === null)).toBe(true);
    const position = (kind: CanvasEntityKind, slug: string) =>
      creates.findIndex(
        (item) =>
          item.kind === kind && item.key === ENTITIES[kind].key({ slug }),
      );
    expect(position("zone", "edge-zone")).toBeLessThan(
      position("component", "device"),
    );
    expect(position("component", "device")).toBeLessThan(
      position("dataflow", "telemetry"),
    );
    expect(position("asset", "credentials")).toBeLessThan(
      position("threat", "spoof-device"),
    );
    expect(position("dataflow", "telemetry")).toBeLessThan(
      position("threat", "spoof-device"),
    );
    expect(plan.baseGenerationIds).toEqual({
      asset: "generation-canvas",
      component: "generation-canvas",
      dataflow: "generation-canvas",
      threat: "generation-canvas",
      zone: "generation-canvas",
    });
    expect(plan.baseRevisions).toEqual({
      asset: 7,
      component: 7,
      dataflow: 7,
      threat: 7,
      zone: 7,
    });
    expect(plan.baseStateSha256).toMatch(/^[a-f0-9]{64}$/u);
    await host.harness.lifecycle.dispose();
  });

  it("maps dataflow and asset POST/PATCH mismatches without changing stable YAML", () => {
    const flow = dataflow("telemetry", "device", "cloud");
    if (flow.kind !== "dataflow") throw new Error("expected dataflow fixture");
    const flowProjection = dataflowProjectionRoundTrip(
      flow,
      scope,
      projectionResolver,
    );
    expect(flowProjection.create).toMatchObject({
      source_component_id: "remote-device",
      target_component_id: "remote-cloud",
      is_encrypted: true,
    });
    expect(flowProjection.patch).toMatchObject({
      from_component: "remote-device",
      to_component: "remote-cloud",
      encrypted: true,
    });
    expect(flowProjection.patch).not.toHaveProperty("source_component_id");

    const asset = parseArchitectureEntity("asset", {
      slug: "credentials",
      name: "Credentials",
      asset_type: "credential",
      criticality: "critical",
    });
    if (asset.kind !== "asset") throw new Error("expected asset fixture");
    const assetProjection = assetProjectionRoundTrip(
      asset,
      scope,
      projectionResolver,
    );
    expect(assetProjection.create.business_value).toBe("critical");
    expect(assetProjection.patch.criticality).toBe("critical");
    expect(assetProjection.patch).not.toHaveProperty("business_value");
  });
});

describe("WP-35 delete impact, history, and conflict honesty", () => {
  it("computes blast radius and requires cascade for required dataflow endpoints", () => {
    const entities = [
      component("device"),
      component("cloud"),
      dataflow("telemetry", "device", "cloud"),
      parseArchitectureEntity("threat", {
        slug: "spoof-device",
        name: "Spoof device",
        category: "spoofing",
        threat_source: "stride_analysis",
        severity: "high",
        affected_components: ["device"],
        affected_assets: [],
        dataflows: [],
        mitigations: [],
        assumptions: [],
      }),
    ];
    const impact = computeDeletionImpact("component", "device", entities);
    expect(impact.allowedActions).toEqual(["cascade"]);
    expect(impact.referrers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "dataflow", slug: "telemetry" }),
        expect.objectContaining({ kind: "threat", slug: "spoof-device" }),
      ]),
    );
    expect(impact.restorable).toBe(true);
  });

  it("undoes and redoes with inverse CAS, then invalidates only the externally changed entity", async () => {
    const { store, deps } = dependencies();
    const initial = component("gateway", "Gateway");
    store.seed(initial);
    const history = new CanvasEditHistory(deps, 5);
    await history.execute({
      kind: "update",
      entityKind: "component",
      slug: "gateway",
      patch: { name: "Gateway v2" },
    });
    expect(
      (await store.read(canvasEntityFile("component", "gateway")))?.entity.name,
    ).toBe("Gateway v2");
    await history.undo();
    expect(
      (await store.read(canvasEntityFile("component", "gateway")))?.entity.name,
    ).toBe("Gateway");
    await history.redo();
    expect(
      (await store.read(canvasEntityFile("component", "gateway")))?.entity.name,
    ).toBe("Gateway v2");

    store.externalWrite(component("gateway", "External edit"));
    await expect(history.undo()).rejects.toBeInstanceOf(CanvasCasConflictError);
    expect(
      (await store.read(canvasEntityFile("component", "gateway")))?.entity.name,
    ).toBe("External edit");
    expect(history.state()).toMatchObject({
      canUndo: false,
      canRedo: false,
      invalidatedEntities: ["component/gateway"],
    });
  });

  it("keeps same-field conflicts as base/ours/theirs data and keeps YAML marker-free", () => {
    const base = { slug: "gateway", name: "Gateway" };
    const ours = { slug: "gateway", name: "Our gateway" };
    const theirs = { slug: "gateway", name: "Their gateway" };
    const fields = threeWayDiff(base, ours, theirs);
    expect(classifyThreeWay(base, ours, theirs)).toBe("conflict");
    expect(conflictingFields(fields)).toEqual([
      {
        field: "name",
        base: { present: true, value: "Gateway" },
        ours: { present: true, value: "Our gateway" },
        theirs: { present: true, value: "Their gateway" },
      },
    ]);
    const yaml = serializeCanvasEntity(component("gateway", "Our gateway"));
    expect(() =>
      parseCanvasEntity("component", yaml, "gateway.yaml"),
    ).not.toThrow();
    expect(yaml).not.toMatch(/^(<{7}|={7}|>{7})/mu);
  });

  it("keeps layout and trial/checkpoint APIs outside the semantic editing package", async () => {
    const editingSource = await Promise.all(
      ["backend.ts", "commands.tsx", "writer.ts"].map((file) =>
        readFile(new URL(file, import.meta.url), "utf8"),
      ),
    );
    const joined = editingSource.join("\n");
    expect(joined).not.toContain("begin_tara_trial");
    expect(joined).not.toContain("checkpoint");
    expect(joined).not.toContain("canvas.json");
    expect(joined).not.toContain("syncPush");
  });
});
