import { describe, expect, it } from "vitest";

import type { EntityKind } from "../../../lib/sync/registry.js";
import { canonicalJson } from "./canonical.js";
import { SERVER_OWNED_BASE } from "./exclusions.js";
import {
  UnsupportedEntitySerializerError,
  createSerializer,
  semanticPayload,
  type SerializeWarning,
} from "./serializer.js";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

const INLINE_PAYLOADS: ReadonlyArray<readonly [EntityKind, Record<string, unknown>]> = [
  ["component", { slug: "component-a", description: "Component" }],
  ["zone", { slug: "zone-a", name: "Zone" }],
  ["dataflow", { slug: "flow-a", source_id: "component-a", target_id: "component-b" }],
  ["asset", { slug: "asset-a", component_id: "component-a" }],
  ["threat", { slug: "threat-a", asset_id: "asset-a", title: "Threat" }],
  ["mitigation", { slug: "mitigation-a", threat_ids: ["threat-a"], title: "Mitigation" }],
  ["requirement", { reqId: "REQ-001", statement: "The product shall authenticate users." }],
  ["hbomPart", { id: "part-a", manufacturer: "Acme" }],
  ["vexDecision", { key: "finding-a", status: "not_affected" }],
  ["reqCheckMap", { reqId: "REQ-001", check_ids: ["check-a"] }],
  ["checkParams", { code: "check-a", parameters: { threshold: 3 } }],
  ["attackPath", { route_signature: "derived", name: "WAN route", threat_ids: ["threat-a"] }],
  ["sbomLink", { componentSlug: "component-a", purl: "pkg:generic/example@1" }],
  ["firmwareLink", { componentSlug: "component-a", firmware_path: "/usr/bin/example" }],
];

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

    expect(canonicalJson(semanticPayload("component", raw, {}))).toBe(canonicalJson({
      slug: "component-a",
      description: "Telemetry controller",
      future_semantic_field: { retained: true },
    }));
  });

  it("replaces only identifier-bearing values, recursively and in array order", () => {
    const raw = {
      slug: "flow-a",
      source_id: SOURCE_ID,
      target_ids: [TARGET_ID, SOURCE_ID],
      metadata: {
        edges: [SOURCE_ID, TARGET_ID],
        description: SOURCE_ID,
      },
    };
    const replacements = {
      [SOURCE_ID]: "component-source",
      [TARGET_ID]: "component-target",
    };

    expect(semanticPayload("dataflow", raw, replacements)).toEqual({
      slug: "flow-a",
      source_id: "component-source",
      target_ids: ["component-target", "component-source"],
      metadata: {
        edges: ["component-source", "component-target"],
        description: SOURCE_ID,
      },
    });
  });

  it("keeps an unresolved UUID and records a typed warning", () => {
    const warnings: SerializeWarning[] = [];
    const serializer = createSerializer("dataflow");
    const yaml = serializer.toYaml(
      { slug: "flow-a", source_id: SOURCE_ID },
      {
        idToSlug: () => null,
        onWarning: (warning) => warnings.push(warning),
      },
    );

    expect(yaml).toContain(SOURCE_ID);
    expect(warnings).toEqual([{
      code: "UNRESOLVED_ID",
      remoteId: SOURCE_ID,
      path: '$["source_id"]',
    }]);
  });
});

describe("createSerializer", () => {
  it.each(INLINE_PAYLOADS)("round-trips inline %s payloads with content-hash equality", (kind, payload) => {
    const serializer = createSerializer(kind);
    const expectedHash = serializer.contentHash(payload);
    const yaml = serializer.toYaml(payload, { idToSlug: () => null });
    const parsed = serializer.fromYaml(yaml, `${kind}.yaml`);

    expect(serializer.contentHash(parsed)).toBe(expectedHash);
    expect(serializer.toYaml(payload, { idToSlug: () => null })).toBe(yaml);
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

    expect(serializer.contentHash({ slug: "component-a", future_field: true }))
      .not.toBe(serializer.contentHash({ slug: "component-a" }));
  });

  it("preserves unknown keys without treating them as object prototypes", () => {
    const raw: Record<string, unknown> = JSON.parse(
      '{"slug":"component-a","__proto__":{"retained":true}}',
    );
    const payload = semanticPayload("component", raw);

    expect(Object.hasOwn(payload, "__proto__")).toBe(true);
    expect(payload["__proto__"]).toEqual({ retained: true });
  });
});
