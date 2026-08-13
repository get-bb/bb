import { describe, expect, it } from "vitest";

import { threeWayDiff } from "./diff.js";
import type { Plan, PlanItem } from "./index.js";
import { renderPlanCli } from "./render-cli.js";

const scope = { projectId: "project-render", projectVersionId: "version-render" };

function planItem(
  kind: PlanItem["kind"],
  label: string,
  operation: PlanItem["operation"],
  base: Record<string, unknown> | undefined,
  ours: Record<string, unknown> | undefined,
): PlanItem {
  return {
    ...scope,
    kind,
    key: label,
    label,
    operation,
    expectedBaseContentHash: null,
    fields: threeWayDiff(base, ours, base),
    conflicts: [],
    referrers: [],
    error: null,
  };
}

function fixturePlan(items: PlanItem[]): Plan {
  return {
    ...scope,
    planId: "01K2G8Z4Q9A1B2C3D4E5F6G7H8",
    planSha256: "a".repeat(64),
    baseGenerationIds: { requirement: "generation-render" },
    baseRevisions: { requirement: 1 },
    baseStateSha256: "b".repeat(64),
    createdAt: "2026-08-12T20:00:00.000Z",
    staleness: { asOf: "2026-08-12T20:00:00.000Z", degraded: false },
    items,
    summary: { creates: 6, updates: 3, deletes: 1, noops: 4, conflicts: 2, orphans: 2 },
    blastRadius: {
      requiresHumanReview: true,
      changed: 10,
      deletes: 1,
      remoteCalls: 10,
      surfaces: ["dataflow", "requirement", "threat", "vexDecision"],
    },
    validationErrors: [],
    total: items.length,
    next: null,
    cache: {
      state: "fresh",
      asOf: "2026-08-12T20:00:00.000Z",
      message: null,
      acceptedGenerationId: "generation-render",
      baseRevision: 1,
    },
  };
}

describe("plan CLI rendering", () => {
  it("renders the SPEC 01 section-5 fixture byte-identically", () => {
    const created = planItem("requirement", "REQ-118", "create", undefined, {
      reqId: "REQ-118",
      title: "WHEN a rollback is requested, the device SHALL…",
    });
    const threat = planItem("threat", "THREAT-22", "update", { severity: "medium" }, {
      severity: "high",
    });
    const vex = planItem("vexDecision", "VEX  busybox@1.36.1 / CVE-2023-42364", "update", {
      status: "IN_TRIAGE",
      justification: null,
    }, {
      status: "NOT_AFFECTED",
      justification: "CODE_NOT_REACHABLE",
    });
    const deleted = planItem("dataflow", "DATAFLOW-9", "delete", { slug: "DATAFLOW-9" }, undefined);
    deleted.referrers = [
      { ...scope, kind: "threat", key: "THREAT-14", label: "THREAT-14" },
      { ...scope, kind: "threat", key: "THREAT-31", label: "THREAT-31" },
    ];
    deleted.error = {
      code: "REFERENTIAL_INTEGRITY",
      message: "referenced by THREAT-14, THREAT-31",
      artifactId: null,
      line: null,
    };
    const conflict = planItem("threat", "THREAT-07", "conflict", {
      description: "Unauthenticated access to…",
    }, {
      description: "Unauthenticated management access to…",
    });
    const conflictField = threeWayDiff(
      { description: "Unauthenticated access to…" },
      { description: "Unauthenticated management access to…" },
      { description: "Unauth access to mgmt iface…" },
    )[0];
    if (conflictField === undefined) throw new Error("fixture has no conflict field");
    conflict.fields = [conflictField];
    conflict.conflicts = [{
      ...conflictField,
      attribution: { actor: "jsmith", at: "2026-08-09T14:22:00.000Z", source: "activity" },
      suggestion: null,
      resolution: null,
    }];

    expect(renderPlanCli(fixturePlan([created, threat, vex, deleted, conflict]))).toBe(`Plan: 6 to create, 3 to update, 1 to delete, 2 conflicts

  + create  REQ-118  "WHEN a rollback is requested, the device SHALL…"
  ~ update  THREAT-22  severity: medium → high
  ~ update  VEX  busybox@1.36.1 / CVE-2023-42364  → NOT_AFFECTED (CODE_NOT_REACHABLE)
  - delete  DATAFLOW-9   ⚠ referenced by THREAT-14, THREAT-31

  ⚠ conflict  THREAT-07.description
       base:   "Unauthenticated access to…"
       ours:   "Unauthenticated management access to…"
       theirs: "Unauth access to mgmt iface…"  (jsmith, 2026-08-09 14:22)

  2 orphaned overlay decisions (component no longer present) — see status
`);
  });

  it("suppresses noop rows and retains an offline staleness warning", () => {
    const noop = planItem("requirement", "REQ-NOOP", "noop", { title: "same" }, { title: "same" });
    const plan = fixturePlan([noop]);
    plan.summary = { creates: 0, updates: 0, deletes: 0, noops: 1, conflicts: 0, orphans: 0 };
    plan.staleness = { asOf: "2026-08-12T19:00:00.000Z", degraded: true };
    expect(renderPlanCli(plan)).toBe(`Plan: 0 to create, 0 to update, 0 to delete, 0 conflicts

  ⚠ upstream refresh unavailable; using base as of 2026-08-12T19:00:00.000Z
`);
  });
});
