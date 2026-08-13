// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { planSchema } from "../../../shared/contract.js";
import { pushDisabledReason } from "./BlastRadiusFooter.js";

const basePlan = planSchema.parse({
  projectId: "project-1",
  projectVersionId: "version-1",
  planId: "plan-1",
  planSha256: "a".repeat(64),
  baseGenerationIds: { vexDecision: "generation-1" },
  baseRevisions: { vexDecision: 1 },
  baseStateSha256: "b".repeat(64),
  createdAt: "2026-08-13T00:00:00.000Z",
  staleness: { asOf: "2026-08-13T00:00:00.000Z", degraded: false },
  items: [
    {
      projectId: "project-1",
      projectVersionId: "version-1",
      kind: "vexDecision",
      key: "vex-1",
      label: "Decision",
      operation: "update",
      expectedBaseContentHash: "c".repeat(64),
      fields: [],
      conflicts: [],
      referrers: [],
      error: null,
    },
  ],
  summary: {
    creates: 0,
    updates: 1,
    deletes: 0,
    noops: 0,
    conflicts: 0,
    orphans: 0,
  },
  blastRadius: {
    requiresHumanReview: true,
    changed: 1,
    deletes: 0,
    remoteCalls: 1,
    surfaces: ["vexDecision"],
  },
  validationErrors: [],
  total: 1,
  next: null,
  cache: {
    state: "fresh",
    asOf: "2026-08-13T00:00:00.000Z",
    message: null,
    acceptedGenerationId: "generation-1",
    baseRevision: 1,
  },
});

function reason(
  overrides: Partial<Parameters<typeof pushDisabledReason>[0]> = {},
) {
  return pushDisabledReason({
    plan: basePlan,
    loading: false,
    connectionReady: true,
    confirmationChecked: true,
    inFlight: false,
    authorizationAvailable: true,
    ...overrides,
  });
}

describe("push safety matrix", () => {
  it("enables only a current, connected, validated, confirmed, authorized plan", () => {
    expect(reason()).toBeNull();
  });

  it.each([
    ["in-flight", { inFlight: true }, "Push request in progress"],
    ["unconfigured/offline", { connectionReady: false }, "Required remote connections are offline"],
    ["confirmation", { confirmationChecked: false }, "Confirm the reviewed blast radius before pushing"],
    ["authorization", { authorizationAvailable: false }, "Human push approval is unavailable in the web panel in v1"],
    ["loading", { loading: true }, "Plan refresh in progress"],
  ])("disables the %s state", (_name, overrides, expected) => {
    expect(reason(overrides)).toBe(expected);
  });

  it("disables degraded, conflicted, and invalid plans", () => {
    expect(
      reason({
        plan: { ...basePlan, staleness: { ...basePlan.staleness, degraded: true } },
      }),
    ).toBe("Refresh the degraded or stale plan before pushing");
    expect(
      reason({
        plan: {
          ...basePlan,
          items: [{ ...basePlan.items[0]!, operation: "conflict" }],
        },
      }),
    ).toBe("Resolve every conflict before pushing");
    expect(
      reason({
        plan: {
          ...basePlan,
          validationErrors: [
            { code: "INVALID", message: "Invalid value", artifactId: null, line: null },
          ],
        },
      }),
    ).toBe("Fix every validation error before pushing");
  });

  it("keeps the fail-closed v1 caption truthful for a degraded browser plan", () => {
    expect(
      reason({
        authorizationAvailable: false,
        plan: {
          ...basePlan,
          staleness: { ...basePlan.staleness, degraded: true },
          cache: { ...basePlan.cache, state: "stale" },
        },
      }),
    ).toBe("Human push approval is unavailable in the web panel in v1");
  });
});
