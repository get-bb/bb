import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  AsEntity,
  AsEntityKind,
  AsReviewStatus,
  Json,
} from "../../../lib/remote/types.js";
import { ENTITIES, type EntityKind } from "../../../lib/sync/registry.js";
import { canonicalJson } from "./canonical.js";
import { SERVER_OWNED_BASE } from "./exclusions.js";
import {
  InvalidEntityEnvelopeError,
  UnsupportedEntitySerializerError,
  createSerializer,
  semanticPayload,
  type EntitySerializer,
  type SerializeOptions,
  type SerializeWarning,
} from "./serializer.js";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const FROZEN_FIXTURE_HEAD = "ea63cc684c5eb981760270b89e50d020732ce152";
const FROZEN_ENTITIES_SHA256 = "0daf497c641eff3534545df18acc254c2975935285f56cb9e7e24a2383d0e5e7";
const FROZEN_REQUIREMENTS_SHA256 = "06c87a51c6e1cb7cb0db0638d2c580c5fbb11fd5a41011513a6c2d8aa63e7b81";
const NO_ID_REPLACEMENTS: SerializeOptions = { idToSlug: () => null };

const DOMAIN_PAYLOADS = [
  ["component", { slug: "component-a", description: "Component" }],
  ["zone", { slug: "zone-a", name: "Zone" }],
  ["dataflow", { slug: "flow-a", sourceId: "component-a", targetId: "component-b" }],
  ["asset", { slug: "asset-a", componentId: "component-a" }],
  ["threat", { slug: "threat-a", assetId: "asset-a", title: "Threat" }],
  ["mitigation", { slug: "mitigation-a", threatIds: ["threat-a"], title: "Mitigation" }],
  ["requirement", { reqId: "REQ-001", statement: "The product shall authenticate users." }],
  ["hbomPart", { id: "part-a", manufacturer: "Acme" }],
  ["vexDecision", {
    cve: "CVE-2026-0001",
    name: "example-component",
    purl: "pkg:generic/example@1",
    status: "not_affected",
  }],
  ["reqCheckMap", { reqId: "REQ-001", checkIds: ["check-a"] }],
  ["checkParams", { code: "check-a", parameters: { threshold: 3 } }],
  ["attackPath", { routeSignature: "route-a", name: "WAN route", threatIds: ["threat-a"] }],
  ["sbomLink", { componentSlug: "component-a", purl: "pkg:generic/example@1" }],
  ["firmwareLink", { componentSlug: "component-a", firmwarePath: "/usr/bin/example" }],
  ["hardwareLink", { reference: "U3", mpn: "STM32H753ZIT6" }],
  ["citationFile", { file: "src/drivers/bme280.c", values: [] }],
] as const satisfies ReadonlyArray<readonly [EntityKind, Record<string, unknown>]>;

// Exact row from the frozen WP-08 corpus at FROZEN_FIXTURE_HEAD. The `satisfies`
// check pins this serializer test to the frozen WP-06 wire contract.
const FROZEN_ASSET_ENTITY = {
  fields: {
    componentId: "as-component-01",
    name: "Protected asset 1",
  },
  humanEdited: false,
  id: "asset-1",
  kind: "asset",
  projectId: "project-4a752600a07a",
  reviewStatus: "pending",
  reviewVersion: "400",
} satisfies AsEntity;

const fixtureRoot = fileURLToPath(new URL("../../../test/mock-remote/fixtures", import.meta.url));
const entitiesFixture = join(fixtureRoot, "assurance-studio", "entities.jsonl");
const requirementsFixture = join(fixtureRoot, "assurance-studio", "requirements.jsonl");
const fixtureCorpusAvailable = existsSync(entitiesFixture) && existsSync(requirementsFixture);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJson(item));
  }
  return isRecord(value) && Object.values(value).every((item) => isJson(item));
}

function isJsonRecord(value: unknown): value is Record<string, Json> {
  return isRecord(value) && Object.values(value).every((item) => isJson(item));
}

function isAsEntityKind(value: unknown): value is AsEntityKind {
  return value === "asset"
    || value === "attack-path"
    || value === "component"
    || value === "dataflow"
    || value === "mitigation"
    || value === "requirement"
    || value === "risk"
    || value === "threat"
    || value === "zone";
}

function isAsReviewStatus(value: unknown): value is AsReviewStatus | null {
  return value === null
    || value === "ai_approved"
    || value === "ai_flagged"
    || value === "human_approved"
    || value === "human_rejected"
    || value === "pending";
}

function parseAsEntity(line: string, file: string, lineNumber: number): AsEntity {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value)) {
    throw new Error(`${file}:${lineNumber} is not an object`);
  }

  const id = value["id"];
  const projectId = value["projectId"];
  const kind = value["kind"];
  const reviewVersion = value["reviewVersion"];
  const reviewStatus = value["reviewStatus"];
  const humanEdited = value["humanEdited"];
  const fields = value["fields"];
  if (
    typeof id !== "string"
    || typeof projectId !== "string"
    || !isAsEntityKind(kind)
    || (reviewVersion !== null && typeof reviewVersion !== "string")
    || !isAsReviewStatus(reviewStatus)
    || (humanEdited !== null && typeof humanEdited !== "boolean")
    || !isJsonRecord(fields)
  ) {
    throw new Error(`${file}:${lineNumber} does not satisfy the frozen AsEntity contract`);
  }

  return { id, projectId, kind, reviewVersion, reviewStatus, humanEdited, fields };
}

function readAsEntities(file: string): AsEntity[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, index) => line.length === 0 ? [] : [parseAsEntity(line, file, index + 1)]);
}

function entityRecord(entity: AsEntity): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entity));
}

function serializerKind(kind: AsEntityKind): EntityKind {
  switch (kind) {
    case "asset":
      return "asset";
    case "attack-path":
      return "attackPath";
    case "component":
      return "component";
    case "dataflow":
      return "dataflow";
    case "mitigation":
      return "mitigation";
    case "requirement":
      return "requirement";
    case "threat":
      return "threat";
    case "zone":
      return "zone";
    case "risk":
      throw new Error("The frozen registry has no risk serializer");
  }
}

function fixtureIdentity(entity: AsEntity): string {
  const componentId = entity.fields["componentId"];
  if (entity.kind === "component" && typeof componentId === "string") {
    return componentId;
  }
  const requirementKey = entity.fields["key"];
  if (entity.kind === "requirement" && typeof requirementKey === "string") {
    return requirementKey;
  }
  return entity.id;
}

function fixtureOptions(entities: readonly AsEntity[]): SerializeOptions {
  const replacements = new Map<string, string>();
  for (const entity of entities) {
    const identity = fixtureIdentity(entity);
    replacements.set(entity.id, identity);
    replacements.set(identity, identity);
  }
  return { idToSlug: (remoteId) => replacements.get(remoteId) ?? null };
}

function fileSha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("semanticPayload", () => {
  it("strips the authoritative server-owned fields and preserves unknown semantic fields", () => {
    const raw: Record<string, unknown> = {
      ...Object.fromEntries(SERVER_OWNED_BASE.map((field) => [field, `server:${field}`])),
      created_at: "2026-05-12T14:30:00.000Z",
      processing_status: "complete",
      slug: "component-a",
      description: "Telemetry controller",
      future_semantic_field: { retained: true },
    };

    expect(canonicalJson(semanticPayload("vexDecision", raw, {}))).toBe(canonicalJson({
      slug: "component-a",
      description: "Telemetry controller",
      future_semantic_field: { retained: true },
    }));
  });

  it("strips camelCase wire spellings through the upstream semantic field names", () => {
    expect(semanticPayload("vexDecision", {
      createdAt: "2026-05-12T14:30:00.000Z",
      key: "finding-a",
      projectId: "project-a",
      status: "not_affected",
      syncStatus: "complete",
      updatedAt: "2026-05-12T14:31:00.000Z",
    })).toEqual({ key: "finding-a", status: "not_affected" });
  });

  it("unwraps the frozen AsEntity envelope and replaces camelCase references", () => {
    expect(canonicalJson(semanticPayload("asset", entityRecord(FROZEN_ASSET_ENTITY), {
      "as-component-01": "component-0001",
    }))).toBe('{"componentId":"component-0001","name":"Protected asset 1"}');
  });

  it("strips the camelCase attack-path override from upstream semantic payloads", () => {
    const attackPath = entityRecord({
      fields: {
        dataflowIds: ["flow-01"],
        name: "WAN route",
        routeSignature: "server-derived-route",
      },
      humanEdited: false,
      id: "attack-path-1",
      kind: "attack-path",
      projectId: "project-4a752600a07a",
      reviewStatus: "pending",
      reviewVersion: "800",
    } satisfies AsEntity);

    expect(semanticPayload("attackPath", attackPath)).toEqual({
      dataflowIds: ["flow-01"],
      name: "WAN route",
    });
  });

  it("replaces verified reference leaves without rewriting arbitrary descendants", () => {
    const raw = {
      componentId: { nested: { anything: SOURCE_ID } },
      source_id: SOURCE_ID,
      target_ids: [TARGET_ID, SOURCE_ID],
      metadata: {
        description: SOURCE_ID,
        edges: [{ from: SOURCE_ID, label: SOURCE_ID, to: TARGET_ID }],
      },
    };
    const replacements = {
      [SOURCE_ID]: "component-source",
      [TARGET_ID]: "component-target",
    };

    expect(semanticPayload("vexDecision", raw, replacements)).toEqual({
      componentId: { nested: { anything: SOURCE_ID } },
      source_id: "component-source",
      target_ids: ["component-target", "component-source"],
      metadata: {
        description: SOURCE_ID,
        edges: [{ from: "component-source", label: SOURCE_ID, to: "component-target" }],
      },
    });
  });

  it("keeps an unresolved UUID and records a typed warning", () => {
    const warnings: SerializeWarning[] = [];
    const serializer = createSerializer("dataflow");
    const yaml = serializer.toYaml(
      { slug: "flow-a", sourceId: SOURCE_ID },
      {
        idToSlug: () => null,
        onWarning: (warning) => warnings.push(warning),
      },
    );

    expect(yaml).toContain(SOURCE_ID);
    expect(warnings).toEqual([{
      code: "UNRESOLVED_ID",
      remoteId: SOURCE_ID,
      path: '$["sourceId"]',
    }]);
  });
});

describe("createSerializer", () => {
  it("round-trips every supported entity with its registry key and content hash intact", () => {
    const supportedKinds = Object.entries(ENTITIES)
      .filter(([, entry]) => (entry.class === "VERSIONED" || entry.class === "OVERLAY") && "key" in entry)
      .map(([kind]) => kind)
      .sort();

    expect(DOMAIN_PAYLOADS.map(([kind]) => kind).sort()).toEqual(supportedKinds);
    for (const [kind, payload] of DOMAIN_PAYLOADS) {
      const serializer = createSerializer(kind);
      const expectedHash = serializer.contentHash(payload, NO_ID_REPLACEMENTS);
      const expectedKey = ENTITIES[kind].key(payload);
      const yaml = serializer.toYaml(payload, NO_ID_REPLACEMENTS);
      const parsed = serializer.fromYaml(yaml, `${kind}.yaml`);

      expect(ENTITIES[kind].key(parsed), kind).toBe(expectedKey);
      expect(serializer.contentHash(parsed, NO_ID_REPLACEMENTS), kind).toBe(expectedHash);
      expect(serializer.toYaml(payload, NO_ID_REPLACEMENTS), kind).toBe(yaml);
    }
  });

  it("keeps attack-path identity in YAML while excluding it from upstream PATCH semantics", () => {
    const serializer = createSerializer("attackPath");
    const payload = { routeSignature: "route-a", name: "WAN route" };
    const remoteEnvelope = entityRecord({
      fields: payload,
      humanEdited: false,
      id: "attack-path-1",
      kind: "attack-path",
      projectId: "project-a",
      reviewStatus: "pending",
      reviewVersion: "1",
    } satisfies AsEntity);
    const yaml = serializer.toYaml(remoteEnvelope, NO_ID_REPLACEMENTS);
    const parsed = serializer.fromYaml(yaml, "attack-paths/route-a.yaml");

    expect(parsed).toHaveProperty("routeSignature", "route-a");
    expect(ENTITIES.attackPath.key(parsed)).toBe(ENTITIES.attackPath.key(payload));
    expect(serializer.semanticPayload(remoteEnvelope)).toEqual({ name: "WAN route" });
  });

  it("requires explicit identifier normalization options for content hashes", () => {
    expectTypeOf<Parameters<EntitySerializer["contentHash"]>[1]>()
      .toEqualTypeOf<SerializeOptions>();
  });

  it("hashes the same normalized semantics for a remote envelope and its YAML", () => {
    const serializer = createSerializer("asset");
    const options: SerializeOptions = {
      idToSlug: (remoteId) => remoteId === "as-component-01" ? "component-0001" : null,
    };
    const envelope = entityRecord(FROZEN_ASSET_ENTITY);
    const yaml = serializer.toYaml(envelope, options);
    const parsed = serializer.fromYaml(yaml, "assets/asset-1.yaml");
    const changedEnvelope = entityRecord({
      ...FROZEN_ASSET_ENTITY,
      humanEdited: true,
      projectId: "project-changed",
      reviewStatus: "human_rejected",
      reviewVersion: "999",
    });

    expect(parsed).toEqual({ componentId: "component-0001", name: "Protected asset 1" });
    expect(yaml).not.toMatch(/^(?:fields|humanEdited|id|kind|projectId|reviewStatus|reviewVersion):/mu);
    expect(serializer.contentHash(envelope, options)).toBe(serializer.contentHash(parsed, options));
    expect(serializer.contentHash(changedEnvelope, options)).toBe(serializer.contentHash(parsed, options));
  });

  it("fails closed when an Assurance Studio response drifts from the frozen envelope", () => {
    const driftedEnvelope = Object.fromEntries(
      Object.entries(entityRecord(FROZEN_ASSET_ENTITY)).filter(([key]) => key !== "humanEdited"),
    );

    expect(() => createSerializer("asset").semanticPayload(driftedEnvelope))
      .toThrow(InvalidEntityEnvelopeError);
    expect(() => createSerializer("asset").semanticPayload(driftedEnvelope))
      .toThrow("missing humanEdited");

    expect(() => createSerializer("asset").semanticPayload({
      ...entityRecord(FROZEN_ASSET_ENTITY),
      fields: { invalid: undefined },
    })).toThrow("fields must be a JSON object");
  });

  it("does not route cached or canvas-layout data into entity YAML", () => {
    expect(() => createSerializer("finding")).toThrow(UnsupportedEntitySerializerError);
    expect(() => createSerializer("canvasLayout")).toThrow(UnsupportedEntitySerializerError);
  });

  it("preserves domain identity fields for local server:none entities", () => {
    const serializer = createSerializer("hbomPart");

    expect(serializer.semanticPayload({ id: "part-a", created_at: "supplier-authored" })).toEqual({
      id: "part-a",
      created_at: "supplier-authored",
    });
  });

  it("includes preserved unknown fields in content hashes", () => {
    const serializer = createSerializer("component");

    expect(serializer.contentHash({ slug: "component-a", future_field: true }, NO_ID_REPLACEMENTS))
      .not.toBe(serializer.contentHash({ slug: "component-a" }, NO_ID_REPLACEMENTS));
  });

  it("preserves unknown keys without treating them as object prototypes", () => {
    const raw: Record<string, unknown> = JSON.parse(
      '{"slug":"component-a","__proto__":{"retained":true}}',
    );
    if (!isJsonRecord(raw)) {
      throw new Error("test payload must satisfy the frozen JSON contract");
    }
    const payload = semanticPayload("asset", entityRecord({
      ...FROZEN_ASSET_ENTITY,
      fields: raw,
    } satisfies AsEntity));

    expect(Object.hasOwn(payload, "__proto__")).toBe(true);
    expect(payload["__proto__"]).toEqual({ retained: true });
  });
});

describe.skipIf(!fixtureCorpusAvailable)(`frozen WP-08 fixture corpus at ${FROZEN_FIXTURE_HEAD}`, () => {
  it("reads the exact reviewed fixture bytes", () => {
    expect(fileSha256(entitiesFixture)).toBe(FROZEN_ENTITIES_SHA256);
    expect(fileSha256(requirementsFixture)).toBe(FROZEN_REQUIREMENTS_SHA256);
  });

  it("round-trips every frozen Assurance Studio entity with normalized hash equality", () => {
    const entities = [...readAsEntities(entitiesFixture), ...readAsEntities(requirementsFixture)];
    const options = fixtureOptions(entities);

    expect(entities).toHaveLength(102);
    expect([...new Set(entities.map((entity) => entity.kind))].sort()).toEqual([
      "asset",
      "attack-path",
      "component",
      "dataflow",
      "mitigation",
      "requirement",
      "threat",
      "zone",
    ]);

    for (const entity of entities) {
      const serializer = createSerializer(serializerKind(entity.kind));
      const envelope = entityRecord(entity);
      const yaml = serializer.toYaml(envelope, options);
      const parsed = serializer.fromYaml(yaml, `${entity.kind}/${entity.id}.yaml`);

      expect(serializer.toYaml(envelope, options), entity.id).toBe(yaml);
      expect(serializer.contentHash(envelope, options), entity.id).toBe(serializer.contentHash(parsed, options));
      expect(yaml, entity.id).not.toMatch(/^(?:fields|humanEdited|id|kind|projectId|reviewStatus|reviewVersion):/mu);
    }
  });
});
