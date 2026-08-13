import { describe, expect, it } from "vitest";
import type { VerdictResult } from "./evaluate.js";
import { renderVerdictCli } from "./render-cli.js";

const DIGEST = "a".repeat(64);
const NOW = "2026-08-13T12:00:00.000Z";

function result(
  verdict: VerdictResult["verdict"],
  state: VerdictResult["evidence"][number]["state"],
): VerdictResult {
  const proven = state === "proven" ? 1 : 0;
  const failed = state === "failed" || state === "error" ? 1 : 0;
  return {
    pvId: "version-a",
    firmwareDigest: DIGEST,
    currentMountedDigest: DIGEST,
    verdict,
    stale: false,
    required: 1,
    proven,
    failed,
    gaps: 1 - proven - failed,
    evidence: [{
      requirementId: "REQ-A",
      tier: "static",
      state,
      required: true,
      runId: "run-a",
      checkId: "check-a",
      resultId: "result-a",
      outcome: state === "failed" ? "fail" : "pass",
      attestationId: "attestation-a",
      attestationVerified: state === "proven",
      ...(state === "proven" ? { signerIdentity: "builder@example.test" } : {}),
      evidenceDigest: DIGEST,
    }],
    issues: [],
    computedAt: NOW,
  };
}

describe("renderVerdictCli", () => {
  it.each([
    ["SAFE_TO_OTA", "proven", "Safe to OTA", "- none", "- builder@example.test · attestation-a"],
    ["NOT_SAFE", "failed", "Not safe to OTA", "- [failed] REQ-A/static", "- none"],
    ["INCONCLUSIVE", "insufficient_scope", "Inconclusive", "- [insufficient_scope] REQ-A/static", "- none"],
  ] as const)("renders a byte-exact, ANSI-free %s fixture", (verdict, state, label, blocker, signature) => {
    const rendered = renderVerdictCli(result(verdict, state));
    expect(rendered).toBe([
      `Verdict: ${label}`,
      `Firmware digest: ${DIGEST}`,
      `Current mounted digest: ${DIGEST}`,
      `Coverage: ${state === "proven" ? "1/1" : "0/1"} required cells proven; ${state === "failed" ? 1 : 0} failed; ${state === "insufficient_scope" ? 1 : 0} gaps`,
      "Blocking failures and gaps:",
      ...(state === "proven" ? [blocker] : [`${blocker} (required) · outcome=${state === "failed" ? "fail" : "pass"} · matrix=requirements/REQ-A/verifications/static · run=bench/runs/run-a · check=check-a · result=result-a · attestation=attestation-a`]),
      "Evidence coverage:",
      `- [${state}] REQ-A/static (required) · outcome=${state === "failed" ? "fail" : "pass"} · matrix=requirements/REQ-A/verifications/static · run=bench/runs/run-a · check=check-a · result=result-a · attestation=attestation-a`,
      "Verified signatures:",
      signature,
      `Computed at: ${NOW}`,
      "",
    ].join("\n"));
    expect(rendered).not.toMatch(/\u001b\[/u);
  });

  it("discloses an unknown mounted digest for evaluated bytes", () => {
    const rendered = renderVerdictCli({
      ...result("SAFE_TO_OTA", "proven"),
      currentMountedDigest: null,
    });
    expect(rendered).toContain("Current mounted digest: unavailable");
  });
});
