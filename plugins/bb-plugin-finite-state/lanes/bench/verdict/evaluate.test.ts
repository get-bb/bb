import { describe, expect, it } from "vitest";
import {
  evaluateOtaVerdict,
  type CoverageState,
  type VerdictCandidateInput,
  type VerdictInput,
} from "./evaluate.js";
import { renderVerdictCli } from "./render-cli.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const NOW = "2026-08-13T12:00:00.000Z";

function candidate(
  overrides: Partial<VerdictCandidateInput> = {},
): VerdictCandidateInput {
  return {
    resultId: "result-a",
    requirementId: "REQ-A",
    tier: "static",
    mappingState: "mapped",
    runId: "run-a",
    checkId: "check-a",
    outcome: "pass",
    resultStatus: "verified",
    runStatus: "completed",
    firmwareDigest: DIGEST_A,
    runStartedAt: "2026-08-13T11:00:00.000Z",
    runFinishedAt: "2026-08-13T11:01:00.000Z",
    resultExecutedAt: "2026-08-13T11:01:00.000Z",
    pulledAt: "2026-08-13T11:02:00.000Z",
    superseded: false,
    attestations: [{
      attestationId: "attestation-a",
      signatureVerified: true,
      subjectMatchesDigest: true,
      verified: true,
      subjectDigest: DIGEST_A,
      requirementIds: ["REQ-A"],
      checkIds: ["check-a"],
      resultRefs: ["result-a"],
      signerIdentity: "builder@example.test",
      createdAt: "2026-08-13T11:02:00.000Z",
    }],
    ...overrides,
  };
}

function input(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    pvId: "version-a",
    firmwareDigest: DIGEST_A,
    currentMountedDigest: DIGEST_A,
    modelAvailable: true,
    requirements: [{
      requirementId: "REQ-A",
      tier: "static",
      required: true,
      mappedCheckIds: ["check-a"],
    }],
    candidates: [candidate()],
    computedAt: NOW,
    ...overrides,
  };
}

describe("evaluateOtaVerdict", () => {
  it("returns inconclusive for an empty or unavailable model", () => {
    const result = evaluateOtaVerdict(input({
      modelAvailable: false,
      requirements: [],
      candidates: [],
    }));
    expect(result).toMatchObject({
      verdict: "INCONCLUSIVE",
      required: 0,
      proven: 0,
      issues: [{ code: "MODEL_UNAVAILABLE" }],
    });
  });

  it("enumerates a missing current digest and never proves other bytes", () => {
    const result = evaluateOtaVerdict(input({
      firmwareDigest: null,
      currentMountedDigest: null,
    }));
    expect(result).toMatchObject({
      verdict: "INCONCLUSIVE",
      proven: 0,
      gaps: 1,
      evidence: [{ state: "stale_digest", evidenceDigest: DIGEST_A }],
      issues: [{ code: "MISSING_CURRENT_DIGEST" }],
    });
  });

  it("returns Safe to OTA only for complete, explicitly covered signed evidence", () => {
    const result = evaluateOtaVerdict(input());
    expect(result).toMatchObject({
      verdict: "SAFE_TO_OTA",
      required: 1,
      proven: 1,
      failed: 0,
      gaps: 0,
      evidence: [{
        state: "proven",
        runId: "run-a",
        checkId: "check-a",
        resultId: "result-a",
        attestationId: "attestation-a",
        signerIdentity: "builder@example.test",
      }],
    });
  });

  it.each([
    ["fail", "failed"],
    ["error", "error"],
  ] as const)("gives required %s evidence NOT_SAFE precedence over gaps", (outcome, state) => {
    const result = evaluateOtaVerdict(input({
      requirements: [
        { requirementId: "REQ-A", tier: "static", required: true, mappedCheckIds: ["check-a"] },
        { requirementId: "REQ-B", tier: "hil", required: true, mappedCheckIds: ["check-b"] },
      ],
      candidates: [candidate({ outcome, resultStatus: state })],
    }));
    expect(result).toMatchObject({ verdict: "NOT_SAFE", failed: 1, gaps: 1 });
  });

  it.each([
    ["unmapped", { mappedCheckIds: [] }, []],
    ["not_run", { mappedCheckIds: ["check-a"] }, []],
    ["running", { mappedCheckIds: ["check-a"] }, [candidate({ runStatus: "running", resultStatus: "running", outcome: null })]],
    ["skipped", { mappedCheckIds: ["check-a"] }, [candidate({ outcome: "skipped", resultStatus: "skipped" })]],
    ["unsigned", { mappedCheckIds: ["check-a"] }, [candidate({ attestations: [] })]],
    ["invalid_signature", { mappedCheckIds: ["check-a"] }, [candidate({ attestations: [{ ...candidate().attestations[0]!, verified: false, signatureVerified: false }] })]],
    ["insufficient_scope", { mappedCheckIds: ["check-a"] }, [candidate({ attestations: [{ ...candidate().attestations[0]!, resultRefs: [] }] })]],
    ["stale_digest", { mappedCheckIds: ["check-a"] }, [candidate({ firmwareDigest: DIGEST_B })]],
  ] as const)("classifies %s as an inconclusive gap", (state, cell, candidates) => {
    const result = evaluateOtaVerdict(input({
      requirements: [{ requirementId: "REQ-A", tier: "static", required: true, ...cell }],
      candidates,
    }));
    expect(result).toMatchObject({ verdict: "INCONCLUSIVE", proven: 0, gaps: 1 });
    expect(result.evidence[0]?.state).toBe(state);
  });

  it("does not let an optional unrun tier gate a safe verdict", () => {
    const result = evaluateOtaVerdict(input({
      requirements: [
        { requirementId: "REQ-A", tier: "static", required: true, mappedCheckIds: ["check-a"] },
        { requirementId: "REQ-A", tier: "manual", required: false, mappedCheckIds: ["check-manual"] },
      ],
    }));
    expect(result).toMatchObject({ verdict: "SAFE_TO_OTA", required: 1, proven: 1 });
    expect(result.evidence).toContainEqual(expect.objectContaining({
      tier: "manual",
      required: false,
      state: "not_run",
    }));
  });

  it("selects the latest completed mapped result and ignores superseded evidence", () => {
    const result = evaluateOtaVerdict(input({
      candidates: [
        candidate({ resultId: "result-old", outcome: "fail", resultStatus: "failed", resultExecutedAt: "2026-08-13T10:00:00.000Z", superseded: true }),
        candidate({ resultId: "result-new", resultExecutedAt: "2026-08-13T11:00:00.000Z", attestations: [{ ...candidate().attestations[0]!, resultRefs: ["result-new"] }] }),
      ],
    }));
    expect(result).toMatchObject({ verdict: "SAFE_TO_OTA", evidence: [{ resultId: "result-new" }] });
  });

  it("does not let a newer pass on one check mask another required check failure", () => {
    const result = evaluateOtaVerdict(input({
      requirements: [{
        requirementId: "REQ-A",
        tier: "static",
        required: true,
        mappedCheckIds: ["check-a", "check-b"],
      }],
      candidates: [
        candidate({ outcome: "fail", resultStatus: "failed" }),
        candidate({
          resultId: "result-b",
          checkId: "check-b",
          resultExecutedAt: "2026-08-13T11:30:00.000Z",
          attestations: [{ ...candidate().attestations[0]!, checkIds: ["check-b"], resultRefs: ["result-b"] }],
        }),
      ],
    }));
    expect(result).toMatchObject({ verdict: "NOT_SAFE", failed: 1, evidence: [{ checkId: "check-a", state: "failed" }] });
  });

  it("does not gate a required tier on an optional check in that tier", () => {
    const result = evaluateOtaVerdict(input({
      requirements: [
        { requirementId: "REQ-A", tier: "static", required: true, mappedCheckIds: ["check-a"] },
        { requirementId: "REQ-A", tier: "static", required: false, mappedCheckIds: ["check-optional"] },
      ],
    }));
    expect(result).toMatchObject({ verdict: "SAFE_TO_OTA", required: 1, proven: 1 });
  });

  it("marks a historical evaluated digest stale without relabeling it current", () => {
    const historical = candidate({
      firmwareDigest: DIGEST_B,
      attestations: [{ ...candidate().attestations[0]!, subjectDigest: DIGEST_B }],
    });
    const result = evaluateOtaVerdict(input({ firmwareDigest: DIGEST_B, candidates: [historical] }));
    expect(result).toMatchObject({ verdict: "SAFE_TO_OTA", stale: true, currentMountedDigest: DIGEST_A });
    expect(renderVerdictCli(result)).toContain("historical; not currently mounted");
  });

  it("never counts a pass from a failed or timed-out run as proof", () => {
    for (const runStatus of ["failed", "timeout"] as const) {
      const result = evaluateOtaVerdict(input({ candidates: [candidate({ runStatus })] }));
      expect(result).toMatchObject({
        verdict: "INCONCLUSIVE",
        proven: 0,
        evidence: [{ state: "not_run", runId: "run-a" }],
      });
    }
  });

  it("still gives failed evidence from a failed run NOT_SAFE precedence", () => {
    const result = evaluateOtaVerdict(input({
      candidates: [candidate({ runStatus: "failed", outcome: "fail", resultStatus: "failed" })],
    }));
    expect(result).toMatchObject({ verdict: "NOT_SAFE", evidence: [{ state: "failed" }] });
  });

  it("renders deterministic, ANSI-free CLI output with exact evidence references", () => {
    const output = renderVerdictCli(evaluateOtaVerdict(input()));
    expect(output).toBe([
      "Verdict: Safe to OTA",
      `Firmware digest: ${DIGEST_A}`,
      `Current mounted digest: ${DIGEST_A}`,
      "Coverage: 1/1 required cells proven; 0 failed; 0 gaps",
      "Blocking failures and gaps:",
      "- none",
      "Evidence coverage:",
      "- [proven] REQ-A/static (required) · outcome=pass · matrix=requirements/REQ-A/verifications/static · run=bench/runs/run-a · check=check-a · result=result-a · attestation=attestation-a",
      "Verified signatures:",
      "- builder@example.test · attestation-a",
      `Computed at: ${NOW}`,
      "",
    ].join("\n"));
    expect(output).not.toMatch(/\u001b\[/u);
  });

  it("never returns SAFE when a required evidence state is not proven", () => {
    const nonProven: readonly CoverageState[] = [
      "failed", "error", "unmapped", "not_run", "running", "skipped",
      "unsigned", "invalid_signature", "stale_digest",
      "insufficient_scope",
    ];
    for (const state of nonProven) {
      const overrides: Partial<VerdictInput> = state === "unmapped"
        ? { requirements: [{ requirementId: "REQ-A", tier: "static", required: true, mappedCheckIds: [] }] }
        : state === "not_run"
          ? { candidates: [] }
          : state === "running"
            ? { candidates: [candidate({ runStatus: "running", resultStatus: "running", outcome: null })] }
            : state === "skipped"
              ? { candidates: [candidate({ outcome: "skipped", resultStatus: "skipped" })] }
              : state === "unsigned"
                ? { candidates: [candidate({ attestations: [] })] }
                : state === "invalid_signature"
                  ? { candidates: [candidate({ attestations: [{ ...candidate().attestations[0]!, verified: false, signatureVerified: false }] })] }
                  : state === "insufficient_scope"
                    ? { candidates: [candidate({ attestations: [{ ...candidate().attestations[0]!, resultRefs: [] }] })] }
                  : state === "stale_digest"
                    ? { candidates: [candidate({ firmwareDigest: DIGEST_B })] }
                    : { candidates: [candidate({ outcome: state === "failed" ? "fail" : "error", resultStatus: state })] };
      const result = evaluateOtaVerdict(input(overrides));
      expect(result.evidence[0]?.state).toBe(state);
      expect(result.verdict).not.toBe("SAFE_TO_OTA");
    }
  });
});
