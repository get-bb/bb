import { describe, expect, it, vi } from "vitest";

import type { EntityKind } from "../../../lib/sync/registry.js";
import { threeWayDiff } from "./diff.js";
import type { PlanItem } from "./index.js";
import { planItemId } from "./order.js";
import {
  registerValidator,
  validatePlanItem,
  validatePlanItems,
  type ValidateCtx,
} from "./validate.js";

const scope = { projectId: "project-validate", projectVersionId: "version-validate" };

function item(
  kind: EntityKind,
  key: string,
  label: string,
  operation: PlanItem["operation"],
  base: Record<string, unknown> | undefined,
  ours: Record<string, unknown> | undefined,
): PlanItem {
  return {
    ...scope,
    kind,
    key,
    label,
    operation,
    expectedBaseContentHash: null,
    fields: threeWayDiff(base, ours, base),
    conflicts: [],
    referrers: [],
    error: null,
  };
}

function context(
  items: readonly PlanItem[],
  payloads: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  references: ReadonlyMap<string, readonly string[]> = new Map(),
  sources: ValidateCtx["sources"] = new Map(),
): ValidateCtx {
  return {
    scope,
    items: new Map(items.map((entry) => [planItemId(entry), entry])),
    payloads,
    references,
    sources,
  };
}

describe("plan validation", () => {
  it("blocks a referenced delete and lists every referrer", () => {
    const target = item("threat", "target", "THREAT-1", "delete", { slug: "THREAT-1" }, undefined);
    const first = item("mitigation", "first", "MIT-1", "noop", { slug: "MIT-1", threats: ["THREAT-1"] }, {
      slug: "MIT-1", threats: ["THREAT-1"],
    });
    const second = item("requirement", "second", "REQ-2", "update", { reqId: "REQ-2" }, {
      reqId: "REQ-2", threats: ["THREAT-1"],
    });
    const references = new Map<string, readonly string[]>([
      [planItemId(first), [planItemId(target)]],
      [planItemId(second), [planItemId(target)]],
      [planItemId(target), []],
    ]);
    const payloads = new Map([
      [planItemId(target), { slug: "THREAT-1" }],
      [planItemId(first), { slug: "MIT-1", threats: ["THREAT-1"] }],
      [planItemId(second), { reqId: "REQ-2", threats: ["THREAT-1"] }],
    ]);

    const validated = validatePlanItems([target, first, second], context(
      [target, first, second],
      payloads,
      references,
    ));
    expect(validated[0]).toMatchObject({
      referrers: [{ label: "MIT-1" }, { label: "REQ-2" }],
      error: {
        code: "REFERENTIAL_INTEGRITY",
        message: "referenced by MIT-1, REQ-2",
      },
    });
  });

  it("rejects a requirement verification_status edit as a derived field", () => {
    const requirement = item(
      "requirement",
      "req-derived",
      "REQ-DERIVED",
      "update",
      { reqId: "REQ-DERIVED", verification_status: "not_run" },
      { reqId: "REQ-DERIVED", verification_status: "verified" },
    );
    const ctx = context(
      [requirement],
      new Map([[planItemId(requirement), { reqId: "REQ-DERIVED", verification_status: "verified" }]]),
      new Map([[planItemId(requirement), []]]),
      new Map([[planItemId(requirement), { file: "product-security/requirements/REQ-DERIVED.yaml", line: 9 }]]),
    );
    expect(validatePlanItem(requirement, ctx)).toMatchObject({
      error: {
        code: "DERIVED_FIELD",
        artifactId: "product-security/requirements/REQ-DERIVED.yaml",
        line: 9,
      },
    });
  });

  it.each([
    [{ status: "not_affected", justification: "CODE_NOT_PRESENT", response: null }, "VEX_STATUS_INVALID"],
    [{ status: "IN_TRIAGE", justification: null, response: "WONT_FIX" }, "VEX_RESPONSE_INVALID"],
    [{ status: "NOT_AFFECTED", justification: "code_not_present", response: null }, "VEX_JUSTIFICATION_INVALID"],
  ])("enforces frozen VEX vocabulary verbatim", (payload, code) => {
    const decision = item("vexDecision", "vex-vocab", "CVE-2026-1", "update", {
      status: "IN_TRIAGE", justification: null, response: null,
    }, payload);
    const ctx = context([decision], new Map([[planItemId(decision), payload]]));
    expect(validatePlanItem(decision, ctx).error?.code).toBe(code);
  });

  it("rejects NOT_AFFECTED without justification at the offending YAML line", () => {
    const payload = { status: "NOT_AFFECTED", justification: null, response: null };
    const decision = item("vexDecision", "vex-missing", "CVE-2026-2", "update", {
      status: "IN_TRIAGE", justification: null, response: null,
    }, payload);
    const ctx = context(
      [decision],
      new Map([[planItemId(decision), payload]]),
      new Map(),
      new Map([[planItemId(decision), { file: ".fs/triage/busybox.yaml", line: 17 }]]),
    );
    expect(validatePlanItem(decision, ctx).error).toEqual({
      code: "VEX_JUSTIFICATION_REQUIRED",
      message: "NOT_AFFECTED requires a frozen VEX justification",
      artifactId: ".fs/triage/busybox.yaml",
      line: 17,
    });
  });

  it("rejects needs_completion with its file and line", () => {
    const payload = {
      status: "IN_TRIAGE",
      justification: null,
      response: null,
      drift_state: "needs_completion",
    };
    const decision = item("vexDecision", "vex-incomplete", "CVE-2026-3", "update", {
      status: null, justification: null, response: null,
    }, payload);
    const ctx = context(
      [decision],
      new Map([[planItemId(decision), payload]]),
      new Map(),
      new Map([[planItemId(decision), { file: ".fs/triage/imported.yaml", line: 23 }]]),
    );
    expect(validatePlanItem(decision, ctx).error).toMatchObject({
      code: "NEEDS_COMPLETION",
      artifactId: ".fs/triage/imported.yaml",
      line: 23,
    });
  });

  it("invokes a registered surface validator for its foreign kind", () => {
    const invoked = vi.fn((entry: PlanItem) => entry);
    registerValidator("component", invoked);
    const component = item("component", "component-a", "COMPONENT-A", "create", undefined, {
      slug: "COMPONENT-A",
    });
    const ctx = context([component], new Map([[planItemId(component), { slug: "COMPONENT-A" }]]));
    validatePlanItem(component, ctx);
    expect(invoked).toHaveBeenCalledOnce();
  });
});
