import type {
  AttestationRow,
  VerificationArtifactRow,
  VerificationResultRow,
  VerificationRunRow,
} from "../../../lib/store/index.js";

export type BenchTier = "tier0" | "tier1" | "tier2" | "tier3" | "tier4";
export type MatrixTier = "static" | "emulation" | "hil" | "manual";
export type BenchRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timeout";
export type BenchResultOutcome = "pass" | "fail" | "error" | "skipped";

export interface BenchRunRecord {
  runId: string;
  projectId: string;
  pvId: string | null;
  tier: BenchTier;
  matrixTier: MatrixTier;
  target: string | null;
  status: BenchRunStatus;
  firmwareDigest: string | null;
  jobId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  raw: unknown;
  kind?: string;
  trigger?: string | null;
  hostId?: string | null;
  threadId?: string | null;
  config?: unknown | null;
  durationMs?: number | null;
  logLocator?: string | null;
  logCursor?: string | null;
}

export interface BenchResultInput {
  requirementId: string;
  checkId: string;
  outcome: BenchResultOutcome;
  evidenceSummary: string | null;
}

export interface BenchArtifactInput {
  name: string;
  kind: string;
  locator: string;
  sha256: string | null;
  bytes: number | null;
}

export interface BenchAttestationInput {
  format: "in-toto" | "sigstore";
  subjectDigest: string;
  payload: string;
  /** A signature-verifier result produced locally, never an upstream claim. */
  verified: boolean;
  /** Verifier-authenticated predicate coverage. Omission preserves legacy rows. */
  requirementIds?: readonly string[];
  /** Verifier-authenticated predicate coverage. Omission preserves legacy rows. */
  checkIds?: readonly string[];
  /** Verifier-authenticated local result identities. Omission preserves legacy rows. */
  resultRefs?: readonly string[];
  /** Verifier-authenticated signing identity, when the envelope supplies one. */
  signerIdentity?: string;
}

export interface BenchEvidenceBundle {
  run: BenchRunRecord;
  results: BenchResultInput[];
  artifacts: BenchArtifactInput[];
  attestation?: BenchAttestationInput;
}

export interface BenchCacheState {
  state: "fresh" | "stale" | "empty";
  asOf: string | null;
  message: string | null;
  acceptedGenerationId: string | null;
  baseRevision: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  next: string | null;
  cache: BenchCacheState;
}

export interface BenchRunQuery {
  projectId: string;
  pvId: string | null;
  pageSize: number;
  continuation: string | null;
  now?: string;
}

export interface BenchRunLookup {
  projectId: string;
  pvId: string | null;
  runId: string;
  now?: string;
}

export interface BenchRunSummary {
  runId: string;
  projectId: string;
  pvId: string | null;
  tier: BenchTier;
  matrixTier: MatrixTier;
  status: BenchRunStatus;
  target: string | null;
  firmwareDigest: string | null;
  jobId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  syncedAt: string;
}

export interface BenchRunDetail {
  run: BenchRunSummary;
  cache: BenchCacheState;
}

export interface BenchResultSummary {
  resultId: string;
  requirementId: string | null;
  checkId: string | null;
  reportedRequirementId: string;
  reportedCheckId: string;
  mapped: boolean;
  outcome: BenchResultOutcome;
  evidenceSummary: string | null;
  pulledAt: string;
}

export interface BenchArtifactSummary {
  artifactId: string;
  name: string;
  kind: string;
  locator: string;
  sha256: string | null;
  bytes: number | null;
  createdAt: string | null;
  pulledAt: string;
}

export interface BenchAttestationSummary {
  attestationId: string;
  format: string;
  subjectDigest: string;
  signatureVerified: boolean;
  subjectMatchesRun: boolean;
  verified: boolean;
  createdAt: string;
  pulledAt: string;
}

export interface BenchPageQuery {
  projectId: string;
  pvId: string | null;
  runId: string;
  pageSize: number;
  continuation: string | null;
  now?: string;
}

export interface StoredRunLocation {
  projectId: string;
  projectVersionId: string;
  generationId: string;
  row: VerificationRunRow | null;
}

export type BenchRunRow = VerificationRunRow;
export type BenchResultRow = VerificationResultRow;
export type BenchArtifactRow = VerificationArtifactRow;
export type BenchAttestationRow = AttestationRow;
