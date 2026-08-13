import type { MatrixTier } from "../store/types.js";

export type { MatrixTier } from "../store/types.js";

export type OtaVerdict = "SAFE_TO_OTA" | "NOT_SAFE" | "INCONCLUSIVE";

export type CoverageState =
  | "proven"
  | "failed"
  | "error"
  | "unmapped"
  | "not_run"
  | "running"
  | "skipped"
  | "unsigned"
  | "invalid_signature"
  | "insufficient_scope"
  | "stale_digest";

export type VerdictIssueCode = "MODEL_UNAVAILABLE" | "MISSING_CURRENT_DIGEST";

export interface VerdictAttestationInput {
  attestationId: string;
  signatureVerified: boolean;
  subjectMatchesDigest: boolean;
  verified: boolean;
  subjectDigest: string;
  requirementIds: readonly string[];
  checkIds: readonly string[];
  resultRefs: readonly string[];
  signerIdentity: string | null;
  createdAt: string;
}

export interface VerdictCandidateInput {
  resultId: string;
  requirementId: string;
  tier: MatrixTier;
  mappingState: "mapped" | "unmapped";
  runId: string | null;
  checkId: string | null;
  outcome: string | null;
  resultStatus: string;
  runStatus: string | null;
  firmwareDigest: string | null;
  runStartedAt: string | null;
  runFinishedAt: string | null;
  resultExecutedAt: string | null;
  pulledAt: string;
  superseded: boolean;
  attestations: readonly VerdictAttestationInput[];
}

export interface VerdictRequirementInput {
  requirementId: string;
  tier: MatrixTier;
  required: boolean;
  mappedCheckIds: readonly string[];
}

export interface VerdictInput {
  pvId: string;
  firmwareDigest: string | null;
  currentMountedDigest: string | null;
  modelAvailable: boolean;
  requirements: readonly VerdictRequirementInput[];
  candidates: readonly VerdictCandidateInput[];
  computedAt: string;
}

export interface VerdictEvidence {
  requirementId: string;
  tier: MatrixTier;
  state: CoverageState;
  required: boolean;
  runId?: string;
  checkId?: string;
  resultId?: string;
  outcome?: string;
  attestationId?: string;
  attestationVerified: boolean;
  signatureVerified?: boolean;
  subjectMatchesDigest?: boolean;
  signerIdentity?: string;
  evidenceDigest?: string;
  runStartedAt?: string;
  runFinishedAt?: string;
  resultExecutedAt?: string;
  attestationCreatedAt?: string;
}

export interface VerdictIssue {
  code: VerdictIssueCode;
  message: string;
}

export interface VerdictResult {
  pvId: string;
  firmwareDigest: string | null;
  currentMountedDigest: string | null;
  verdict: OtaVerdict;
  stale: boolean;
  required: number;
  proven: number;
  failed: number;
  gaps: number;
  evidence: VerdictEvidence[];
  issues: VerdictIssue[];
  computedAt: string;
}

const FAILURE_RUN_STATUSES = new Set(["completed", "failed", "timeout"]);

function candidateTimestamp(candidate: VerdictCandidateInput): string {
  return candidate.resultExecutedAt
    ?? candidate.runFinishedAt
    ?? candidate.runStartedAt
    ?? candidate.pulledAt;
}

function compareCandidates(
  left: VerdictCandidateInput,
  right: VerdictCandidateInput,
): number {
  return candidateTimestamp(right).localeCompare(candidateTimestamp(left))
    || right.resultId.localeCompare(left.resultId);
}

function evidenceReference(
  cell: VerdictRequirementInput,
  state: CoverageState,
  candidate?: VerdictCandidateInput,
  attestation?: VerdictAttestationInput,
): VerdictEvidence {
  return {
    requirementId: cell.requirementId,
    tier: cell.tier,
    state,
    required: cell.required,
    attestationVerified: attestation?.verified === true,
    ...(candidate?.runId ? { runId: candidate.runId } : {}),
    ...(candidate?.checkId ? { checkId: candidate.checkId } : {}),
    ...(candidate ? { resultId: candidate.resultId } : {}),
    ...(candidate?.outcome ? { outcome: candidate.outcome } : {}),
    ...(attestation ? {
      attestationId: attestation.attestationId,
      signatureVerified: attestation.signatureVerified,
      subjectMatchesDigest: attestation.subjectMatchesDigest,
      attestationCreatedAt: attestation.createdAt,
      ...(attestation.signerIdentity ? { signerIdentity: attestation.signerIdentity } : {}),
    } : {}),
    ...(candidate?.firmwareDigest ? { evidenceDigest: candidate.firmwareDigest } : {}),
    ...(candidate?.runStartedAt ? { runStartedAt: candidate.runStartedAt } : {}),
    ...(candidate?.runFinishedAt ? { runFinishedAt: candidate.runFinishedAt } : {}),
    ...(candidate?.resultExecutedAt ? { resultExecutedAt: candidate.resultExecutedAt } : {}),
  };
}

function attestationAuthenticatesDigest(
  attestation: VerdictAttestationInput,
  digest: string,
): boolean {
  return attestation.verified
    && attestation.signatureVerified
    && attestation.subjectMatchesDigest
    && attestation.subjectDigest === digest;
}

function attestationCovers(
  attestation: VerdictAttestationInput,
  cell: VerdictRequirementInput,
  candidate: VerdictCandidateInput,
): boolean {
  if (candidate.checkId === null) return false;
  const requirementCovered = attestation.requirementIds.includes(cell.requirementId);
  const checkCovered = attestation.checkIds.includes(candidate.checkId);
  const resultCovered = attestation.resultRefs.includes(candidate.resultId);
  return requirementCovered && checkCovered && resultCovered;
}

function stateForMappedCheck(
  cell: VerdictRequirementInput,
  candidates: readonly VerdictCandidateInput[],
  digest: string | null,
  checkId: string,
): VerdictEvidence {
  const relevant = candidates
    .filter((candidate) =>
      candidate.requirementId === cell.requirementId
      && candidate.tier === cell.tier
      && candidate.mappingState === "mapped"
      && candidate.checkId === checkId
      && !candidate.superseded);
  relevant.sort(compareCandidates);
  if (digest === null) {
    const latest = relevant[0];
    return latest
      ? evidenceReference(cell, latest.firmwareDigest ? "stale_digest" : "not_run", latest)
      : evidenceReference(cell, "not_run");
  }
  const matching = relevant.filter((candidate) => candidate.firmwareDigest === digest);
  const failure = matching.find((candidate) =>
    candidate.runStatus !== null
    && FAILURE_RUN_STATUSES.has(candidate.runStatus)
    && (candidate.outcome === "fail" || candidate.resultStatus === "failed"));
  if (failure) return evidenceReference(cell, "failed", failure);
  const error = matching.find((candidate) =>
    candidate.runStatus !== null
    && FAILURE_RUN_STATUSES.has(candidate.runStatus)
    && (candidate.outcome === "error" || candidate.resultStatus === "error"));
  if (error) return evidenceReference(cell, "error", error);
  const completed = matching.find((candidate) => candidate.runStatus === "completed");
  if (completed) {
    if (completed.outcome === "fail" || completed.resultStatus === "failed") {
      return evidenceReference(cell, "failed", completed);
    }
    if (completed.outcome === "error" || completed.resultStatus === "error") {
      return evidenceReference(cell, "error", completed);
    }
    if (completed.outcome === "skipped" || completed.resultStatus === "skipped") {
      return evidenceReference(cell, "skipped", completed);
    }
    if (completed.outcome === "pass" || completed.resultStatus === "verified") {
      const attestations = [...completed.attestations].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
        || right.attestationId.localeCompare(left.attestationId));
      const authenticated = attestations.filter((attestation) =>
        attestationAuthenticatesDigest(attestation, digest));
      const proof = authenticated.find((attestation) =>
        attestationCovers(attestation, cell, completed));
      if (proof) return evidenceReference(cell, "proven", completed, proof);
      const outOfScope = authenticated[0];
      if (outOfScope) {
        return evidenceReference(cell, "insufficient_scope", completed, outOfScope);
      }
      const attempted = attestations[0];
      return evidenceReference(
        cell,
        attempted ? "invalid_signature" : "unsigned",
        completed,
        attempted,
      );
    }
    return evidenceReference(cell, "not_run", completed);
  }
  const running = matching.find((candidate) =>
    candidate.runStatus === "queued"
    || candidate.runStatus === "running"
    || candidate.resultStatus === "running");
  if (running) return evidenceReference(cell, "running", running);
  const incomplete = matching[0];
  if (incomplete) return evidenceReference(cell, "not_run", incomplete);
  const stale = relevant.find((candidate) => candidate.firmwareDigest !== digest);
  return stale
    ? evidenceReference(cell, "stale_digest", stale)
    : evidenceReference(cell, "not_run");
}

function stateForCell(
  cell: VerdictRequirementInput,
  candidates: readonly VerdictCandidateInput[],
  digest: string | null,
): VerdictEvidence {
  if (cell.mappedCheckIds.length === 0) {
    return evidenceReference(cell, "unmapped");
  }
  const checks = cell.mappedCheckIds.map((checkId) =>
    stateForMappedCheck(cell, candidates, digest, checkId));
  return checks.find((evidence) => evidence.state === "failed")
    ?? checks.find((evidence) => evidence.state === "error")
    ?? checks.find((evidence) => evidence.state !== "proven")
    ?? checks[0]!;
}

function uniqueCells(
  requirements: readonly VerdictRequirementInput[],
): VerdictRequirementInput[] {
  const cells = new Map<string, VerdictRequirementInput>();
  for (const requirement of requirements) {
    const key = `${requirement.requirementId}\0${requirement.tier}`;
    const current = cells.get(key);
    if (!current) {
      cells.set(key, {
        ...requirement,
        mappedCheckIds: [...new Set(requirement.mappedCheckIds)].sort(),
      });
      continue;
    }
    const required = current.required || requirement.required;
    const mappedCheckIds = current.required === requirement.required
      ? [...current.mappedCheckIds, ...requirement.mappedCheckIds]
      : requirement.required ? [...requirement.mappedCheckIds] : [...current.mappedCheckIds];
    cells.set(key, {
      requirementId: current.requirementId,
      tier: current.tier,
      required,
      mappedCheckIds: [...new Set(mappedCheckIds)].sort(),
    });
  }
  return [...cells.values()].sort((left, right) =>
    left.requirementId.localeCompare(right.requirementId)
    || left.tier.localeCompare(right.tier));
}

/** Deterministic, side-effect-free verdict policy over already validated evidence. */
export function evaluateOtaVerdict(input: VerdictInput): VerdictResult {
  const cells = uniqueCells(input.requirements);
  const evidence = cells.map((cell) => stateForCell(cell, input.candidates, input.firmwareDigest));
  const requiredEvidence = evidence.filter((cell) => cell.required);
  const proven = requiredEvidence.filter((cell) => cell.state === "proven").length;
  const failed = requiredEvidence.filter((cell) =>
    cell.state === "failed" || cell.state === "error").length;
  const gaps = requiredEvidence.length - proven - failed;
  const issues: VerdictIssue[] = [];
  if (!input.modelAvailable || cells.length === 0) {
    issues.push({
      code: "MODEL_UNAVAILABLE",
      message: "The accepted requirement model is missing or invalid.",
    });
  }
  if (input.firmwareDigest === null) {
    issues.push({
      code: "MISSING_CURRENT_DIGEST",
      message: "The evaluated firmware digest is unavailable.",
    });
  }
  const verdict: OtaVerdict = failed > 0
    ? "NOT_SAFE"
    : issues.length === 0
      && requiredEvidence.length > 0
      && proven === requiredEvidence.length
      ? "SAFE_TO_OTA"
      : "INCONCLUSIVE";
  return {
    pvId: input.pvId,
    firmwareDigest: input.firmwareDigest,
    currentMountedDigest: input.currentMountedDigest,
    verdict,
    stale:
      input.firmwareDigest !== null
      && input.currentMountedDigest !== null
      && input.firmwareDigest !== input.currentMountedDigest,
    required: requiredEvidence.length,
    proven,
    failed,
    gaps,
    evidence,
    issues,
    computedAt: input.computedAt,
  };
}
