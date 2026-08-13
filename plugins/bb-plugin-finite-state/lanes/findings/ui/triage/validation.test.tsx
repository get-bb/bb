import { describe, expect, it } from "vitest";
import {
  VEX_JUSTIFICATION_VALUES,
  VEX_RESPONSE_VALUES,
  VEX_SHORTCUTS,
  VEX_STATUS_VALUES,
  validateTriageDraft,
  type TriageDraft,
} from "./validation.js";

function valid(): TriageDraft {
  return {
    stableKey: "fs1.c3RhYmxl",
    status: "NOT_AFFECTED",
    justification: "CODE_NOT_PRESENT",
    response: null,
    reason: "Reviewed component inventory",
    evidence: "SBOM and mounted binary index",
    pin: "exact_version",
  };
}

describe("triage draft validation", () => {
  it("pins the exact frozen 6/5/9 vocabularies and six one-to-one status keys", () => {
    expect(VEX_STATUS_VALUES).toHaveLength(6);
    expect(VEX_RESPONSE_VALUES).toHaveLength(5);
    expect(VEX_JUSTIFICATION_VALUES).toHaveLength(9);
    expect(new Set(Object.values(VEX_SHORTCUTS))).toEqual(new Set(VEX_STATUS_VALUES));
  });

  it("requires NOT_AFFECTED justification, meaningful rationale, evidence, and exact reachability pin", () => {
    expect(validateTriageDraft({ ...valid(), justification: null })).toMatchObject({ ok: false, field: "justification" });
    expect(validateTriageDraft({ ...valid(), reason: "too short" })).toMatchObject({ ok: false, field: "reason" });
    expect(validateTriageDraft({ ...valid(), evidence: "" })).toMatchObject({ ok: false, field: "evidence" });
    expect(validateTriageDraft({ ...valid(), justification: "CODE_NOT_REACHABLE", pin: "any_version" })).toMatchObject({ ok: false, field: "pin" });
    expect(validateTriageDraft(valid())).toEqual({ ok: true });
  });
});
