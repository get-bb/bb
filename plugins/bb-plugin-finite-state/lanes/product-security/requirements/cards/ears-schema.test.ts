import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  buildRequirementPlan,
  requirementSemanticSha256,
  serializeRequirement,
} from "./adapter.js";
import { renderEars } from "./render-ears.js";
import type { EarsPattern, RequirementYamlV1 } from "./schema.js";
import {
  validateRequirement,
  validateRequirementYaml,
} from "./validator.js";

const patternParts: Record<EarsPattern, RequirementYamlV1["ears"]["parts"]> = {
  ubiquitous: { system: "gateway", response: "reject unsigned firmware" },
  event_driven: {
    trigger: "an update begins",
    system: "gateway",
    response: "verify its signature",
  },
  state_driven: {
    state: "maintenance mode is active",
    system: "gateway",
    response: "deny remote enrollment",
  },
  unwanted_behavior: {
    trigger: "signature verification fails",
    system: "gateway",
    response: "retain the installed firmware",
  },
  optional_feature: {
    feature: "remote administration is enabled",
    system: "gateway",
    response: "require mutual authentication",
  },
  complex: {
    feature: "remote administration is enabled",
    precondition: "a service session is authorized",
    state: "maintenance mode is active",
    trigger: "a configuration write begins",
    system: "gateway",
    response: "record the authenticated operator",
  },
};

function requirement(pattern: EarsPattern): RequirementYamlV1 {
  const ears = { pattern, text: "", parts: patternParts[pattern] };
  ears.text = renderEars(ears);
  return {
    schema: "fs-requirement/v1",
    id: `REQ-${pattern.replaceAll("_", "-")}`,
    req_type: "security",
    priority: "P1",
    status: "draft",
    ears,
    rationale: "The update trust boundary must fail closed.",
    source_description: "Protect the update path from unauthenticated firmware.",
    mitigations: ["mit-signed-update"],
    controls: ["ctrl-secure-boot"],
    standards: ["iec-62443-4-2"],
    verification: [{
      check: "check-firmware-signature",
      method: "binary_analysis",
      tier: "static",
      required: true,
      pass_criteria: "Every accepted image has a valid trusted signature.",
    }],
  };
}

describe("fs-requirement/v1 EARS validation", () => {
  it.each(Object.keys(patternParts) as EarsPattern[])(
    "accepts and deterministically round-trips %s",
    (pattern) => {
      const source = requirement(pattern);
      expect(validateRequirement(source)).toEqual({
        success: true,
        data: source,
        errors: [],
      });

      const first = serializeRequirement(source);
      const parsed = validateRequirementYaml(first, `${source.id}.yaml`);
      expect(parsed.success).toBe(true);
      if (!parsed.success) throw new Error("serialized requirement did not validate");
      expect(serializeRequirement(parsed.data)).toBe(first);
      expect(parse(first)).not.toHaveProperty("verification_status");
    },
  );

  it("normalizes whitespace but rejects mismatched text and populated parts", () => {
    const eventDriven = requirement("event_driven");
    expect(validateRequirement({
      ...eventDriven,
      ears: {
        ...eventDriven.ears,
        text: "  WHEN   an update begins, the gateway SHALL verify its signature  ",
      },
    }).success).toBe(true);

    const mismatched = validateRequirement({
      ...eventDriven,
      ears: {
        ...eventDriven.ears,
        text: "The gateway SHALL accept every image",
        parts: { ...eventDriven.ears.parts, state: "booting" },
      },
    });
    expect(mismatched.success).toBe(false);
    if (mismatched.success) throw new Error("mismatched EARS unexpectedly passed");
    expect(mismatched.errors.map((error) => error.code)).toEqual([
      "EARS_PARTS",
      "EARS_ROUND_TRIP",
    ]);
  });

  it("canonicalizes omitted and null inapplicable EARS parts identically", () => {
    const omitted = requirement("ubiquitous");
    const explicitNull = {
      ...omitted,
      ears: {
        ...omitted.ears,
        parts: { ...omitted.ears.parts, trigger: null, state: null },
      },
    };
    expect(serializeRequirement(explicitNull)).toBe(serializeRequirement(omitted));
    expect(requirementSemanticSha256(explicitNull)).toBe(requirementSemanticSha256(omitted));
  });

  it("rejects server-owned verification truth at its YAML line and plans no write", () => {
    const yaml = `${serializeRequirement(requirement("ubiquitous"))}verification_status: verified\n`;
    const validation = validateRequirementYaml(yaml, "product-security/requirements/REQ-ubiquitous.yaml");
    expect(validation.success).toBe(false);
    if (validation.success) throw new Error("derived verification truth unexpectedly passed");
    expect(validation.errors).toContainEqual(expect.objectContaining({
      code: "DERIVED_FIELD",
      path: "verification_status",
      artifactId: "product-security/requirements/REQ-ubiquitous.yaml",
      line: yaml.trimEnd().split("\n").length,
    }));

    const plan = buildRequirementPlan(parse(yaml), {
      requirements: new Map(),
      checks: new Map(),
      mitigations: new Map(),
      controls: new Map(),
      standards: new Map(),
    });
    expect(plan).toEqual(expect.objectContaining({ valid: false, operations: [] }));
  });

  it("rejects server UUIDs and resolves every authored slug before planning", () => {
    const source = requirement("ubiquitous");
    const uuidResult = validateRequirement({
      ...source,
      controls: ["550e8400-e29b-41d4-a716-446655440000"],
    });
    expect(uuidResult.success).toBe(false);
    if (uuidResult.success) throw new Error("server UUID unexpectedly passed");
    expect(uuidResult.errors[0]?.code).toBe("UUID_FORBIDDEN");

    const unresolved = buildRequirementPlan(source, {
      requirements: new Map([[source.id, "remote-requirement-id"]]),
      checks: new Map(),
      mitigations: new Map(),
      controls: new Map(),
      standards: new Map(),
    });
    expect(unresolved).toEqual(expect.objectContaining({ valid: false, operations: [] }));
    if (unresolved.valid) throw new Error("unresolved slugs unexpectedly planned");
    expect(unresolved.errors.map((error) => error.path).sort()).toEqual([
      "controls",
      "mitigations",
      "standards",
      "verification.0.check",
    ]);
  });

  it("turns check:null into a blocking creation need without inventing an id", () => {
    const source = requirement("ubiquitous");
    const plan = buildRequirementPlan({
      ...source,
      mitigations: [],
      controls: [],
      standards: [],
      verification: [{ ...source.verification[0], check: null }],
    }, {
      requirements: new Map(),
      checks: new Map(),
      mitigations: new Map(),
      controls: new Map(),
      standards: new Map(),
    });
    expect(plan.valid).toBe(true);
    if (!plan.valid) throw new Error("check:null plan unexpectedly failed");
    expect(plan.operations).toContainEqual({
      order: 2,
      kind: "NEEDS_CHECK_CREATION",
      contractIndex: 0,
      blocking: true,
    });
    expect(JSON.stringify(plan.operations)).not.toMatch(/checkId/iu);
  });
});
