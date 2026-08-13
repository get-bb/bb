import type { Json, ForgeJobSnapshot } from "../../../lib/remote/types.js";
import type {
  BenchArtifactInput,
  BenchAttestationInput,
  BenchEvidenceBundle,
  BenchResultInput,
  BenchRunRecord,
} from "../store/types.js";

export interface SignedEvidenceCandidate {
  format: "in-toto" | "sigstore";
  subjectDigest: string;
  payload: string;
  signature: string;
}

export interface EvidenceVerifier {
  verify(candidate: SignedEvidenceCandidate, signal: AbortSignal): Promise<boolean>;
}

export interface ForgeEvidenceDeps {
  persistLog(
    runId: string,
    job: ForgeJobSnapshot,
    signal: AbortSignal,
  ): Promise<string | null>;
  verifier?: EvidenceVerifier;
}

function object(value: Json | null): Record<string, Json> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function stringField(value: Record<string, Json>, name: string): string | null {
  return typeof value[name] === "string" ? value[name] : null;
}

function outcome(value: string | null): BenchResultInput["outcome"] | null {
  return value === "pass" || value === "fail" || value === "error" || value === "skipped"
    ? value
    : null;
}

function resultForJob(job: ForgeJobSnapshot, requirementId: string): BenchResultInput {
  if (job.status === "FAILED" || job.status === "TIMEOUT") {
    return {
      requirementId,
      checkId: job.tool,
      outcome: job.status === "TIMEOUT" ? "error" : "fail",
      evidenceSummary: job.error?.message ?? `Forge job ${job.jobId} ended ${job.status}`,
    };
  }
  const result = object(job.result);
  const explicitOutcome = result ? outcome(stringField(result, "outcome")) : null;
  if (!explicitOutcome) {
    return {
      requirementId,
      checkId: job.tool,
      outcome: "error",
      evidenceSummary: "Forge completed without an explicit evidence outcome.",
    };
  }
  return {
    requirementId,
    checkId: stringField(result!, "checkId") ?? job.tool,
    outcome: explicitOutcome,
    evidenceSummary: stringField(result!, "summary"),
  };
}

function artifacts(job: ForgeJobSnapshot): BenchArtifactInput[] {
  const result = object(job.result);
  const candidates = result?.artifacts;
  if (!Array.isArray(candidates)) return [];
  const parsed: BenchArtifactInput[] = [];
  for (const candidate of candidates) {
    const value = object(candidate);
    if (!value) continue;
    const name = stringField(value, "name");
    const kind = stringField(value, "kind");
    const locator = stringField(value, "locator");
    if (!name || !kind || !locator) continue;
    parsed.push({
      name,
      kind,
      locator,
      sha256: stringField(value, "sha256"),
      bytes: typeof value.bytes === "number" ? value.bytes : null,
    });
  }
  return parsed;
}

function signedEvidence(job: ForgeJobSnapshot): SignedEvidenceCandidate | null {
  const result = object(job.result);
  const candidate = result ? object(result.attestation ?? null) : null;
  if (!candidate) return null;
  const format = stringField(candidate, "format");
  const subjectDigest = stringField(candidate, "subjectDigest");
  const payload = stringField(candidate, "payload");
  const signature = stringField(candidate, "signature");
  if (
    (format !== "in-toto" && format !== "sigstore") ||
    !subjectDigest ||
    !payload ||
    !signature
  ) {
    return null;
  }
  return { format, subjectDigest, payload, signature };
}

export async function forgeEvidenceCheckpoint(
  deps: ForgeEvidenceDeps,
  input: {
    run: BenchRunRecord;
    jobs: readonly ForgeJobSnapshot[];
    requirementId: string;
  },
  signal: AbortSignal,
): Promise<BenchEvidenceBundle> {
  const logLocators = new Map<string, string | null>();
  for (const job of input.jobs) {
    const locator = await deps.persistLog(input.run.runId, job, signal);
    logLocators.set(job.jobId, locator);
  }
  const candidate = input.jobs.map(signedEvidence).find((value) => value !== null) ?? null;
  let attestation: BenchAttestationInput | undefined;
  if (candidate) {
    const signatureVerified = deps.verifier
      ? await deps.verifier.verify(candidate, signal)
      : false;
    attestation = {
      format: candidate.format,
      subjectDigest: candidate.subjectDigest,
      payload: candidate.payload,
      verified: signatureVerified,
    };
  }
  const terminalStatus = input.jobs.some((job) => job.status === "TIMEOUT")
    ? "timeout"
    : input.jobs.some((job) => job.status === "FAILED")
      ? "failed"
      : "completed";
  return {
    run: {
      ...input.run,
      status: terminalStatus,
      finishedAt: new Date().toISOString(),
      logLocator:
        input.jobs.map((job) => logLocators.get(job.jobId) ?? null)
          .find((locator) => locator !== null) ?? null,
      raw: {
        firmwareDigest: input.run.firmwareDigest,
        jobs: input.jobs.map((job) => ({
          jobId: job.jobId,
          status: job.status,
          tool: job.tool,
          eventCount: job.eventCount,
          events: job.events,
          logTail: job.logTail,
          logLocator: logLocators.get(job.jobId) ?? null,
        })),
      },
    },
    results: input.jobs.map((job) => resultForJob(job, input.requirementId)),
    artifacts: input.jobs.flatMap(artifacts),
    ...(attestation ? { attestation } : {}),
  };
}
